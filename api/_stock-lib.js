// api/_stock-lib.js — shared "how many can we sell online" maths for /api/stock and /api/checkout.
// (Files starting with "_" in api/ are not deployed as routes by Vercel.)
//
//   available(bc) = WAT display_count + WAT stockroom_count − ONLINE_STOCKROOM_BUFFER − holds(bc), floored at 0   (owner 27 Nov 2026: display + hub)
//   holds(bc)     = qty of bc on online_orders with status='paid' (not yet fulfilled), store WAT
// display_count counts since 27 Nov 2026 (ONLINE_COUNTS_DISPLAY). The buffer stays until the owner decides.

export const STORE = 'WAT';   // owner 27 Nov 2026 (rule §19): the DISPLAY rule below is measured in this one store; change it here only
// The last 1–2 units per barcode often can't be found when picking, so they are never offered online.
export const ONLINE_STOCKROOM_BUFFER = 3;
export const ONLINE_COUNTS_DISPLAY = true;   // owner 27 Nov 2026: sellable = display + stockroom (− buffer − holds); false = the old stockroom-only maths

/** Owner rule 27 Nov 2026: only products with BOTH display stock and stockroom stock in STORE are shown / sold online.
 *  Pure. dispMap {pid: display_count}, slMap {pid: stockroom_count}. Hidden (false) only on affirmative evidence: a WAT stock row with display <= 0 or stockroom <= 0. */
export function shownMap(barcodes, bcToPid, dispMap, slMap) {
  const shown = {};
  for (const bc of barcodes) {
    const pid = bcToPid[bc];
    if (pid == null || slMap[pid] === undefined) { shown[bc] = true; continue; }   // no evidence either way (unmapped barcode / no WAT stock row): never hide on a guess; available / the caps check already give 0
    const d = dispMap[pid];   // a stock row without a display_count field at all (older fixtures) = unknown, not 0
    shown[bc] = (d === undefined ? true : d > 0) && slMap[pid] > 0;
  }
  return shown;
}

/** Pure: the available map from raw rows. bcToPid {bc: pid}, slMap {pid: stockroom}, orders [{items:[{bc,qty}]}]. */
export function computeAvailable(barcodes, bcToPid, slMap, orders, dispMap) {
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
    const onHand = pid != null ? (slMap[pid] || 0) + (ONLINE_COUNTS_DISPLAY && dispMap ? Math.max(0, dispMap[pid] || 0) : 0) : 0;
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
    const slMap = {}, dispMap = {};
    if (pids.size) {
      const slRes = await q(`stock_levels?product_id=in.(${[...pids].join(',')})&store_id=eq.${STORE}&select=product_id,stockroom_count,display_count`);
      if (!slRes.ok) throw new Error(`stock_levels ${slRes.status}`);
      for (const r of await slRes.json()) { slMap[r.product_id] = r.stockroom_count || 0; if (r.display_count !== undefined) dispMap[r.product_id] = r.display_count || 0; }
    }
    let orders = [];
    const ooRes = await q(`online_orders?status=eq.paid&store_id=eq.${STORE}&select=items&limit=5000`);
    if (ooRes.ok) orders = await ooRes.json();
    return { ok: true, stock: computeAvailable(want, bcToPid, slMap, orders, dispMap), shown: shownMap(want, bcToPid, dispMap, slMap) };
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
