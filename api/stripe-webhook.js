import Stripe from 'stripe';
import crypto from 'crypto';

// Bounded Stripe API calls (listLineItems, refund lookups). A timeout makes the
// call throw; where that matters the handler answers 5xx and Stripe retries.
const stripe = new Stripe(process.env.STRIPE_SECRET, { timeout: 8000 });

// Timeout for the ops v2 order insert. A hang becomes an error -> 500 -> Stripe
// retries the delivery (the insert is idempotent on stripe_session_id).
const INSERT_TIMEOUT_MS = 8000;

// NOTE: The "export const config = { api: { bodyParser: false } }" convention is
// Next.js-ONLY and is completely ignored by @vercel/node plain serverless functions.
// @vercel/node adds Express-like helpers that auto-parse req.body, consuming the
// readable stream before our code runs.
//
// FIX: Read raw bytes via event-based Node.js stream API (req.on('data'/'end')).
// This bypasses any middleware parsing and delivers the verbatim bytes Stripe signed.
// NOTE (2026-11-19): vercel.json does NOT currently set "helpers: false" for this
// route (an earlier comment claimed it did). Raw-body behaviour in production has
// not been re-verified here; check a Stripe test-mode delivery before relying on it.
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Timeout for best-effort calls made AFTER the order is recorded (owner push,
// funnel link, Meta CAPI, GA4). A slow or hanging third party must not hold the
// webhook response open until Stripe times out and re-delivers the event.
const SIDE_CALL_TIMEOUT_MS = 3000;
function sideFetch(url, opts) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(SIDE_CALL_TIMEOUT_MS) });
}

const sha = (v) =>
  v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;

// Record the paid order into ops v2 (online_orders) so it can be fulfilled from
// the /orders page (stockroom-first WAT decrement).
//
// Idempotency: stripe_session_id is UNIQUE (id is a uuid PK). The insert uses
// ?on_conflict=stripe_session_id + Prefer: resolution=ignore-duplicates,
// return=representation, so a re-delivered event becomes ON CONFLICT DO NOTHING
// (without on_conflict, PostgREST only ignores PK conflicts). PostgREST then
// answers 201 with an EMPTY array `[]` for an ignored duplicate and `[ {row} ]`
// for a fresh insert, which is how we tell them apart (service_role can SELECT
// online_orders, so the representation is returned). A 2xx body that is not a
// JSON array is treated as a fresh insert (worst case: one extra owner push).
// As an extra guard, a 409 / 23505 unique-violation answer is also treated as
// "already recorded" (success), so a re-delivery never becomes a permanent 500.
//
// Throws on ANY failure (missing config, network error, non-2xx from ops v2).
// The handler turns that into a 5xx, so Stripe retries the delivery instead of
// the paid order being silently lost.
async function recordOrder(s) {
  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    console.error('[stripe-webhook] recordOrder FAILED: OPS_SUPABASE_URL or OPS_SUPABASE_SERVICE_KEY not set (session ' + s.id + ')');
    throw new Error('ops v2 config missing (OPS_SUPABASE_URL / OPS_SUPABASE_SERVICE_KEY)');
  }

  // Pull line items to get the per-barcode breakdown + exact line revenue.
  let lineItems = [];
  try {
    const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100 });
    lineItems = li.data || [];
  } catch (e) {
    console.warn('[stripe-webhook] listLineItems failed (fallback to metadata):', e.message);
  }

  // Aggregate by barcode. Line description is "{bc} · {colour}" (set by checkout.js).
  const byBc = new Map();
  for (const li of lineItems) {
    const desc = li.description || '';
    const sep = desc.indexOf(' · ');
    const bc = sep > 0 ? desc.slice(0, sep).trim() : '';
    const name = sep > 0 ? desc.slice(sep + 3).trim() : desc;
    const qty = li.quantity || 1;
    const revenue = (li.amount_total || 0) / 100; // £, ex-shipping, post-discount
    const k = bc || name;
    const e = byBc.get(k) || { bc, name, qty: 0, revenue: 0 };
    e.qty += qty;
    e.revenue = Math.round((e.revenue + revenue) * 100) / 100;
    byBc.set(k, e);
  }
  let items = [...byBc.values()];
  // Fallback to metadata.items ("1077x1,1111x2") if line items were unavailable.
  if (!items.length && s.metadata && s.metadata.items) {
    items = s.metadata.items.split(',').map((p) => {
      const [bc, q] = p.split('x');
      return { bc: (bc || '').trim(), name: '', qty: parseInt(q) || 1, revenue: 0 };
    });
  }

  const d = s.customer_details || {};
  const ship =
    s.shipping_details ||
    (s.collected_information && s.collected_information.shipping_details) ||
    {};
  const row = {
    source: 'karmilaven',
    stripe_session_id: s.id,
    event_id: (s.metadata && s.metadata.event_id) || s.client_reference_id || null,
    customer_name: ship.name || d.name || null,
    email: d.email || null,
    phone: d.phone || null,
    address: ship.address || d.address || null,
    currency: (s.currency || 'gbp').toUpperCase(),
    amount_total: (s.amount_total || 0) / 100,
    shipping_total:
      s.total_details && s.total_details.amount_shipping
        ? s.total_details.amount_shipping / 100
        : 0,
    items,
    store_id: 'WAT',
    status: 'paid',
  };

  console.log('[stripe-webhook] recordOrder → inserting session', s.id, 'items:', items.length);
  let resp;
  try {
    resp = await fetch(`${base}/rest/v1/online_orders?on_conflict=stripe_session_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('[stripe-webhook] recordOrder fetch error:', e.message);
    // Network error or INSERT_TIMEOUT_MS abort. Re-throw: the handler answers
    // 5xx and Stripe retries the delivery.
    throw e;
  }
  if (!resp.ok) {
    const insertBody = await resp.text().catch(() => '(unreadable)');
    if (resp.status === 409 || /23505/.test(insertBody)) {
      // Unique violation on stripe_session_id: this session is already in
      // online_orders (Stripe re-delivery). Success, not a retryable failure.
      console.warn('[stripe-webhook] recordOrder: session already recorded (duplicate delivery)', s.id, resp.status);
      return { row, duplicate: true };
    }
    console.error('[stripe-webhook] recordOrder ops insert FAILED', resp.status, insertBody);
    // Throw so the handler answers 5xx and Stripe retries (insert is idempotent).
    throw new Error(`ops v2 insert failed: HTTP ${resp.status}`);
  }
  // 2xx: an empty array means ON CONFLICT DO NOTHING ignored a re-delivery.
  const okBody = await resp.text().catch(() => '');
  let inserted = null;
  try { inserted = JSON.parse(okBody); } catch (_) { /* not JSON -> treat as fresh */ }
  if (Array.isArray(inserted) && inserted.length === 0) {
    console.warn('[stripe-webhook] recordOrder: session already recorded (ignored duplicate, 2xx + [])', s.id, resp.status);
    return { row, duplicate: true };
  }
  console.log('[stripe-webhook] recordOrder ops insert OK', resp.status);
  return { row, duplicate: false };
}

// Best-effort push notification to owner + currently-clocked-in WAT staff.
// Uses /api/orders/notify which fans out to owner subscriptions AND any WAT
// staff whose clock_records row has clock_in set and clock_out null today.
// Never throws; bounded by SIDE_CALL_TIMEOUT_MS.
async function notifyOwner(row) {
  const appUrl = process.env.OPS_APP_URL;
  if (!appUrl) return;
  const n = (row.items || []).reduce((a, i) => a + (i.qty || 0), 0);
  try {
    await sideFetch(`${appUrl}/api/orders/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Yeni online sipariş — Karmi Laven',
        detail: `${n} bileklik${row.customer_name ? ` · ${row.customer_name}` : ''}`,
        url: '/orders',
      }),
    });
  } catch (e) {
    console.warn('[stripe-webhook] owner push failed (non-fatal):', e.message);
  }
}

// Reverse a Stripe refund into ops v2: stock return + order status='refunded'/'partial_refund'.
// charge object: https://stripe.com/docs/api/charges/object
//
// Throws on Stripe API errors and non-2xx from ops v2, so the handler answers 5xx and
// Stripe retries. Missing OPS_APP_URL / WEBHOOK_SECRET only logs (see below). Safe to retry: fn_online_refund_event
// is idempotent on charge_id+barcode, and ops answers 200 for an already-refunded
// order and for order_not_found (so those are NOT retried forever).
async function handleRefund(charge) {
  const appUrl = process.env.OPS_APP_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!appUrl || !secret) {
    // WEBHOOK_SECRET is the Bearer secret shared with ops v2 (ops-v2 /api/orders/refund checks
    // `Authorization: Bearer ${WEBHOOK_SECRET}`); it is NOT Stripe's signing secret. A missing
    // config will not fix itself on retry, and answering 5xx for days could get this endpoint
    // disabled by Stripe (which would also stop order delivery). So: log loudly, do not retry.
    // The refund must then be reconciled by the daily Stripe <-> online_orders check.
    console.error('[stripe-webhook] REFUND NOT SYNCED: OPS_APP_URL or WEBHOOK_SECRET not set (charge ' + charge.id + ')');
    return;
  }

  // Resolve the checkout session from the charge's payment_intent.
  // Charges on a checkout session have metadata.stripe_session_id or we look it
  // up via the payment_intent.
  let sessionId = charge.metadata && charge.metadata.stripe_session_id;
  if (!sessionId && charge.payment_intent) {
    try {
      const pi = await stripe.paymentIntents.retrieve(charge.payment_intent, { expand: ['latest_charge'] });
      // Checkout sessions store the session id in the payment_intent metadata (added by checkout.js)
      sessionId = (pi.metadata && pi.metadata.stripe_session_id) || null;
      if (!sessionId) {
        // Last resort: search recent checkout sessions for this payment_intent
        const sessions = await stripe.checkout.sessions.list({ payment_intent: charge.payment_intent, limit: 1 });
        sessionId = sessions.data[0] && sessions.data[0].id;
      }
    } catch(e) {
      // Stripe API error (transient or config) — retry rather than silently skip.
      console.error('[stripe-webhook] handleRefund session lookup failed:', e.message);
      throw e;
    }
  }
  if (!sessionId) {
    // Not a Checkout-session charge (e.g. manual/payment-link charge) — nothing to sync.
    console.warn('[stripe-webhook] handleRefund: no checkout session for charge', charge.id, '— skipped');
    return;
  }

  // Reconstruct line items from the original session so we know per-barcode qty.
  let lineItems = [];
  try {
    const li = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
    lineItems = li.data || [];
  } catch(e) { /* fall through — ops will use stored order.items */ }

  const byBc = new Map();
  for (const li of lineItems) {
    const desc = li.description || '';
    const sep = desc.indexOf(' · ');
    const bc = sep > 0 ? desc.slice(0, sep).trim() : '';
    const name = sep > 0 ? desc.slice(sep + 3).trim() : desc;
    const qty = li.quantity || 1;
    const revenue = (li.amount_total || 0) / 100;
    const k = bc || name;
    const e = byBc.get(k) || { bc, name, qty: 0, revenue: 0 };
    e.qty += qty; e.revenue = Math.round((e.revenue + revenue) * 100) / 100;
    byBc.set(k, e);
  }
  const items = [...byBc.values()];

  const refundAmount = (charge.amount_refunded || 0) / 100;

  let resp;
  try {
    resp = await fetch(`${appUrl}/api/orders/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        stripe_session_id: sessionId,
        charge_id: charge.id,
        items: items.length ? items : undefined, // undefined → ops uses order.items
        refund_amount: refundAmount,
      }),
    });
  } catch (e) {
    console.error('[stripe-webhook] handleRefund fetch error:', e.message);
    throw e; // handler answers 5xx → Stripe retries
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '(unreadable)');
    console.error('[stripe-webhook] handleRefund ops refund FAILED', resp.status, t.slice(0, 500));
    throw new Error(`ops v2 refund failed: HTTP ${resp.status}`);
  }
  console.log('[stripe-webhook] handleRefund ops refund OK', resp.status, 'charge', charge.id);
}

// Link the buyer's email ↔ their anonymous browsing session in ops-v2 funnel_events.
// This is a legit soft opt-in: the customer completed a purchase. Best-effort,
// fully wrapped and bounded by SIDE_CALL_TIMEOUT_MS — it can NEVER affect order
// recording or the webhook status code.
async function linkFunnelIdentity(s) {
  try {
    const email = s.customer_details && s.customer_details.email;
    const klSid = s.metadata && s.metadata.kl_sid;
    if (!email) return; // nothing to link without an email
    const opsApp = process.env.OPS_APP_URL;
    if (!opsApp) { console.warn('[stripe-webhook] funnel link skipped: OPS_APP_URL not set'); return; }
    await sideFetch(`${opsApp}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'purchase',
        email,
        session_id: klSid || null,
        cart_value: (s.amount_total || 0) / 100,
      }),
    });
  } catch (e) {
    console.warn('[stripe-webhook] funnel identity link failed (non-fatal):', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event;
  try {
    // Read raw bytes via Node.js stream events — the only reliable way to get the
    // verbatim body bytes that Stripe signed on a plain @vercel/node function.
    const buf = await rawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('[stripe-webhook] signature verified, event type:', event.type, 'id:', event.id);
  } catch (e) {
    console.error('[stripe-webhook] signature verify failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const value = (s.amount_total || 0) / 100,
      currency = (s.currency || 'gbp').toUpperCase();
    const d = s.customer_details || {};

    // Record order → ops v2 (stock decrement happens on manual fulfilment).
    // On failure answer 5xx so Stripe retries; the calls below are skipped so
    // they fire once, on the successful retry.
    let recorded;
    try {
      recorded = await recordOrder(s);
    } catch (e) {
      console.error('[stripe-webhook] checkout.session.completed NOT recorded, returning 500 for retry:', event.id, s.id, e.message);
      return res.status(500).json({ error: 'order recording failed; retry' });
    }

    // The order is safely recorded: from here on the answer is always 200.
    // The remaining calls are best-effort, run in parallel, each bounded by
    // SIDE_CALL_TIMEOUT_MS, and their errors/timeouts are only logged. They are
    // still awaited (work after the response is not guaranteed on Vercel), so
    // the extra latency is at most ~3 s.
    const side = [];
    // Owner push and funnel purchase only for a fresh insert, not for a duplicate
    // re-delivery (2xx + [] ignored row, or 409/23505).
    if (!recorded.duplicate) {
      side.push(notifyOwner(recorded.row));
      // Link buyer email ↔ browsing session (funnel identity).
      side.push(linkFunnelIdentity(s));
    }

    // Meta Conversions API (server-side, accurate ROI). Deduplicated by event_id.
    if (process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN) {
      side.push(
        sideFetch(
          `https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_CAPI_TOKEN}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: [
                {
                  event_name: 'Purchase',
                  event_time: Math.floor(Date.now() / 1000),
                  action_source: 'website',
                  event_source_url: 'https://karmilaven.com/',
                  event_id:
                    (s.metadata && s.metadata.event_id) || s.client_reference_id || s.id,
                  user_data: {
                    em: sha(d.email),
                    ph: sha((d.phone || '').replace(/\D/g, '')),
                  },
                  custom_data: { value, currency },
                },
              ],
            }),
          },
        ).catch((e) => console.warn('[stripe-webhook] Meta CAPI failed (non-fatal):', e.message)),
      );
    }

    // GA4 Measurement Protocol (server-side). Deduplicated by transaction_id.
    if (process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET) {
      side.push(
        sideFetch(
          `https://www.google-analytics.com/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`,
          {
            method: 'POST',
            body: JSON.stringify({
              client_id: s.id,
              events: [{ name: 'purchase', params: { currency, value, transaction_id: s.id } }],
            }),
          },
        ).catch((e) => console.warn('[stripe-webhook] GA4 failed (non-fatal):', e.message)),
      );
    }

    await Promise.allSettled(side);
    return res.status(200).json({ received: true });
  }

  // ── charge.refunded → reverse stock + mark order refunded in ops v2 ──────────
  // Fires on every Stripe refund (full or partial). We forward the charge's
  // payment_intent → resolve session_id from the charge object, pass line items
  // (reconstructed from the original session) to the ops refund endpoint.
  // The ops RPC fn_online_refund_event is idempotent — same charge_id+barcode
  // can be sent multiple times safely.
  if (event.type === 'charge.refunded') {
    try {
      await handleRefund(event.data.object);
    } catch (e) {
      console.error('[stripe-webhook] charge.refunded NOT synced to ops v2, returning 500 for retry:', event.id, e.message);
      return res.status(500).json({ error: 'refund sync failed; retry' });
    }
  }

  res.status(200).json({ received: true });
}
