// /api/stock.js — LIVE WAT stock for the Karmi Laven storefront.
//
// Returns, per Karmi barcode, the qty AVAILABLE to sell online:
//   available = stockroom_count  (WAT STOCKROOM ONLY)  −  holds
//   holds     = qty on paid-but-not-yet-fulfilled online_orders (reserved, unpaid-risk
//               removed: only status='paid' counts, 'fulfilled'/'cancelled' don't)
//
// NOTE: display_count is intentionally excluded — online orders ship from the WAT
// stockroom only. Display stock is on the shop floor and must not be counted as
// available to sell online.
//
// Source of truth (shared ops v2 Supabase):
//   product_barcodes.barcode  →  product_id        (karmi barcodes are MULTI-barcode,
//                                                    they do NOT live on products.barcode)
//   stock_levels(product_id, store_id='WAT')       →  stockroom_count  (display_count excluded)
//   online_orders(status='paid', store_id='WAT')   →  items[].{bc,qty}  = holds
//
// Service-role key stays server-side (Vercel env). Never shipped to the browser.
//
// Response: { ok:true, store:'WAT', stock:{ "<barcode>": <available_int>, ... }, ts:<iso> }

const STORE = 'WAT';

// Safety buffer subtracted from WAT stockroom per SKU before exposing online:
// the last 1–2 units per barcode often can't physically be located when picking
// ("gözükmesine rağmen stockroomdan çıkmıyor"), so both the sellable qty AND the
// catalogue in-stock flag are driven by (stockroom − buffer − holds).
const ONLINE_STOCKROOM_BUFFER = 3;

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
    //    otherwise we resolve everything that has WAT stockroom stock (via join, avoids
    //    building an oversized URL with 1500+ product_id UUIDs).
    const want = (req.query?.bc || '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);

    // 2) barcode → product_id  AND  product_id → stockroom_count
    //
    // Two strategies depending on whether caller supplied ?bc= filters:
    //
    //   A) ?bc= supplied (normal storefront call): fetch product_barcodes for those
    //      barcodes only (small list), then fetch stock_levels for those product_ids.
    //      We must keep the bc filter small enough that the product_id in() list is
    //      well under HTTP query-string limits.
    //
    //   B) No ?bc= filter (admin/debug): use a PostgREST join to pull WAT stock_levels
    //      with embedded products→product_barcodes in a single request, avoiding the
    //      giant in() URL that causes a 400 error at ~1500 products.

    const bcToPid = {};
    const slMap   = {};

    if (want.length) {
      // --- Strategy A: filtered by barcode ---
      const pbRes = await q(
        `product_barcodes?select=barcode,product_id&barcode=in.(${want.map(encodeURIComponent).join(',')})&limit=500`
      );
      if (!pbRes.ok) throw new Error(`product_barcodes ${pbRes.status}`);
      const pb = await pbRes.json();
      const pids = new Set();
      for (const r of pb) { bcToPid[r.barcode] = r.product_id; pids.add(r.product_id); }

      if (pids.size) {
        // Fetch stockroom_count only — display_count is excluded by design.
        // Online orders ship from the WAT stockroom; display stock is on the shop floor.
        const pidList = [...pids].join(',');
        const slRes = await q(
          `stock_levels?product_id=in.(${pidList})&store_id=eq.${STORE}&select=product_id,stockroom_count`
        );
        if (!slRes.ok) throw new Error(`stock_levels ${slRes.status}`);
        for (const r of await slRes.json()) {
          slMap[r.product_id] = r.stockroom_count || 0;
        }
      }
    } else {
      // --- Strategy B: no bc filter — use join to avoid oversized URL ---
      // stock_levels → products (FK) → product_barcodes (FK)
      // Returns { product_id, stockroom_count, products: { product_barcodes: [{barcode}] } }
      // Limit 2000 covers all WAT rows; stock_levels is bounded per-store.
      const slRes = await q(
        `stock_levels?store_id=eq.${STORE}&select=product_id,stockroom_count,products(product_barcodes(barcode))&limit=2000`
      );
      if (!slRes.ok) throw new Error(`stock_levels(join) ${slRes.status}`);
      for (const r of await slRes.json()) {
        slMap[r.product_id] = r.stockroom_count || 0;
        const barcodes = r.products?.product_barcodes ?? [];
        for (const b of barcodes) {
          if (b.barcode) bcToPid[b.barcode] = r.product_id;
        }
      }
    }

    // 3) holds — sum qty on paid (un-fulfilled) online orders for this store, per barcode
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

    // 4) available = WAT stockroom_count − safety buffer − holds, floored at 0
    const stock = {};
    const keys = want.length ? want : Object.keys(bcToPid);
    for (const bc of keys) {
      const pid = bcToPid[bc];
      const onHand = pid != null ? (slMap[pid] || 0) : 0;
      const held = holds[bc] || 0;
      stock[bc] = Math.max(0, onHand - ONLINE_STOCKROOM_BUFFER - held);
    }

    return res.status(200).json({ ok: true, store: STORE, stock, ts: new Date().toISOString() });
  } catch (e) {
    // Fail OPEN on any error: empty stock + ok:false → storefront shows all products.
    return res.status(200).json({ ok: false, store: STORE, stock: {}, error: String(e.message || e) });
  }
}
