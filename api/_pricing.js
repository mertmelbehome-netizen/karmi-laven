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

/** Validates a raw ladder table. Returns { ok: true, table } or { ok: false, error } — never throws. */
export function loadLadders(raw) {
  try {
    if (!isObj(raw)) throw new Error('ladders: not an object');
    if (typeof raw.version !== 'string' || !raw.version.trim()) throw new Error('ladders: version missing');
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

const need = (table) => {
  if (!table) throw new Error(`ladder table invalid: ${LADDERS_ERROR || 'none'}`);
  return table;
};

/** Pool key of one unit in `table`: 'gradient', the price key, or null (no multi-buy). */
export function poolKey(u, table = LADDERS) {
  if (u.ladder) return 'gradient';
  const k = String(u.unitP);
  return Object.prototype.hasOwnProperty.call(need(table).pools, k) ? k : null;
}

/** Total (pence) for q units of one pool; q = 0 -> 0. Throws on an unknown pool or q above max_units. */
export function poolTotalP(key, q, table = LADDERS) {
  const t = need(table);
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

export const freeShipping = (amountP, totalUnits, table = LADDERS) => {
  const f = need(table).freeShip;
  return amountP >= f.fromP || (f.units !== null && totalUnits >= f.units);
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

/** The table as /api/stock serves it (`ladders`): additive, read-only, null when the table is invalid. */
export function publicLadders(table = LADDERS) {
  if (!table) return null;
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
