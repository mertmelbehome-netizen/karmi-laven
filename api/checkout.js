import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET);
const UNIT = 299; // £2.99 launch unit price (pence) — never raised; value rises via quantity
const FREE_SHIP_P = 1200; // free UK shipping at £12 subtotal (or 5+ bracelets)
// multi-buy ladder (pence): cheapest combo applied automatically by total quantity
const DENOMS = [[5, 1200], [3, 750], [2, 550], [1, 299]];
function bestPriceP(q) {
  if (q <= 0) return 0;
  const dp = [0];
  for (let i = 1; i <= q; i++) { dp[i] = Infinity; for (const [d, c] of DENOMS) if (d <= i) dp[i] = Math.min(dp[i], dp[i - d] + c); }
  return dp[q];
}
const clampN = n => Math.max(1, Math.min(99, parseInt(n) || 1));
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items, event_id } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'empty cart' });

    // Expand cart to one entry per bracelet, preserving barcode for ops-v2 mapping.
    // Supports legacy {bundle,n,cols} and {name,qty}; new shape adds {bc,name,qty}.
    const units = [];
    items.forEach(it => {
      if (!it) return;
      if (it.bundle) {
        const n = clampN(it.n);
        const cols = Array.isArray(it.cols) ? it.cols : [];
        for (let i = 0; i < n; i++) units.push({ bc: '', name: cols[i] || 'Crystal bracelet' });
      } else {
        const qn = clampN(it.qty);
        const bc = it.bc != null ? String(it.bc).trim() : '';
        const name = (it.name || 'Crystal bracelet').toString().slice(0, 60);
        for (let i = 0; i < qn; i++) units.push({ bc, name });
      }
    });
    if (!units.length) return res.status(400).json({ error: 'empty cart' });
    if (units.length > 99) units.length = 99; // hard cap

    const totalQty = units.length;
    const amount = Math.max(UNIT, bestPriceP(totalQty)); // total charge in pence (multi-buy ladder)

    // Distribute the bundle total across bracelets so line items sum EXACTLY to `amount`.
    // base price each, then spread the leftover pennies one-per-bracelet onto the first `rem`.
    const base = Math.floor(amount / totalQty);
    const rem = amount - base * totalQty; // 0 .. totalQty-1
    units.forEach((u, i) => { u.price = base + (i < rem ? 1 : 0); });

    // Group into Stripe line items by (barcode, name, price) — at most 2 lines per barcode
    // (base and base+1), so each colour/barcode is its own visible line.
    const groups = new Map();
    units.forEach(u => {
      const key = `${u.bc}|${u.name}|${u.price}`;
      const g = groups.get(key) || { bc: u.bc, name: u.name, price: u.price, qty: 0 };
      g.qty++; groups.set(key, g);
    });
    const line_items = [...groups.values()].map(g => ({
      price_data: { currency: 'gbp', unit_amount: g.price, product_data: { name: g.bc ? `${g.bc} · ${g.name}` : g.name } },
      quantity: g.qty,
    }));

    // Barcode breakdown for ops — authoritative, parse-free mapping (also survives in webhook).
    const bcMap = new Map();
    units.forEach(u => {
      const k = u.bc || u.name;
      const e = bcMap.get(k) || { bc: u.bc, name: u.name, qty: 0 };
      e.qty++; bcMap.set(k, e);
    });
    const bcList = [...bcMap.values()];
    const itemsCsv = bcList.map(e => `${e.bc || '?'}x${e.qty}`).join(',').slice(0, 480);
    const itemsNamed = bcList.map(e => `${e.bc || '?'} ${e.name} x${e.qty}`).join(' | ').slice(0, 480);

    const freeShip = amount >= FREE_SHIP_P || totalQty >= 5;
    const shipping_options = [ freeShip
      ? { shipping_rate_data: { display_name: 'Free UK shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } }
      : { shipping_rate_data: { display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: { amount: 282, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } } ];
    const origin = req.headers.origin || 'https://karmilaven.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // payment_method_types omitted → Stripe Checkout auto-enables cards + Apple/Google Pay
      line_items, shipping_options,
      // Abandoned-checkout recovery: capture the email on the hosted page, create a
      // Customer, and let Stripe email a recovery link back to the prefilled cart when
      // the session expires. NOTE: owner must toggle "recovery emails" ON in the Stripe
      // Dashboard (Settings → Checkout & Payment Links → Manage recovery emails).
      customer_creation: 'always',
      after_expiration: { recovery: { enabled: true, allow_promotion_codes: true } },
      // NOTE: consent_collection.promotions is NOT available for GB/UK Stripe accounts
      // (Stripe rejects the session create → checkout 500 → no orders). Removed 2026-07-03.
      shipping_address_collection: { allowed_countries: ['GB'] },
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      client_reference_id: event_id || undefined,
      metadata: { event_id: event_id || '', qty: String(totalQty), items: itemsCsv, items_named: itemsNamed },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
