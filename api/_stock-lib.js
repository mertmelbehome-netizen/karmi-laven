// api/_stock-lib.js — shared "how many can we sell online" maths for /api/stock and /api/checkout.
// (Files starting with "_" in api/ are not deployed as routes by Vercel.)
//
//   available(bc) = WAT stockroom_count − ONLINE_STOCKROOM_BUFFER − holds(bc), floored at 0
//   holds(bc)     = qty of bc on online_orders with status='paid' (not yet fulfilled), store WAT
// display_count is excluded on purpose: online orders ship from the WAT stockroom only.

export const STORE = 'WAT';
// The last 1–2 units per barcode often can't be found when picking, so they are never offered online.
export const ONLINE_STOCKROOM_BUFFER = 3;

/** Pure: the available map from raw rows. bcToPid {bc: pid}, slMap {pid: stockroom}, orders [{items:[{bc,qty}]}]. */
export function computeAvailable(barcodes, bcToPid, slMap, orders) {
  const holds = {};
  for (const o of orders || []) {
    const items = Array.isArray(o && o.items) ? o.items : [];
    for (const it of items) {
      const bc = it && it.bc != null ? String(it.bc).trim() : '';
      const qty = it && Number(it.qty) > 0 ? Number(it.qty) : 0;
      if (bc) holds[bc] = (holds[bc] || 0) + qty;
    }
  }
  const stock = {};
  for (const bc of barcodes) {
    const pid = bcToPid[bc];
    const onHand = pid != null ? (slMap[pid] || 0) : 0;
    stock[bc] = Math.max(0, onHand - ONLINE_STOCKROOM_BUFFER - (holds[bc] || 0));
  }
  return stock;
}

/**
 * Available qty for a short list of barcodes (≤ 200), read from the ops-v2 database with the service key.
 * Returns { ok: true, stock } or { ok: false, error } (env missing / DB error). Holds failing is non-fatal
 * (same as /api/stock: slightly over-show rather than hide everything).
 */
export async function fetchAvailable(barcodes, { base, key, fetchImpl = fetch } = {}) {
  const want = [...new Set((barcodes || []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 200);
  if (!base || !key) return { ok: false, error: 'ops supabase env not set' };
  if (!want.length) return { ok: true, stock: {} };
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const q = (path) => fetchImpl(`${base}/rest/v1/${path}`, { headers: H });
  try {
    const pbRes = await q(`product_barcodes?select=barcode,product_id&barcode=in.(${want.map(encodeURIComponent).join(',')})&limit=500`);
    if (!pbRes.ok) throw new Error(`product_barcodes ${pbRes.status}`);
    const bcToPid = {};
    const pids = new Set();
    for (const r of await pbRes.json()) { bcToPid[r.barcode] = r.product_id; pids.add(r.product_id); }
    const slMap = {};
    if (pids.size) {
      const slRes = await q(`stock_levels?product_id=in.(${[...pids].join(',')})&store_id=eq.${STORE}&select=product_id,stockroom_count`);
      if (!slRes.ok) throw new Error(`stock_levels ${slRes.status}`);
      for (const r of await slRes.json()) slMap[r.product_id] = r.stockroom_count || 0;
    }
    let orders = [];
    const ooRes = await q(`online_orders?status=eq.paid&store_id=eq.${STORE}&select=items&limit=5000`);
    if (ooRes.ok) orders = await ooRes.json();
    return { ok: true, stock: computeAvailable(want, bcToPid, slMap, orders) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Pure: which barcodes in the cart ask for more than is available. cartQty {bc: qty}. Unknown barcodes (no row)
 * count as 0 available. Returns [{ bc, requested, available }] (empty = all fine).
 */
export function shortages(cartQty, stock) {
  const out = [];
  for (const [bc, requested] of Object.entries(cartQty)) {
    const available = stock[bc] != null ? stock[bc] : 0;
    if (requested > available) out.push({ bc, requested, available });
  }
  return out;
}
