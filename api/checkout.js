import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET);
const UNIT = 299; // £2.99 launch unit price (pence) — never raised; value rises via quantity
const FREE_SHIP_P = 1500; // free UK shipping at £15 subtotal (or 5+ bracelets)
// multi-buy ladder (pence): cheapest combo applied automatically by total quantity
const DENOMS = [[5, 1200], [3, 750], [2, 550], [1, 299]];
function bestPriceP(q) {
  if (q <= 0) return 0;
  const dp = [0];
  for (let i = 1; i <= q; i++) { dp[i] = Infinity; for (const [d, c] of DENOMS) if (d <= i) dp[i] = Math.min(dp[i], dp[i - d] + c); }
  return dp[q];
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items, event_id } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'empty cart' });
    // total bracelet count across the cart (supports legacy {bundle,n} and {name,qty})
    let totalQty = 0; const names = [];
    items.forEach(it => {
      if (it && it.bundle) { const n = Math.max(1, Math.min(99, parseInt(it.n) || 1)); totalQty += n; if (Array.isArray(it.cols)) names.push(...it.cols); }
      else { const qn = Math.max(1, Math.min(99, parseInt(it.qty) || 1)); totalQty += qn; if (it && it.name) names.push(`${it.name}${qn > 1 ? ` ×${qn}` : ''}`); }
    });
    totalQty = Math.max(1, Math.min(99, totalQty));
    const amount = Math.max(UNIT, bestPriceP(totalQty));
    const label = `Karmi Laven — ${totalQty} crystal bracelet${totalQty > 1 ? 's' : ''}${names.length ? ` (${names.join(', ')})` : ''}`.slice(0, 240);
    const line_items = [{ price_data: { currency: 'gbp', unit_amount: amount, product_data: { name: label } }, quantity: 1 }];
    const freeShip = amount >= FREE_SHIP_P || totalQty >= 5;
    const shipping_options = [ freeShip
      ? { shipping_rate_data: { display_name: 'Free UK shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } }
      : { shipping_rate_data: { display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: { amount: 345, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } } ];
    const origin = req.headers.origin || 'https://karmilaven.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // payment_method_types omitted → Stripe Checkout auto-enables cards + Apple/Google Pay
      line_items, shipping_options,
      shipping_address_collection: { allowed_countries: ['GB'] },
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      client_reference_id: event_id || undefined,
      metadata: { event_id: event_id || '', qty: String(totalQty) },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
