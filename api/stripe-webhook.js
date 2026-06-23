import Stripe from 'stripe';
import crypto from 'crypto';
const stripe = new Stripe(process.env.STRIPE_SECRET);
export const config = { api: { bodyParser: false } };
async function buffer(req){ const c=[]; for await (const x of req) c.push(typeof x==='string'?Buffer.from(x):x); return Buffer.concat(c); }
const sha=v=>v?crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex'):undefined;

// Record the paid order into ops v2 (online_orders) so it can be fulfilled from
// the /orders page (stockroom-first WAT decrement). Idempotent on stripe_session_id.
async function recordOrder(s){
  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if(!base || !key) return null;
  // Pull line items to get the per-barcode breakdown + exact line revenue.
  let lineItems = [];
  try { const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100 }); lineItems = li.data || []; }
  catch(e){ /* fall back to metadata below */ }

  // Aggregate by barcode. Line description is "{bc} · {colour}" (set by checkout.js).
  const byBc = new Map();
  for(const li of lineItems){
    const desc = li.description || '';
    const sep = desc.indexOf(' · ');
    const bc = sep>0 ? desc.slice(0,sep).trim() : '';
    const name = sep>0 ? desc.slice(sep+3).trim() : desc;
    const qty = li.quantity || 1;
    const revenue = (li.amount_total||0)/100; // £, ex-shipping, post-discount
    const k = bc || name;
    const e = byBc.get(k) || { bc, name, qty:0, revenue:0 };
    e.qty += qty; e.revenue = Math.round((e.revenue + revenue)*100)/100;
    byBc.set(k, e);
  }
  let items = [...byBc.values()];
  // Fallback to metadata.items ("1077x1,1111x2") if line items were unavailable.
  if(!items.length && s.metadata && s.metadata.items){
    items = s.metadata.items.split(',').map(p=>{ const [bc,q]=p.split('x'); return { bc:(bc||'').trim(), name:'', qty:parseInt(q)||1, revenue:0 }; });
  }

  const d = s.customer_details || {};
  const ship = s.shipping_details || (s.collected_information && s.collected_information.shipping_details) || {};
  const row = {
    source: 'karmilaven',
    stripe_session_id: s.id,
    event_id: (s.metadata && s.metadata.event_id) || s.client_reference_id || null,
    customer_name: ship.name || d.name || null,
    email: d.email || null,
    phone: d.phone || null,
    address: ship.address || d.address || null,
    currency: (s.currency || 'gbp').toUpperCase(),
    amount_total: (s.amount_total||0)/100,
    shipping_total: (s.total_details && s.total_details.amount_shipping ? s.total_details.amount_shipping/100 : 0),
    items,
    store_id: 'WAT',
    status: 'paid',
  };
  try{
    await fetch(`${base}/rest/v1/online_orders`, {
      method:'POST',
      headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Prefer:'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
  }catch(e){ /* swallow — Stripe will retry the webhook */ }

  // Best-effort owner push notification (deep-links to /orders).
  const appUrl = process.env.OPS_APP_URL;
  if(appUrl){
    const n = items.reduce((a,i)=>a+(i.qty||0),0);
    try{
      await fetch(`${appUrl}/api/push/send`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          title:'Yeni online sipariş — Karmi Laven',
          detail:`${n} bileklik · £${row.amount_total.toFixed(2)}${row.customer_name?` · ${row.customer_name}`:''}`,
          severity:'info', store_id:'WAT', url:'/orders',
        }),
      });
    }catch(e){ /* non-fatal */ }
  }
  return row;
}

export default async function handler(req, res) {
  let event;
  try { const buf=await buffer(req); event=stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const value = (s.amount_total || 0) / 100, currency = (s.currency || 'gbp').toUpperCase();
    const d = s.customer_details || {};

    // Record order → ops v2 (stock decrement happens on manual fulfilment)
    await recordOrder(s);

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
