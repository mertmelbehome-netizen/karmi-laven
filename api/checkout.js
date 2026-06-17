import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET);
const UNIT = 299; // £2.99 launch unit price (pence) — never raised; value rises via quantity/bundles
const FREE_SHIP_P = 1500; // free UK shipping at £15 subtotal
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items, event_id } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'empty cart' });
    let hasFiveBundle = false;
    const line_items = items.map(it => {
      if (it && it.bundle) {
        const n = Math.max(1, Math.min(15, parseInt(it.n) || 1));
        if (n >= 5) hasFiveBundle = true;
        const cols = Array.isArray(it.cols) ? it.cols.slice(0, n).join(', ') : '';
        const amount = Math.max(UNIT, Math.round((parseFloat(it.price) || 0) * 100)); // bundle tier price (pence)
        return {
          price_data: { currency: 'gbp', unit_amount: amount,
            product_data: { name: `Karmi Laven — ${n}-bracelet bundle${cols ? ` (${cols})` : ''}`.slice(0, 240) } },
          quantity: 1,
        };
      }
      return {
        price_data: { currency: 'gbp', unit_amount: UNIT, product_data: { name: `Karmi Laven — ${String(it.name).slice(0, 80)}` } },
        quantity: Math.max(1, Math.min(99, parseInt(it.qty) || 1)),
      };
    });
    const subtotal = line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0);
    const freeShip = subtotal >= FREE_SHIP_P || hasFiveBundle;
    const shipping_options = [ freeShip
      ? { shipping_rate_data: { display_name: 'Free UK shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } }
      : { shipping_rate_data: { display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: { amount: 345, currency: 'gbp' }, delivery_estimate:{minimum:{unit:'business_day',value:2},maximum:{unit:'business_day',value:5}} } } ];
    const origin = req.headers.origin || 'https://karmilaven.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // payment_method_types intentionally omitted → Stripe Checkout auto-enables cards + Apple Pay / Google Pay
      line_items, shipping_options,
      shipping_address_collection: { allowed_countries: ['GB'] },
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      client_reference_id: event_id || undefined,
      metadata: { event_id: event_id || '' },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
