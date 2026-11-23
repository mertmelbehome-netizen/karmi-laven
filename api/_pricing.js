// api/_pricing.js — server price maths for /api/checkout, driven by the ladder table in ../ladders.json (23 Nov 2026).
//
//   * Units are grouped into POOLS. A Gradient Edit unit (api/_gradient.js) is in pool 'gradient'. Any other unit is in
//     the pool keyed by its WAT till single price in pence (from fn_karmi_checkout_reserve), e.g. '599': every product
//     at that price shares one ladder, whatever its family. A price with no pool in the table gets NO multi-buy:
//     n × its single price.
//   * Per pool: cheapest combination of the pool's single price, its bundles ({qty: total}) and its optional per-unit
//     tail(s) ({from, each}); then the MONOTONIC rule f(q) = min f(q'), q <= q' <= max_units (no quantity ever costs
//     more than a larger one). The pool total is spread penny-exactly over its units: floor share each, the leftover
//     pennies +1 on the first units in cart order (rule.rounding = 'integer-pence-floor-spread').
//   * Shipping (table block `shipping`): free when subtotal >= free_threshold_pence (integer pence, penny-exact), or
//     when free_at_qty.enabled and units >= free_at_qty.qty; otherwise below_threshold_fee_pence. Optional
//     `derive_threshold: {pool, qty}` LOWERS the threshold to that pool's qty total (never raises it); default null (off).
//   * `rules` (EXTENSION POINT, not implemented): cart-level mechanics such as {type:'cart_discount', min_spend_pence,
//     percent | amount_pence} ("spend £30, get x off"). Only [] is accepted today; any entry makes the table invalid
//     (fail closed) until applyCartRules() is implemented and tested. See docs/LADDERS.md.
//   * `ui.progress_line` (default false): whether the page may show the new bag progress line from progress(); the
//     page does not read it yet (PR-2), so customers see no change.
//   * Fail closed: a table that does not validate leaves LADDERS = null; priceUnits() and freeShipping() then throw
//     and /api/checkout answers 503 before reserving anything. Never charge from a guessed table.
// The default table (ladders.json) = the live prices before this change: Gradient 1 = £2.99, 2 = £5.50, 3 = £7.50,
// 5 = £12 (cheapest combination); no family multi-buy; free shipping >= £12 or 5+ units. tests/pricing.test.mjs
// proves it charges exactly what the old hard-coded DENOMS code charged (golden + legacy comparison).
// Schema extension (23 Nov 2026, backwards-compatible): `mode: 'cart_qty_groups'` (see loadGroupTable) = group single
// price + one cart-wide 10+ price, non-monotonic by design; used only by PREVIEW tables in ladders-preview/ (e.g.
// M1_mert_list), selectable via previewLadders() on a Vercel preview. A table without `mode` = the pools model above.
// index.html still mirrors the Gradient ladder between /*KL-PRICING-START*/ and /*KL-PRICING-END*/; the tests keep the
// page = this table. /api/stock serves publicLadders() as `ladders` so the page can read the table (PR-2).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULE_ROUNDING = 'integer-pence-floor-spread';
const MAX_UNITS_LIMIT = 999;
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/** Cheapest-combination totals 0..maxUnits for one pool, then the monotonic rule. */
function poolTotals(single, bundles, tails, maxUnits) {
  const denoms = [[1, single], ...bundles];
  const dp = [0];
  for (let i = 1; i <= maxUnits; i++) {
    let best = Infinity;
    for (const [d, c] of denoms) if (d <= i) best = Math.min(best, dp[i - d] + c);
    for (const t of tails) if (i >= t.from) best = Math.min(best, i * t.each);
    dp[i] = best;
  }
  const f = dp.slice();
  for (let i = maxUnits - 1; i >= 1; i--) f[i] = Math.min(f[i], f[i + 1]);
  return f;
}

function normalisePool(key, p, maxUnits) {
  const where = `ladders: pool '${key}'`;
  if (!isObj(p)) throw new Error(`${where} is not an object`);
  if (!isPosInt(p.single)) throw new Error(`${where}: single must be a positive integer (pence)`);
  if (key !== 'gradient' && p.single !== Number(key)) throw new Error(`${where}: single ${p.single} != pool key`);
  const bundles = [];
  if (p.bundles !== undefined) {
    if (!isObj(p.bundles)) throw new Error(`${where}: bundles must be {qty: total_pence}`);
    for (const [q, c] of Object.entries(p.bundles)) {
      const n = Number(q);
      if (!/^[1-9]\d*$/.test(q) || n < 2 || n > maxUnits) throw new Error(`${where}: bundle qty '${q}' must be 2..${maxUnits}`);
      if (!isPosInt(c)) throw new Error(`${where}: bundle ${q} total must be a positive integer (pence)`);
      bundles.push([n, c]);
    }
  }
  const rawTails = p.tail === undefined || p.tail === null ? [] : Array.isArray(p.tail) ? p.tail : [p.tail];
  const tails = rawTails.map((t) => {
    if (!isObj(t) || !Number.isInteger(t.from) || t.from < 2 || t.from > maxUnits || !isPosInt(t.each)) {
      throw new Error(`${where}: tail must be {from: 2..${maxUnits}, each: pence}`);
    }
    return { from: t.from, each: t.each };
  });
  const totals = poolTotals(p.single, bundles, tails, maxUnits);
  // A bundle cheaper than the single price would make ONE unit cost less than its own price: reject the table.
  if (totals[1] !== p.single) throw new Error(`${where}: 1 unit would cost ${totals[1]}, not its single price ${p.single}`);
  for (let q = 1; q <= maxUnits; q++) {
    if (!Number.isFinite(totals[q]) || totals[q] < q) throw new Error(`${where}: ${q} units would cost under 1p each`);
  }
  return Object.freeze({
    single: p.single,
    bundles: Object.freeze(bundles.sort((a, b) => a[0] - b[0]).map((b) => Object.freeze(b))),
    tails: Object.freeze(tails.map((t) => Object.freeze(t))),
    totals: Object.freeze(totals),
  });
}

export const MODE_POOLS = 'pools';
export const MODE_GROUPS = 'cart_qty_groups';
export const MONOTONIC_EXCEPTION = 'cart_qty_threshold';

/**
 * mode 'cart_qty_groups' (schema extension, 23 Nov 2026; Mert's list, K-046 — NOT the live table):
 *   every product belongs to a GROUP with an ONLINE single price (not the till price) and a group tier price;
 *   the cart's TOTAL unit count (all groups mixed) decides: n < cart_qty_tier.from -> every unit at its group's
 *   single, n >= from -> every unit at its group's tier_each. No intermediate steps. Non-monotonic BY DESIGN
 *   (9 × £8 = £72 > 10 × £2.40 = £24), so the table must say rule.monotonic = false and
 *   rule.monotonic_exception = 'cart_qty_threshold'; the cart shows "add k more" instead (progress / cartSummary).
 *   Group of a unit: Gradient Edit -> gradient_group; any other -> u.group (caller: DB online_group, else
 *   family_groups[family]); no group = not priced (throws; checkout answers 503).
 */
function loadGroupTable(raw) {
  const r = raw.rule;
  if (!isObj(r)) throw new Error('ladders: rule missing');
  if (r.monotonic !== false || r.monotonic_exception !== MONOTONIC_EXCEPTION) {
    throw new Error(`ladders: mode '${MODE_GROUPS}' is non-monotonic by design: rule.monotonic must be false and rule.monotonic_exception '${MONOTONIC_EXCEPTION}'`);
  }
  if (r.rounding !== RULE_ROUNDING) throw new Error(`ladders: rule.rounding must be '${RULE_ROUNDING}'`);
  if (!isPosInt(r.max_units) || r.max_units > MAX_UNITS_LIMIT) throw new Error('ladders: rule.max_units invalid');
  const maxUnits = r.max_units;
  const ct = raw.cart_qty_tier;
  if (!isObj(ct) || !Number.isInteger(ct.from) || ct.from < 2 || ct.from > maxUnits || ct.counts !== 'all_units') {
    throw new Error(`ladders: cart_qty_tier must be {from: 2..${maxUnits}, counts: 'all_units'}`);
  }
  const sh = raw.shipping;
  if (!isObj(sh) || !(sh.free_threshold_pence === null || isPosInt(sh.free_threshold_pence))
    || !Number.isInteger(sh.below_threshold_fee_pence) || sh.below_threshold_fee_pence < 0) {
    throw new Error('ladders: shipping must have free_threshold_pence (>0 or null) and below_threshold_fee_pence (>=0), integer pence');
  }
  const fq = sh.free_at_qty;
  if (!isObj(fq) || typeof fq.enabled !== 'boolean' || !isPosInt(fq.qty)) throw new Error('ladders: shipping.free_at_qty must be {enabled: bool, qty: int}');
  if (sh.derive_threshold !== undefined && sh.derive_threshold !== null) throw new Error(`ladders: shipping.derive_threshold is not supported in mode '${MODE_GROUPS}'`);
  if (!Array.isArray(raw.rules)) throw new Error('ladders: rules must be an array ([] = none)');
  if (raw.rules.length) throw new Error('ladders: cart-level rules are an extension point only');
  const ui = raw.ui === undefined ? {} : raw.ui;
  if (!isObj(ui) || (ui.progress_line !== undefined && typeof ui.progress_line !== 'boolean')) throw new Error('ladders: ui.progress_line must be boolean');
  if (raw.pools !== undefined && !(isObj(raw.pools) && Object.keys(raw.pools).length === 0)) {
    throw new Error(`ladders: mode '${MODE_GROUPS}' takes groups, not pools`);
  }
  if (!isObj(raw.groups) || !Object.keys(raw.groups).length) throw new Error('ladders: groups missing');
  const groups = {};
  for (const [k, gr] of Object.entries(raw.groups)) {
    const where = `ladders: group '${k}'`;
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(k)) throw new Error(`${where}: key must be A..Z (e.g. 'A')`);
    if (!isObj(gr) || !isPosInt(gr.single) || !isPosInt(gr.tier_each)) throw new Error(`${where}: single and tier_each must be positive integers (pence)`);
    if (gr.tier_each > gr.single) throw new Error(`${where}: tier_each ${gr.tier_each} above single ${gr.single}`);
    if (gr.label !== undefined && typeof gr.label !== 'string') throw new Error(`${where}: label must be text`);
    groups[k] = Object.freeze({ single: gr.single, tier_each: gr.tier_each, label: gr.label || k });
  }
  const gg = raw.gradient_group === undefined ? null : raw.gradient_group;
  if (gg !== null && !groups[gg]) throw new Error(`ladders: gradient_group '${gg}' is not a group`);
  const fg = raw.family_groups === undefined ? {} : raw.family_groups;
  if (!isObj(fg)) throw new Error('ladders: family_groups must be {family: group}');
  for (const [fam, gk] of Object.entries(fg)) {
    if (!/^[a-z][a-z_]*$/.test(fam) || fam === 'gradient') throw new Error(`ladders: family_groups key '${fam}' must be a DB family`);
    if (!groups[gk]) throw new Error(`ladders: family_groups.${fam} -> '${gk}' is not a group`);
  }
  return {
    ok: true,
    table: Object.freeze({
      mode: MODE_GROUPS,
      version: raw.version,
      maxUnits,
      tierFrom: ct.from,
      groups: Object.freeze(groups),
      gradientGroup: gg,
      familyGroups: Object.freeze({ ...fg }),
      freeShip: Object.freeze({ fromP: sh.free_threshold_pence, units: fq.enabled ? fq.qty : null, feeP: sh.below_threshold_fee_pence, derivedFrom: null }),
      rules: Object.freeze([]),
      progressLine: ui.progress_line === true,
      pools: Object.freeze({}),
    }),
  };
}

/** Validates a raw ladder table. Returns { ok: true, table } or { ok: false, error } — never throws. */
export function loadLadders(raw) {
  try {
    if (!isObj(raw)) throw new Error('ladders: not an object');
    if (typeof raw.version !== 'string' || !raw.version.trim()) throw new Error('ladders: version missing');
    if (raw.mode !== undefined && raw.mode !== MODE_POOLS && raw.mode !== MODE_GROUPS) throw new Error(`ladders: unknown mode '${raw.mode}'`);
    if (raw.mode === MODE_GROUPS) return loadGroupTable(raw);
    const r = raw.rule;
    if (!isObj(r)) throw new Error('ladders: rule missing');
    if (r.monotonic !== true) throw new Error('ladders: rule.monotonic must be true');
    if (r.rounding !== RULE_ROUNDING) throw new Error(`ladders: rule.rounding must be '${RULE_ROUNDING}'`);
    if (!isPosInt(r.max_units) || r.max_units > MAX_UNITS_LIMIT) throw new Error('ladders: rule.max_units invalid');
    const maxUnits = r.max_units;
    const sh = raw.shipping;
    if (!isObj(sh) || !isPosInt(sh.free_threshold_pence) || !Number.isInteger(sh.below_threshold_fee_pence) || sh.below_threshold_fee_pence < 0) {
      throw new Error('ladders: shipping must have free_threshold_pence (>0) and below_threshold_fee_pence (>=0), integer pence');
    }
    const fq = sh.free_at_qty;
    if (!isObj(fq) || typeof fq.enabled !== 'boolean' || !isPosInt(fq.qty)) throw new Error('ladders: shipping.free_at_qty must be {enabled: bool, qty: int}');
    if (!Array.isArray(raw.rules)) throw new Error('ladders: rules must be an array ([] = none)');
    if (raw.rules.length) {
      const t = isObj(raw.rules[0]) ? String(raw.rules[0].type) : typeof raw.rules[0];
      throw new Error(`ladders: rule type '${t}' not implemented (cart-level rules are an extension point only)`);
    }
    const ui = raw.ui === undefined ? {} : raw.ui;
    if (!isObj(ui) || (ui.progress_line !== undefined && typeof ui.progress_line !== 'boolean')) throw new Error('ladders: ui.progress_line must be boolean');
    if (!isObj(raw.pools)) throw new Error('ladders: pools missing');
    const pools = {};
    for (const [key, p] of Object.entries(raw.pools)) {
      if (key !== 'gradient' && !/^[1-9]\d{0,5}$/.test(key)) throw new Error(`ladders: pool key '${key}' must be 'gradient' or a price in pence`);
      pools[key] = normalisePool(key, p, maxUnits);
    }
    if (!pools.gradient) throw new Error("ladders: pool 'gradient' missing (the Gradient Edit has no other price source)");
    let fromP = sh.free_threshold_pence, derivedFrom = null;
    if (sh.derive_threshold !== undefined && sh.derive_threshold !== null) {
      const d = sh.derive_threshold;
      if (!isObj(d) || typeof d.pool !== 'string' || !pools[d.pool] || !Number.isInteger(d.qty) || d.qty < 1 || d.qty > maxUnits) {
        throw new Error('ladders: shipping.derive_threshold must be {pool: <existing pool>, qty: 1..max_units}');
      }
      fromP = Math.min(fromP, pools[d.pool].totals[d.qty]);
      derivedFrom = Object.freeze({ pool: d.pool, qty: d.qty });
    }
    return {
      ok: true,
      table: Object.freeze({
        version: raw.version,
        maxUnits,
        freeShip: Object.freeze({ fromP, units: fq.enabled ? fq.qty : null, feeP: sh.below_threshold_fee_pence, derivedFrom }),
        rules: Object.freeze([]),
        progressLine: ui.progress_line === true,
        pools: Object.freeze(pools),
      }),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// The deployed table: <project root>/ladders.json. Read with fs from process.cwd(), NOT import.meta /
// createRequire: Vercel compiles api/*.js to CommonJS (no "type": "module"), where import.meta is a
// load-time SyntaxError (preview 16f6c32: FUNCTION_INVOCATION_FAILED). vercel.json includeFiles puts the
// file in the checkout + stock bundles; locally npm test runs from the repo root.
const loaded = (() => {
  let raw;
  try { raw = JSON.parse(readFileSync(join(process.cwd(), 'ladders.json'), 'utf8')); } catch (e) { return { ok: false, error: `ladders.json unreadable: ${e.message}` }; }
  return loadLadders(raw);
})();
export const LADDERS = loaded.ok ? loaded.table : null;
export const LADDERS_ERROR = loaded.ok ? null : loaded.error;
if (!loaded.ok) console.error('pricing: ladder table rejected, checkout fails closed:', LADDERS_ERROR);

// PREVIEW-ONLY tables (23 Nov 2026): ladders-preview/<name>.json, selectable with ?ladder=<name> (/api/stock) or
// body.ladder (/api/checkout) ONLY on a Vercel preview deployment (VERCEL_ENV = 'preview') or when
// KL_LADDER_PREVIEW = '1' (tests / local). In production the parameter is ignored: the default ladders.json is used.
export const PREVIEW_LADDERS = Object.freeze(['M1_mert_list']);
export const previewAllowed = (env = process.env) => env.VERCEL_ENV === 'preview' || env.KL_LADDER_PREVIEW === '1';
const previewCache = new Map();
/**
 * null = no (honoured) selection: use the default table. Otherwise { ok: true, name, table } or { ok: false, error }.
 * Never throws; same validator as the default table.
 */
export function previewLadders(name, env = process.env) {
  if (name === undefined || name === null || name === '') return null;
  if (!previewAllowed(env)) return null;
  const n = String(name);
  if (!PREVIEW_LADDERS.includes(n)) return { ok: false, error: `unknown preview ladder '${n.slice(0, 40)}'` };
  if (!previewCache.has(n)) {
    let r;
    try { r = loadLadders(JSON.parse(readFileSync(join(process.cwd(), 'ladders-preview', `${n}.json`), 'utf8'))); }
    catch (e) { r = { ok: false, error: `ladders-preview/${n}.json unreadable: ${e.message}` }; }
    previewCache.set(n, r.ok ? { ok: true, name: n, table: r.table } : { ok: false, error: r.error });
  }
  return previewCache.get(n);
}

const need = (table) => {
  if (!table) throw new Error(`ladder table invalid: ${LADDERS_ERROR || 'none'}`);
  return table;
};
const isGroups = (t) => t.mode === MODE_GROUPS;

/** Pool key of one unit in `table`: 'gradient', the price key, or null (no multi-buy). */
export function poolKey(u, table = LADDERS) {
  if (isGroups(need(table))) return groupKey(u, table);
  if (u.ladder) return 'gradient';
  const k = String(u.unitP);
  return Object.prototype.hasOwnProperty.call(need(table).pools, k) ? k : null;
}

/** mode cart_qty_groups: the group of one unit (Gradient -> gradient_group; else u.group), or null = cannot price. */
export function groupKey(u, table = LADDERS) {
  const t = need(table);
  if (!isGroups(t)) throw new Error('groupKey: table is not in cart_qty_groups mode');
  const k = u.ladder ? t.gradientGroup : u.group;
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(t.groups, k) ? k : null;
}

/** mode cart_qty_groups: the group for a DB checkout line ({family, online_group?}); null = no group. */
export function lineGroup(line, table = LADDERS) {
  const t = need(table);
  if (!isGroups(t) || !line) return null;
  const own = typeof line.online_group === 'string' ? line.online_group : null; // future DB column (K-046)
  if (own !== null) return Object.prototype.hasOwnProperty.call(t.groups, own) ? own : null;
  const f = typeof line.family === 'string' ? line.family : '';
  return Object.prototype.hasOwnProperty.call(t.familyGroups, f) ? t.familyGroups[f] : null;
}

/** Total (pence) for q units of one pool; q = 0 -> 0. Throws on an unknown pool or q above max_units. */
export function poolTotalP(key, q, table = LADDERS) {
  const t = need(table);
  if (isGroups(t)) throw new Error('poolTotalP: cart_qty_groups prices depend on the whole cart (use priceUnits)');
  if (q <= 0) return 0;
  const p = t.pools[key];
  if (!p) throw new Error(`no ladder pool '${key}'`);
  if (!Number.isInteger(q) || q > t.maxUnits) throw new Error(`pool '${key}': ${q} units above max_units ${t.maxUnits}`);
  return p.totals[q];
}

// Backward-compatible exports (same names and values as before 23 Nov 2026), now read from the table.
export const UNIT = LADDERS ? LADDERS.pools.gradient.single : null;
export const FREE_SHIP_P = LADDERS ? LADDERS.freeShip.fromP : null;
export const FREE_SHIP_UNITS = LADDERS ? LADDERS.freeShip.units : null;
export const SHIP_FEE_P = LADDERS ? LADDERS.freeShip.feeP : null;
export const DENOMS = LADDERS
  ? Object.freeze([...LADDERS.pools.gradient.bundles, [1, LADDERS.pools.gradient.single]].sort((a, b) => b[0] - a[0]))
  : null;
/** Ladder total (pence) for q Gradient Edit units (cheapest combination + monotonic rule). */
export const bestPriceP = (q) => poolTotalP('gradient', q);
export const ladderTotalP = (q) => (q > 0 ? poolTotalP('gradient', q) : 0);

/**
 * Sets u.price (pence) and u.pool on every unit and returns the cart total (pence).
 * units: [{ ladder: boolean, unitP?: int }]. A non-ladder unit without a positive integer unitP throws:
 * the caller must never reach Stripe with a guessed price. So does an invalid/missing table.
 */
export function priceUnits(units, table = LADDERS) {
  const t = need(table);
  if (isGroups(t)) return priceGroupUnits(units, t);
  const byPool = new Map();
  let other = 0;
  for (const u of units) {
    if (!u.ladder && (!Number.isInteger(u.unitP) || u.unitP <= 0)) throw new Error('unpriced unit');
    const k = poolKey(u, t);
    u.pool = k;
    if (k === null) { u.price = u.unitP; other += u.unitP; continue; }
    if (!byPool.has(k)) byPool.set(k, []);
    byPool.get(k).push(u);
  }
  let total = other;
  for (const [k, list] of byPool) {
    const amount = poolTotalP(k, list.length, t);
    const base = Math.floor(amount / list.length);
    const rem = amount - base * list.length; // 0 .. n-1 leftover pennies, one each on the first `rem`
    list.forEach((u, i) => { u.price = base + (i < rem ? 1 : 0); });
    total += amount;
  }
  return total;
}

/**
 * mode cart_qty_groups: n = ALL units in the cart (every group mixed). n < tierFrom -> each unit its group single;
 * n >= tierFrom -> each unit its group tier_each. Whole pence per unit, so no spreading is needed (line items sum
 * exactly). Sets u.pool = group, u.single = group single, u.price. Throws on an ungrouped unit.
 */
function priceGroupUnits(units, t) {
  if (units.length > t.maxUnits) throw new Error(`cart: ${units.length} units above max_units ${t.maxUnits}`);
  const tier = units.length >= t.tierFrom;
  let total = 0;
  for (const u of units) {
    const k = groupKey(u, t);
    if (k === null) throw new Error(u.ladder ? 'gradient not sold under this table' : 'ungrouped unit');
    const gr = t.groups[k];
    u.pool = k;
    u.single = gr.single;
    u.price = tier ? gr.tier_each : gr.single;
    total += u.price;
  }
  return total;
}

export const freeShipping = (amountP, totalUnits, table = LADDERS) => {
  const f = need(table).freeShip;
  return (f.fromP !== null && amountP >= f.fromP) || (f.units !== null && totalUnits >= f.units);
};
/** Shipping charge (pence) for a priced bag: 0 when free, else the table's below-threshold fee. */
export const shippingFeeP = (amountP, totalUnits, table = LADDERS) =>
  (freeShipping(amountP, totalUnits, table) ? 0 : need(table).freeShip.feeP);

/**
 * EXTENSION POINT (not implemented): cart-level rules from the table's `rules` array, e.g. a 'spend £X, get y off'
 * basket discount ({type:'cart_discount', min_spend_pence, percent | amount_pence}). The loader only accepts
 * rules = [], so this is the identity today; it refuses to run with any rule so a future table can never be charged
 * by half-built code. Not called by /api/checkout in PR-1.
 */
export function applyCartRules(totalP, rules = (LADDERS ? LADDERS.rules : [])) {
  if (!Array.isArray(rules)) throw new Error('rules must be an array');
  if (rules.length) throw new Error('cart rules not implemented');
  return totalP;
}

const gbp = (p) => `£${(p / 100).toFixed(2)}`;

/**
 * Bag progress from the table: ONE function for both nudges (ladder step and free delivery).
 * units: [{ ladder, unitP }] in cart order; the last unit's pool = the pool the shopper touched last.
 * Returns
 *   next_tier:         { pool, qty, add, total_pence, each_pence|null, same_total } | null. The smallest `add` units
 *                      of the last-touched pool after which the average price per unit drops (exact integer
 *                      comparison). each_pence only when the total splits evenly (else null: never show a rounded
 *                      "each" the bag does not charge). same_total = the total does not rise ("still £x").
 *   best_unlocked:     true when the last-touched pool already has a multi-buy price and no further step lowers it.
 *   free_delivery_gap: null when delivery is already free, else { pence, units } still needed (units = null when
 *                      free_at_qty is off).
 *   lines:             English text, next tier first, then delivery; no %, no strike-through, no "save £x".
 * The page may show `lines` only when the table's ui.progress_line is true (default false: today's bag text).
 */
export function progress(units, table = LADDERS) {
  const t = need(table);
  if (isGroups(t)) return groupProgress(units, t);
  const priced = units.map((u) => ({ ladder: !!u.ladder, unitP: u.unitP }));
  const amount = priced.length ? priceUnits(priced, t) : 0;
  let next = null, bestUnlocked = false;
  const last = priced[priced.length - 1];
  if (last && last.pool !== null) {
    const k = last.pool;
    const q = priced.filter((u) => u.pool === k).length;
    const now = poolTotalP(k, q, t);
    for (let add = 1; q + add <= t.maxUnits; add++) {
      const tot = poolTotalP(k, q + add, t);
      if (tot * q < now * (q + add)) {
        const n = q + add;
        next = { pool: k, qty: n, add, total_pence: tot, each_pence: tot % n === 0 ? tot / n : null, same_total: tot === now };
        break;
      }
    }
    if (!next && now < q * t.pools[k].single) bestUnlocked = true;
  }
  const f = t.freeShip;
  const gap = freeShipping(amount, priced.length, t) ? null
    : { pence: f.fromP - amount, units: f.units === null ? null : f.units - priced.length };
  const lines = [];
  if (next) {
    const each = next.each_pence !== null ? ` (${gbp(next.each_pence)} each)` : '';
    lines.push(next.same_total ? `Add ${next.add} more, still ${gbp(next.total_pence)}${each}`
      : `Add ${next.add} more: ${next.qty} for ${gbp(next.total_pence)}${each}`);
  } else if (bestUnlocked) {
    lines.push('Best multi-buy price unlocked');
  }
  if (gap) lines.push(`Add ${gbp(gap.pence)} for free delivery`);
  return { amount_pence: amount, next_tier: next, best_unlocked: bestUnlocked, free_delivery_gap: gap, lines };
}

const copyUnits = (units) => units.map((u) => ({ ladder: !!u.ladder, unitP: u.unitP, group: u.group }));

/**
 * mode cart_qty_groups: BOTH prices and the difference, for the cart (Mert, 23 Nov: "cart must show both prices and
 * the saving"). single_total = every unit at its group single; tier_total = every unit at its group tier price;
 * charged = what the bag costs now (single_total below the threshold, tier_total from it). to_unlock = units still
 * needed; unlock_total = what the bag would cost with `to_unlock` more units of the last-touched group.
 * Wording of a "saving" line on the page is LEGAL-CHECK (CMA/DMCC reference price) — numbers only here.
 */
export function cartSummary(units, table = LADDERS) {
  const t = need(table);
  if (!isGroups(t)) throw new Error('cartSummary: table is not in cart_qty_groups mode');
  const priced = copyUnits(units);
  const charged = priced.length ? priceUnits(priced, t) : 0;
  let singleTotal = 0, tierTotal = 0;
  const byGroup = {};
  for (const u of priced) {
    const gr = t.groups[u.pool];
    singleTotal += gr.single; tierTotal += gr.tier_each;
    const b = byGroup[u.pool] || (byGroup[u.pool] = { group: u.pool, qty: 0, single: gr.single, tier_each: gr.tier_each, each_charged: u.price });
    b.qty++;
  }
  const n = priced.length;
  const toUnlock = n >= t.tierFrom ? 0 : t.tierFrom - n;
  const last = priced[n - 1];
  const unlockTotal = toUnlock && last ? tierTotal + toUnlock * t.groups[last.pool].tier_each : null;
  return {
    units: n,
    tier_from: t.tierFrom,
    tier_unlocked: n >= t.tierFrom,
    single_total_pence: singleTotal,
    tier_total_pence: tierTotal,
    charged_pence: charged,
    difference_pence: singleTotal - charged, // 0 below the threshold
    to_unlock: toUnlock,
    unlock_group: toUnlock && last ? last.pool : null,
    unlock_total_pence: unlockTotal,
    groups: Object.values(byGroup).sort((a, b) => (a.group < b.group ? -1 : 1)),
  };
}

function groupProgress(units, t) {
  const s = cartSummary(units, t);
  const f = t.freeShip;
  const free = freeShipping(s.charged_pence, s.units, t);
  const gap = free ? null : {
    pence: f.fromP === null ? null : f.fromP - s.charged_pence,
    units: f.units === null ? null : f.units - s.units,
  };
  let next = null;
  if (s.to_unlock && s.units) {
    next = { pool: s.unlock_group, qty: t.tierFrom, add: s.to_unlock, total_pence: s.unlock_total_pence, each_pence: null, same_total: s.unlock_total_pence === s.charged_pence };
  }
  const bestUnlocked = s.tier_unlocked;
  const lines = [];
  // "Add 1 more: all 10 for £24.00" — the 10-unit total is LOWER than the 9-unit total by design (non-monotonic).
  const deliveryToo = gap && gap.units !== null && next && gap.units === next.add && f.fromP === null;
  if (next) lines.push(`Add ${next.add} more: all ${next.qty} for ${gbp(next.total_pence)}${deliveryToo ? ' with free delivery' : ''}`);
  else if (bestUnlocked) lines.push('Best multi-buy price unlocked');
  if (gap && !deliveryToo) {
    if (gap.pence !== null) lines.push(`Add ${gbp(gap.pence)} for free delivery`);
    else if (gap.units !== null) lines.push(`Add ${gap.units} more for free delivery`);
  }
  return { amount_pence: s.charged_pence, next_tier: next, best_unlocked: bestUnlocked, free_delivery_gap: gap, lines, summary: s };
}

/** The table as /api/stock serves it (`ladders`): additive, read-only, null when the table is invalid. */
export function publicLadders(table = LADDERS) {
  if (!table) return null;
  if (isGroups(table)) {
    return {
      version: table.version,
      mode: MODE_GROUPS,
      rule: { monotonic: false, monotonic_exception: MONOTONIC_EXCEPTION, rounding: RULE_ROUNDING, max_units: table.maxUnits },
      cart_qty_tier: { from: table.tierFrom, counts: 'all_units' },
      groups: Object.fromEntries(Object.entries(table.groups).map(([k, gr]) => [k, { label: gr.label, single: gr.single, tier_each: gr.tier_each }])),
      gradient_group: table.gradientGroup,
      family_groups: { ...table.familyGroups },
      shipping: {
        free_threshold_pence: table.freeShip.fromP,
        below_threshold_fee_pence: table.freeShip.feeP,
        free_at_qty: table.freeShip.units === null ? { enabled: false } : { enabled: true, qty: table.freeShip.units },
        derived_from: null,
      },
      rules: [],
      ui: { progress_line: table.progressLine },
      pools: {},
    };
  }
  const pools = {};
  for (const [k, p] of Object.entries(table.pools)) {
    pools[k] = {
      single: p.single,
      bundles: Object.fromEntries(p.bundles.map(([q, c]) => [String(q), c])),
      tail: p.tails.map((x) => ({ from: x.from, each: x.each })),
      totals: [...p.totals], // totals[q] = what q units of this pool cost (q = 0..max_units), as charged
    };
  }
  return {
    version: table.version,
    rule: { monotonic: true, rounding: RULE_ROUNDING, max_units: table.maxUnits },
    shipping: {
      free_threshold_pence: table.freeShip.fromP,
      below_threshold_fee_pence: table.freeShip.feeP,
      free_at_qty: table.freeShip.units === null ? { enabled: false } : { enabled: true, qty: table.freeShip.units },
      derived_from: table.freeShip.derivedFrom,
    },
    rules: [],
    ui: { progress_line: table.progressLine },
    pools,
  };
}
