import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { fetchAvailable, shortages } from './_stock-lib.js';
import { GRADIENT, isGradient } from './_gradient.js';
import { priceUnits, freeShipping, shippingFeeP, LADDERS, MODE_GROUPS, previewLadders, previewAllowed, lineGroup, cartSummary } from './_pricing.js';
import { reserve, attach, release, gradientFallback, resolveStaleHolds, MSG_UNAVAILABLE } from './_caps-lib.js';

const clampN = n => Math.max(1, Math.min(99, parseInt(n) || 1));
export const MSG_PRICING_UNAVAILABLE = 'Checkout is unavailable right now, please try again shortly.';

// Prices are decided HERE, never by the browser (22 Nov 2026, owner decision 1):
//   Gradient Edit (api/_gradient.js) -> the 'gradient' pool of the ladder table (ladders.json; today £2.99 1/2/3/5);
//   any other product               -> its WAT till single price from the DB, admitted by fn_karmi_checkout_reserve
//                                      (caps, stock, Christmas cut-off, 13–15 Dec limit; one locked transaction),
//                                      on the ladder of its price pool when ladders.json has one, else n × single.
// The client's `name` and any price it sends are ignored; Stripe line names come from the server.
// `ladders` (23 Nov 2026): the validated table (api/_pricing.js LADDERS); null = invalid table -> 503, fail closed.
export function createHandler({
  stripe,
  ladders = LADDERS,
  env = () => ({ base: process.env.OPS_SUPABASE_URL, key: process.env.OPS_SUPABASE_SERVICE_KEY }),
  fetchImpl,
  now = () => new Date(),
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    try {
      const { items, event_id, kl_sid, consent } = req.body || {};
      // Cookie consent at checkout time (PECR, 21 Nov 2026). The webhook sends Meta CAPI and the funnel
      // identity link ONLY when this is 'accepted'. Anything else (missing, tampered) = 'none'.
      const consentState = consent === 'accepted' || consent === 'rejected' ? consent : 'none';
      // Funnel session id (from the storefront's localStorage kl_sid). Carried into the
      // Stripe session metadata so the webhook can link the buyer's email ↔ browsing
      // session. Purely additive — never affects pricing, shipping, or the cart.
      const klSid = consentState === 'accepted' && kl_sid != null ? String(kl_sid).trim().slice(0, 120) : '';
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'empty cart' });

      // Expand the cart to one entry per unit, keyed by barcode. Legacy {bundle} / {name,qty} shapes carry no
      // barcode and are refused below (K&D #32).
      const units = [];
      items.forEach(it => {
        if (!it) return;
        if (it.bundle) {
          const n = clampN(it.n);
          for (let i = 0; i < n; i++) units.push({ bc: '' });
        } else {
          const qn = clampN(it.qty);
          const bc = it.bc != null ? String(it.bc).trim().slice(0, 40) : '';
          for (let i = 0; i < qn; i++) units.push({ bc });
        }
      });
      if (!units.length) return res.status(400).json({ error: 'empty cart' });
      if (units.length > 99) units.length = 99; // hard cap
      if (units.some(u => !u.bc)) return res.status(400).json({ error: 'missing_barcode' });
      // PREVIEW-ONLY table (body.ladder / ?ladder=, api/_pricing.js previewLadders): honoured only on a Vercel preview
      // or with KL_LADDER_PREVIEW=1; in production previewLadders() returns null and the default table is used.
      const pv = previewLadders(req.body?.ladder ?? req.query?.ladder);
      if (pv && !pv.ok) return res.status(400).json({ error: 'unknown_ladder', message: pv.error });
      const table = pv ? pv.table : ladders;
      // No valid ladder table = no price we can stand behind: refuse before reserving anything (fail closed).
      if (!table) return res.status(503).json({ error: 'checkout_unavailable', message: MSG_PRICING_UNAVAILABLE });
      const groupMode = table.mode === MODE_GROUPS;

      // PREVIEW-ONLY dry run: price a Gradient-Edit-only bag from the table and return the numbers. No stock read,
      // no reserve, no Stripe. Non-Gradient lines need the DB reserve (group/caps), so they are refused here.
      if (req.body?.dry_run === true && previewAllowed()) {
        units.forEach(u => { u.ladder = isGradient(u.bc); });
        if (units.some(u => !u.ladder)) return res.status(400).json({ error: 'dry_run_gradient_only' });
        let amountP;
        try { amountP = priceUnits(units, table); }
        catch (e) { return res.status(503).json({ error: 'checkout_unavailable', message: MSG_PRICING_UNAVAILABLE, detail: e.message }); }
        const lines = new Map();
        units.forEach(u => { const k = `${u.bc}|${u.price}`; const l = lines.get(k) || { bc: u.bc, unit_amount: u.price, quantity: 0 }; l.quantity++; lines.set(k, l); });
        return res.status(200).json({
          ok: true, dry_run: true, ladder: table.version, mode: table.mode || 'pools', units: units.length,
          amount_pence: amountP, shipping_pence: shippingFeeP(amountP, units.length, table),
          line_items: [...lines.values()],
          summary: groupMode ? cartSummary(units.map(u => ({ ladder: true })), table) : null,
        });
      }

      const db = { ...env(), ...(fetchImpl ? { fetchImpl } : {}) };
      const cartQty = {};
      units.forEach(u => { u.ladder = isGradient(u.bc); cartQty[u.bc] = (cartQty[u.bc] || 0) + 1; });
      const gradQty = {}, otherQty = {};
      for (const [bc, q] of Object.entries(cartQty)) (isGradient(bc) ? gradQty : otherQty)[bc] = q;
      const gradientUnits = units.filter(u => u.ladder).length;
      const hasOther = Object.keys(otherQty).length > 0;

      // 1) Gradient Edit stock (21 Nov 2026, unchanged): stockroom − buffer − paid holds; 409 trims the bag.
      //    Fail OPEN when the stock data cannot be read: a short outage must not stop Gradient Edit sales.
      if (gradientUnits) {
        const av = await fetchAvailable(Object.keys(gradQty), db);
        if (av.ok) {
          const short = shortages(gradQty, av.stock);
          if (short.length) return res.status(409).json({ error: 'out_of_stock', items: short });
        } else {
          console.warn('checkout stock check skipped (fail open):', av.error);
        }
      }

      // 2) Admission: Christmas cut-off + 13–15 Dec limit (all carts), caps/stock/WAT price (non-Gradient units).
      //    First settle holds whose Stripe session ended but whose outcome is not known yet (late / failed webhook):
      //    a paid one keeps counting, an expired one is freed (F1). Best effort; unknown ones keep counting.
      //    N2: at most 3 sessions, 2.5 s per Stripe call, 3 at once, and the whole step returns within its budget
      //    (1.5 s for a Gradient-only cart, so a slow Stripe never holds it up); unanswered holds keep counting.
      try { await resolveStaleHolds(stripe, db, { max: 3, budgetMs: hasOther ? 3000 : 1500 }); }
      catch (e) { console.warn('checkout hold resolver skipped:', e.message); }
      const ref = randomUUID();
      const rv = await reserve(ref, otherQty, gradientUnits, db);
      let held = false, shortSession = false, recoveryOk = false;
      const lineByBc = {};
      if (rv.ok && rv.data && typeof rv.data === 'object' && typeof rv.data.ok === 'boolean') {
        const d = rv.data;
        if (!d.ok) {
          if (d.error === 'not_available') return res.status(409).json({ error: 'not_available', message: d.message, items: d.items || [] });
          if (d.error === 'closed' || d.error === 'limit_reached') return res.status(403).json({ error: d.error, message: d.message });
          return res.status(400).json({ error: d.error || 'bad_request' });
        }
        held = true;
        shortSession = !!d.short_session;
        recoveryOk = !!d.recovery_ok;
        for (const l of d.lines || []) lineByBc[l.bc] = l;
      } else {
        console.warn('checkout caps check failed:', rv.error || 'unexpected response');
        // Fail CLOSED for capped families; Gradient-only carts keep the old fail-open rule outside the Christmas window.
        if (hasOther) return res.status(503).json({ error: 'stock_unavailable', message: MSG_UNAVAILABLE });
        const fb = gradientFallback(now());
        if (!fb.ok) return res.status(503).json({ error: 'checkout_unavailable', message: fb.message });
        recoveryOk = fb.recoveryOk;
      }

      // 3) Price every unit on the server. A non-Gradient unit needs a DB line with a price and a name, else refuse.
      for (const u of units) {
        if (u.ladder) { u.name = GRADIENT[u.bc]; continue; }
        const l = lineByBc[u.bc];
        if (!l || !Number.isInteger(l.price_pence) || l.price_pence <= 0 || !l.name) {
          if (held) await release(ref, db);
          return res.status(503).json({ error: 'stock_unavailable', message: MSG_UNAVAILABLE });
        }
        u.unitP = l.price_pence;
        u.name = String(l.name).slice(0, 60);
        if (groupMode) {
          // cart_qty_groups: the ONLINE group price replaces the till price; no group = not priced (fail closed).
          u.group = lineGroup(l, table);
          if (!u.group) {
            if (held) await release(ref, db);
            return res.status(503).json({ error: 'pricing_unavailable', message: MSG_PRICING_UNAVAILABLE });
          }
        }
      }
      let amount;
      if (groupMode) {
        try { amount = priceUnits(units, table); }
        catch (e) {
          if (held) await release(ref, db);
          return res.status(503).json({ error: 'pricing_unavailable', message: MSG_PRICING_UNAVAILABLE });
        }
      } else {
        amount = priceUnits(units, table);
      }
      const totalQty = units.length;

      // Group into Stripe line items by (barcode, name, price). Line name "{bc} · {name}" is parsed by the webhook.
      const groups = new Map();
      units.forEach(u => {
        const key = `${u.bc}|${u.name}|${u.price}`;
        const g = groups.get(key) || { bc: u.bc, name: u.name, price: u.price, qty: 0 };
        g.qty++; groups.set(key, g);
      });
      const line_items = [...groups.values()].map(g => ({
        price_data: { currency: 'gbp', unit_amount: g.price, product_data: { name: `${g.bc} · ${g.name}` } },
        quantity: g.qty,
      }));

      // Barcode breakdown for ops — authoritative, parse-free mapping (also survives in webhook).
      const bcMap = new Map();
      units.forEach(u => {
        const en = bcMap.get(u.bc) || { bc: u.bc, name: u.name, qty: 0 };
        en.qty++; bcMap.set(u.bc, en);
      });
      const bcList = [...bcMap.values()];
      const itemsCsv = bcList.map(x => `${x.bc}x${x.qty}`).join(',').slice(0, 480);
      const itemsNamed = bcList.map(x => `${x.bc} ${x.name} x${x.qty}`).join(' | ').slice(0, 480);

      const freeShip = freeShipping(amount, totalQty, table);
      const shipping_options = [ freeShip
        ? { shipping_rate_data: { display_name: 'Free UK shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } }
        : { shipping_rate_data: { display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: { amount: shippingFeeP(amount, totalQty, table), currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } } ];
      const origin = req.headers.origin || 'https://karmilaven.com';
      // Promotion codes apply to the whole Stripe session, so they stay on ONLY for Gradient-Edit-only carts
      // (plan §3.3 / K&D 3b).
      // Recovery links (command centre, 22 Nov): Stripe re-creates a recovered session ITSELF from after_expiration,
      // and this hosted-Checkout integration has no server hook between that re-creation and payment (the first
      // server event is checkout.session.completed, after the money is taken). So a recovered session cannot be
      // re-validated before payment. So: recovery OFF for carts with a capped (non-Gradient) product; Gradient-only
      // carts keep recovery, except for sessions CREATED from karmi_online_window.recovery_off_from (13 Dec 00:00
      // London) — no recovery link is issued in the cut-off window. A link issued earlier and paid late is flagged
      // for manual handling by the webhook (fn_karmi_flag_late_order), never auto-refunded.
      // cart_qty_groups (preview only): no promotion code on top of the 10+ price (05_pr_scope §(6) option i; K-046).
      const gradientOnly = !hasOther && !(groupMode && totalQty >= table.tierFrom);
      const params = {
        mode: 'payment',
        // payment_method_types omitted → Stripe Checkout auto-enables cards + Apple/Google Pay
        line_items, shipping_options,
        customer_creation: 'always',
        // NOTE: consent_collection.promotions is NOT available for GB/UK Stripe accounts
        // (Stripe rejects the session create → checkout 500 → no orders). Removed 2026-07-03.
        shipping_address_collection: { allowed_countries: ['GB'] },
        phone_number_collection: { enabled: true },
        allow_promotion_codes: gradientOnly,
        client_reference_id: event_id || undefined,
        metadata: { event_id: event_id || '', qty: String(totalQty), items: itemsCsv, items_named: itemsNamed, kl_sid: klSid, consent: consentState, hold_ref: held ? ref : '' },
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancel`,
      };
      // Abandoned-checkout recovery: owner toggles "recovery emails" in the Stripe Dashboard.
      params.after_expiration = gradientOnly && recoveryOk
        ? { recovery: { enabled: true, allow_promotion_codes: true } }
        : { recovery: { enabled: false } };
      // A held checkout must not outlive its reservation (holds expire after 40 min; Stripe minimum is 30 min).
      if (shortSession) params.expires_at = Math.floor(now().getTime() / 1000) + 31 * 60;

      let session;
      try {
        session = await stripe.checkout.sessions.create(params);
      } catch (err) {
        if (held) await release(ref, db);
        throw err;
      }
      if (held) await attach(ref, session.id, db); // best effort; the webhook repeats it on completion
      res.status(200).json({ url: session.url });
    } catch (err) { res.status(500).json({ error: err.message }); }
  };
}

export default createHandler({ stripe: new Stripe(process.env.STRIPE_SECRET) });
