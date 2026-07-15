import Stripe from 'stripe';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET);

// NOTE: The "export const config = { api: { bodyParser: false } }" convention is
// Next.js-ONLY and is completely ignored by @vercel/node plain serverless functions.
// @vercel/node adds Express-like helpers that auto-parse req.body, consuming the
// readable stream before our code runs.
//
// FIX: Read raw bytes via event-based Node.js stream API (req.on('data'/'end')).
// This bypasses any middleware parsing and delivers the verbatim bytes Stripe signed.
// Additionally, vercel.json sets "helpers: false" for this route so @vercel/node
// does not pre-populate req.body and does not interfere with the raw stream.
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const sha = (v) =>
  v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;

// Record the paid order into ops v2 (online_orders) so it can be fulfilled from
// the /orders page (stockroom-first WAT decrement). Idempotent on stripe_session_id.
async function recordOrder(s) {
  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    console.warn('[stripe-webhook] recordOrder skipped: OPS_SUPABASE_URL or OPS_SUPABASE_SERVICE_KEY not set');
    return null;
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
  let insertStatus = null;
  let insertBody = null;
  try {
    const resp = await fetch(`${base}/rest/v1/online_orders`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    insertStatus = resp.status;
    // Read body for logging only on non-2xx
    if (!resp.ok) {
      insertBody = await resp.text().catch(() => '(unreadable)');
      console.error('[stripe-webhook] recordOrder ops insert FAILED', insertStatus, insertBody);
    } else {
      console.log('[stripe-webhook] recordOrder ops insert OK', insertStatus);
    }
  } catch (e) {
    console.error('[stripe-webhook] recordOrder fetch error:', e.message);
    // Re-throw so Stripe retries the webhook (non-2xx will trigger retry)
    throw e;
  }

  // Best-effort push notification to owner + currently-clocked-in WAT staff.
  // Uses /api/orders/notify which fans out to owner subscriptions AND any WAT
  // staff whose clock_records row has clock_in set and clock_out null today.
  const appUrl = process.env.OPS_APP_URL;
  if (appUrl) {
    const n = items.reduce((a, i) => a + (i.qty || 0), 0);
    try {
      await fetch(`${appUrl}/api/orders/notify`, {
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
  return row;
}

// Reverse a Stripe refund into ops v2: stock return + order status='refunded'/'partial_refund'.
// charge object: https://stripe.com/docs/api/charges/object
async function handleRefund(charge) {
  const appUrl = process.env.OPS_APP_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!appUrl || !secret) return;

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
    } catch(e) { /* non-fatal */ }
  }
  if (!sessionId) return; // can't tie back to order — skip

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

  try {
    await fetch(`${appUrl}/api/orders/refund`, {
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
  } catch(e) { /* swallow — Stripe will retry the webhook */ }
}

// Link the buyer's email ↔ their anonymous browsing session in ops-v2 funnel_events.
// This is a legit soft opt-in: the customer completed a purchase. Fire-and-forget +
// fully wrapped — it can NEVER affect order recording or the webhook response.
async function linkFunnelIdentity(s) {
  try {
    const email = s.customer_details && s.customer_details.email;
    const klSid = s.metadata && s.metadata.kl_sid;
    if (!email) return; // nothing to link without an email
    await fetch('https://melbehome-ops-v2.vercel.app/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'purchase',
        email,
        session_id: klSid || null,
        cart_value: (s.amount_total || 0) / 100,
      }),
    }).catch(() => {});
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

    // Record order → ops v2 (stock decrement happens on manual fulfilment)
    await recordOrder(s);

    // Link buyer email ↔ browsing session (funnel identity). Fully wrapped, best-effort.
    await linkFunnelIdentity(s);

    // Meta Conversions API (server-side, accurate ROI)
    if (process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN) {
      await fetch(
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
      ).catch((e) => console.warn('[stripe-webhook] Meta CAPI failed (non-fatal):', e.message));
    }

    // GA4 Measurement Protocol (server-side)
    if (process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET) {
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`,
        {
          method: 'POST',
          body: JSON.stringify({
            client_id: s.id,
            events: [{ name: 'purchase', params: { currency, value, transaction_id: s.id } }],
          }),
        },
      ).catch((e) => console.warn('[stripe-webhook] GA4 failed (non-fatal):', e.message));
    }
  }

  // ── charge.refunded → reverse stock + mark order refunded in ops v2 ──────────
  // Fires on every Stripe refund (full or partial). We forward the charge's
  // payment_intent → resolve session_id from the charge object, pass line items
  // (reconstructed from the original session) to the ops refund endpoint.
  // The ops RPC fn_online_refund_event is idempotent — same charge_id+barcode
  // can be sent multiple times safely.
  if (event.type === 'charge.refunded') {
    await handleRefund(event.data.object);
  }

  res.status(200).json({ received: true });
}
