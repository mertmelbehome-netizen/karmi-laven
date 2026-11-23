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
// Response: { ok:true, store:'WAT', stock:{ "<barcode>": <available_int>, ... }, ts:<iso>, ladders:{...}|null }
//
// Non-Gradient products (22 Nov 2026, db/20261122230000_karmi_online_caps.sql): for every requested barcode that is
// not in api/_gradient.js the response also carries
//   sellable[bc]     = what the bag may hold now (online caps AND stock; 0 = "Not available online right now")
//   price_pence[bc]  = WAT till single price (the same number /api/checkout charges)
//   stock[bc]        = real WAT stock (product-level), used ONLY for "Only N left" — never the cap
// and window = { open, message } for the Christmas cut-off / limit. These barcodes FAIL CLOSED: if the caps data
// cannot be read they are absent from `sellable` and the page treats them as not sellable.

// STORE, the safety buffer (ONLINE_STOCKROOM_BUFFER) and the maths live in ./_stock-lib.js, shared with /api/checkout
// (server-side stock check, 21 Nov 2026), so the storefront and checkout never disagree.
import { STORE, computeAvailable } from './_stock-lib.js';
import { isGradient, GRADIENT } from './_gradient.js';
import Stripe from 'stripe';
import { status as capsStatus, resolveStaleHolds } from './_caps-lib.js';
import { publicLadders, previewLadders } from './_pricing.js';
import { storefrontConfig } from './_storefront.js';
import { christmasNotice } from './_christmas.js';

// `ladders` (23 Nov 2026, additive): the multi-buy table /api/checkout charges from (ladders.json via
// api/_pricing.js publicLadders(): pools, bundles, tail, totals[q] per pool, shipping, rules, ui). null = the table did not
// validate (checkout then refuses with 503). Every response carries it; existing fields are unchanged.
let defaultLadderView = publicLadders();
/** Test hook: replace the served table view (null = invalid table). */
export function _setLadders(view) { defaultLadderView = view; }

// `storefront` (PR-2, additive): page feature flags from api/_storefront.js. Default { families:false } = today's page.
// Computed per request so a Vercel env change applies on the next cold start without code changes.
const sf = () => storefrontConfig();

// Stripe client for the hold resolver only (F1): created on first use, never when the key is not set.
let stripeClient;
const getStripe = () => (stripeClient !== undefined ? stripeClient
  : (stripeClient = process.env.STRIPE_SECRET ? new Stripe(process.env.STRIPE_SECRET) : null));
/** Test hook: inject a fake Stripe (null = none). */
export function _setStripe(s) { stripeClient = s; }

export default async function handler(req, res) {
  // short edge/browser cache — stock changes are not second-critical, and this
  // shields the DB from every page load. 30s fresh, 60s stale-while-revalidate.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*'); // GET-only public read, no secrets in payload

  // ?ladder=<name>: a PREVIEW-ONLY table (ladders-preview/<name>.json). Honoured only on a Vercel preview
  // (VERCEL_ENV=preview) or with KL_LADDER_PREVIEW=1; in production it is ignored and the default table is served.
  // An unknown/invalid preview table serves ladders: null (the page would treat the table as unavailable).
  const pv = previewLadders(req.query?.ladder);
  const ladderView = pv === null ? defaultLadderView : pv.ok ? publicLadders(pv.table) : null;

  const base = process.env.OPS_SUPABASE_URL;
  const key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    // Fail OPEN: if mis-configured, return empty stock map so the site shows all
    // products rather than hiding the catalogue. ok:false signals "no live data".
    return res.status(200).json({ ok: false, store: STORE, stock: {}, error: 'ops supabase env not set', ladders: ladderView, storefront: sf() });
  }

  // `christmas` (23 Nov 2026, additive): { last_order_date, closes_at, limit_from } from karmi_online_window (api/_christmas.js),
  // read in parallel with the stock reads. Absent when the DB can't be read, there is no window or it has closed: the
  // page then shows no Christmas notice. Every other field is unchanged.
  const xmasP = christmasNotice({ base, key });
  const withXmas = async (b) => { const c = await xmasP; if (c) b.christmas = c; return b; };

  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const q = (path) => fetch(`${base}/rest/v1/${path}`, { headers: H });

  try {
    // 1) Which barcodes to report? The storefront always passes ?bc=a,b,c (its DATA barcodes, plus family barcodes
    //    when the families flag is on). WITHOUT ?bc= the response is the storefront's own default list = the Gradient
    //    Edit barcodes (api/_gradient.js = index.html DATA), nothing more. Before the M1 cleanup PR (K&D #40) a call
    //    without ?bc= returned WAT stockroom counts for every WAT product (~2,000) to anyone ("admin/debug"); no page,
    //    script or ops job used that dump (grep C:\Agents for "api/stock", 23 Nov 2026), so it is gone, not hidden.
    //    tests/stock-nobc.test.mjs.
    const asked = (req.query?.bc || '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const want = asked.length ? asked : Object.keys(GRADIENT);

    // 2) barcode -> product_id (product_barcodes, karmi barcodes are multi-barcode) AND product_id -> stockroom_count.
    //    The bc list is small (<= 200), so the product_id in() list stays well under HTTP query-string limits.
    const bcToPid = {};
    const slMap   = {};

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

    // 3) holds (paid, not yet fulfilled online orders) + 4) available = stockroom − buffer − holds, floored at 0
    let orders = [];
    const ooRes = await q(`online_orders?status=eq.paid&store_id=eq.${STORE}&select=items&limit=5000`);
    if (ooRes.ok) orders = await ooRes.json(); // holds failure is non-fatal — better to slightly over-show than hide everything
    const stock = computeAvailable(want, bcToPid, slMap, orders);

    // 5) non-Gradient barcodes: caps + WAT price + Christmas window (only for barcodes the caller asked for)
    const sellable = {}, price_pence = {}, online_group = {};
    const groupMode = !!(ladderView && ladderView.mode === 'cart_qty_groups');
    let window = null;
    if (asked.length) {
      const other = want.filter((bc) => !isGradient(bc));
      for (const bc of other) delete stock[bc]; // barcode-level maths does not apply to capped products
      // A paid-but-unrecorded session must not show as free capacity, and an expired one must not block the page
      // forever when checkout.session.expired was missed (F1). Best effort.
      if (other.length) {
        // N2: short per-call Stripe timeout, 3 at once, whole step within 3 s; unanswered holds keep counting.
        try { await resolveStaleHolds(getStripe(), { base, key }, { max: 10, budgetMs: 3000 }); } catch (e) { /* holds keep counting */ }
      }
      const st = await capsStatus(other, { base, key });
      const d = st.ok && st.data && typeof st.data === 'object' ? st.data : null;
      if (d && d.window) window = { open: !!d.window.open, message: d.window.message || null };
      if (d && d.items) {
        for (const bc of other) {
          const it = d.items[bc];
          if (!it) continue;
          stock[bc] = Number(it.stock) || 0;
          sellable[bc] = Number(it.sellable) || 0;
          // M1 (cart_qty_groups only): the DB online_group (fn_karmi_online_status, docs/GO_LIVE_M1.md); none = not sold
          // online. The ONLINE price is the group price, so a missing till price does not block a grouped product
          // (command centre 23 Nov); price_pence is then the group single (display only; checkout charges priceUnits).
          if (groupMode) {
            const g = typeof it.online_group === 'string' ? it.online_group : (ladderView.family_groups || {})[it.family];
            const flat = typeof g === 'string' && ladderView.flat_groups && Object.prototype.hasOwnProperty.call(ladderView.flat_groups, g)
              ? ladderView.flat_groups[g] : null; // K-069 rings: served only when enabled (else R = not sold, as before)
            if (typeof g === 'string' && ladderView.groups[g]) {
              online_group[bc] = g;
              price_pence[bc] = Number.isInteger(it.price_pence) && it.price_pence > 0 ? it.price_pence : ladderView.groups[g].single;
            } else if (flat) {
              online_group[bc] = g;
              price_pence[bc] = flat.each; // flat price: what checkout charges, whatever the till price
            } else sellable[bc] = 0;
            continue;
          }
          if (Number.isInteger(it.price_pence) && it.price_pence > 0) price_pence[bc] = it.price_pence;
          else sellable[bc] = 0;
        }
      }
    }

    const body = { ok: true, store: STORE, stock, sellable, price_pence, window, ts: new Date().toISOString(), ladders: ladderView, storefront: sf() };
    if (groupMode) body.online_group = online_group; // additive, M1 only: the live default response is unchanged
    return res.status(200).json(await withXmas(body));
  } catch (e) {
    // Fail OPEN on any error: empty stock + ok:false → storefront shows all products.
    return res.status(200).json(await withXmas({ ok: false, store: STORE, stock: {}, error: String(e.message || e), ladders: ladderView, storefront: sf() }));
  }
}
