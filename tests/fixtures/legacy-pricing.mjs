// FROZEN COPY of api/_pricing.js as of origin/master d3bc323 (before the ladder table, 23 Nov 2026).
// Used ONLY by tests/ladders.test.mjs to prove the table-driven engine with the default ladders.json charges
// exactly what this code charged. Do not edit; do not import from api/.

export const UNIT = 299; // £2.99 Gradient Edit unit price (pence) — never raised; value rises via quantity
export const FREE_SHIP_P = 1200;
export const FREE_SHIP_UNITS = 5;
export const DENOMS = [[5, 1200], [3, 750], [2, 550], [1, 299]];

/** Cheapest ladder total (pence) for q Gradient Edit units. */
export function bestPriceP(q) {
  if (q <= 0) return 0;
  const dp = [0];
  for (let i = 1; i <= q; i++) { dp[i] = Infinity; for (const [d, c] of DENOMS) if (d <= i) dp[i] = Math.min(dp[i], dp[i - d] + c); }
  return dp[q];
}

export const ladderTotalP = (q) => (q > 0 ? Math.max(UNIT, bestPriceP(q)) : 0);

/**
 * Sets u.price (pence) on every unit and returns the cart total (pence).
 * units: [{ ladder: boolean, unitP?: int }]. A non-ladder unit without a positive integer unitP throws:
 * the caller must never reach Stripe with a guessed price.
 */
export function priceUnits(units) {
  const ladder = units.filter((u) => u.ladder);
  const ladderAmount = ladderTotalP(ladder.length);
  if (ladder.length) {
    const base = Math.floor(ladderAmount / ladder.length);
    const rem = ladderAmount - base * ladder.length; // 0 .. n-1 leftover pennies, one each on the first `rem`
    ladder.forEach((u, i) => { u.price = base + (i < rem ? 1 : 0); });
  }
  let other = 0;
  for (const u of units) {
    if (u.ladder) continue;
    if (!Number.isInteger(u.unitP) || u.unitP <= 0) throw new Error('unpriced unit');
    u.price = u.unitP;
    other += u.unitP;
  }
  return ladderAmount + other;
}

export const freeShipping = (amountP, totalUnits) => amountP >= FREE_SHIP_P || totalUnits >= FREE_SHIP_UNITS;
