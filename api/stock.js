// /api/stock.js — LIVE WAT stock for the Karmi Laven storefront.
//
// Returns, per Karmi barcode, the qty AVAILABLE to sell online:
//   available = stockroom_count + display_count  (WAT)  −  holds
//   holds     = qty on paid-but-not-yet-fulfilled online_orders (reserved, unpaid-risk
//               removed: only status='paid' counts, 'fulfilled'/'cancelled' don't)
//
// Source of truth (shared ops v2 Supabase):
//   product_barcodes.barcode  →  product_id        (karmi barcodes are MULTI-barcode,
//                                                    they do NOT live on products.barcode)
//   stock_levels(product_id, store_id='WAT')       →  stockroom_count + display_count
//   online_orders(status='paid', store_id='WAT')   →  items[].{bc,qty}  = holds
//
// Service-role key stays server-side (Vercel env). Never shipped to the browser.
//
// Response: { ok:true, store:'WAT', stock:{ "<barcode>": <available_int>, ... }, ts:<iso> }

const STORE = 'WAT';

export default async function handler(req, res) {
  // short edge/browser cache — stock changes are not second-critical, and this
  // shields the DB from every page load. 30s fresh, 60s stale-while-revalidate.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*'); // GET-only public read, no secrets in payload

  const base = process.env.OPS_SUPABASE_URL;
  const key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    // Fail OPEN: if mis-configured, return empty stock map so the site shows all
    // products rather than hiding the catalogue. ok:false signals "no live data".
    return res.status(200).json({ ok: false, store: STORE, stock: {}, error: 'ops supabase env not set' });
  }

  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const q = (path) => fetch(`${base}/rest/v1/${path}`, { headers: H });

  try {
    // 1) Which barcodes to report? The caller may pass ?bc=a,b,c (the storefront does);
    //    otherwise we resolve everything that has a product_barcodes row (bounded fetch).
    const want = (req.query?.bc || '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);

    // 2) barcode → product_id
    const pbFilter = want.length ? `&barcode=in.(${want.map(encodeURIComponent).join(',')})` : '';
    const pbRes = await q(`product_barcodes?select=barcode,product_id${pbFilter}&limit=2000`);
    if (!pbRes.ok) throw new Error(`product_barcodes ${pbRes.status}`);
    const pb = await pbRes.json();
    const bcToPid = {};
    const pids = new Set();
    for (const r of pb) { bcToPid[r.barcode] = r.product_id; pids.add(r.product_id); }

    // 3) WAT stock_levels for those products
    const slMap = {};
    if (pids.size) {
      const pidList = [...pids].join(',');
      const slRes = await q(`stock_levels?product_id=in.(${pidList})&store_id=eq.${STORE}&select=product_id,stockroom_count,display_count`);
      if (!slRes.ok) throw new Error(`stock_levels ${slRes.status}`);
      for (const r of await slRes.json()) {
        slMap[r.product_id] = (r.stockroom_count || 0) + (r.display_count || 0);
      }
    }

    // 4) holds — sum qty on paid (un-fulfilled) online orders for this store, per barcode
    const holds = {};
    const ooRes = await q(`online_orders?status=eq.paid&store_id=eq.${STORE}&select=items&limit=5000`);
    if (ooRes.ok) {
      for (const o of await ooRes.json()) {
        const items = Array.isArray(o.items) ? o.items : [];
        for (const it of items) {
          const bc = it && it.bc != null ? String(it.bc).trim() : '';
          const qty = it && Number(it.qty) > 0 ? Number(it.qty) : 0;
          if (bc) holds[bc] = (holds[bc] || 0) + qty;
        }
      }
    } // holds failure is non-fatal — better to slightly over-show than hide everything

    // 5) available = on-hand − holds, floored at 0
    const stock = {};
    const keys = want.length ? want : Object.keys(bcToPid);
    for (const bc of keys) {
      const pid = bcToPid[bc];
      const onHand = pid != null ? (slMap[pid] || 0) : 0;
      const held = holds[bc] || 0;
      stock[bc] = Math.max(0, onHand - held);
    }

    return res.status(200).json({ ok: true, store: STORE, stock, ts: new Date().toISOString() });
  } catch (e) {
    // Fail OPEN on any error: empty stock + ok:false → storefront shows all products.
    return res.status(200).json({ ok: false, store: STORE, stock: {}, error: String(e.message || e) });
  }
}
