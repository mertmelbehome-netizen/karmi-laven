import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET);
const UNIT = 299; // £2.99 launch price (pence)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'empty cart' });
    const line_items = items.map(it => ({
      price_data: { currency: 'gbp', unit_amount: UNIT, product_data: { name: `Karmi Laven — ${String(it.name).slice(0,80)}` } },
      quantity: Math.max(1, Math.min(15, parseInt(it.qty) || 1)),
    }));
    const subtotal = line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0);
    const origin = req.headers.origin || 'https://karmilaven.com';
    const shipping_options = [ subtotal >= 3000
      ? { shipping_rate_data: { display_name: 'Complimentary UK shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } }
      : { shipping_rate_data: { display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: { amount: 295, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } } ];
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', line_items, shipping_options,
      shipping_address_collection: { allowed_countries: ['GB'] },
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
