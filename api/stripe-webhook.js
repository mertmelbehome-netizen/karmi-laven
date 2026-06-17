import Stripe from 'stripe';
import crypto from 'crypto';
const stripe = new Stripe(process.env.STRIPE_SECRET);
export const config = { api: { bodyParser: false } };
async function buffer(req){ const c=[]; for await (const x of req) c.push(typeof x==='string'?Buffer.from(x):x); return Buffer.concat(c); }
const sha=v=>v?crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex'):undefined;
export default async function handler(req, res) {
  let event;
  try { const buf=await buffer(req); event=stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const value = (s.amount_total || 0) / 100, currency = (s.currency || 'gbp').toUpperCase();
    const d = s.customer_details || {};
    // Meta Conversions API (server-side, accurate ROI)
    if (process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN) {
      await fetch(`https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_CAPI_TOKEN}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ data:[{ event_name:'Purchase', event_time:Math.floor(Date.now()/1000), action_source:'website',
          event_source_url:'https://karmilaven.com/', event_id:(s.metadata&&s.metadata.event_id)||s.client_reference_id||s.id,
          user_data:{ em:sha(d.email), ph:sha((d.phone||'').replace(/\D/g,'')) },
          custom_data:{ value, currency } }] })
      }).catch(()=>{});
    }
    // GA4 Measurement Protocol (server-side)
    if (process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET) {
      await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`, {
        method:'POST', body: JSON.stringify({ client_id:s.id, events:[{ name:'purchase', params:{ currency, value, transaction_id:s.id } }] })
      }).catch(()=>{});
    }
  }
  res.status(200).json({ received: true });
}
