# Multi-buy ladders and shipping (`ladders.json`)

`ladders.json` (repo root) is the ONE table the checkout charges from. `api/_pricing.js` loads and validates it;
`/api/checkout` prices every unit from it; `/api/stock` serves it to the page as `ladders` (additive field).
The default file = the live behaviour on 23 Nov 2026: nothing changes for customers.

## Shape

```json
{
  "version": "live-2026-11-23",
  "rule": { "monotonic": true, "rounding": "integer-pence-floor-spread", "max_units": 99 },
  "shipping": {
    "free_threshold_pence": 1200,
    "below_threshold_fee_pence": 149,
    "free_at_qty": { "enabled": true, "qty": 5 },
    "derive_threshold": null
  },
  "rules": [],
  "ui": { "progress_line": false },
  "pools": {
    "gradient": { "single": 299, "bundles": { "2": 550, "3": 750, "5": 1200 } }
  }
}
```

- **Pools.** Key `gradient` = The Gradient Edit barcodes (`api/_gradient.js`). Any other key is a single price in
  pence (`"599"`): every product whose WAT till price (DB `price_pence`) equals it shares that ladder, whatever its
  family (Stretch Double and Necklace at £9.99 mix in one pool). A price with no pool = no multi-buy (n × single).
  If WAT moves a price (£5.99 → £6.49), that product silently leaves the pool: check listed prices against the pool
  keys before and after a family goes live.
- **Pool fields.** `single` (must equal the key), `bundles` `{qty: total_pence}` (qty 2..max_units), optional
  `tail` `{from, each}` or a list of them (every unit at `each` once the pool has `from`+ units).
- **Algorithm** (independent of which steps exist): cheapest combination of single + bundles + tail, then the
  monotonic rule `f(q) = min f(q')` for `q <= q' <= max_units` (no quantity costs more than a larger one). Totals are
  integer pence; a pool total is spread floor-each, leftover pennies +1 on the first units (line items sum exactly).
- **Shipping.** Free when subtotal >= `free_threshold_pence` (integer compare, penny-exact) or, if
  `free_at_qty.enabled`, units >= `free_at_qty.qty`; otherwise `below_threshold_fee_pence`. `derive_threshold`
  `{pool, qty}` (off = `null`) can only LOWER the threshold to that pool's total.
- **`rules` (extension point, NOT implemented).** Planned home for cart-level mechanics, e.g.
  `{ "type": "cart_discount", "min_spend_pence": 3000, "percent": 10 }` ("spend £30, get x off"). Today only `[]`
  loads; any entry makes the table invalid (fail closed). `applyCartRules()` is the code hook and throws on any rule.
- **`ui.progress_line`** (default `false`). `progress(units)` in `api/_pricing.js` returns the next ladder step and
  the free-delivery gap from the table, plus English lines ("Add 1 more: 2 for £5.50 (£2.75 each)", "Add £9.01 for
  free delivery"; no %, no strike-through, no "save £x"). The page shows nothing new until this flag is on AND the
  page is wired to it (PR-2).

## Changing prices, steps or shipping

1. Edit `ladders.json` only (and bump `version`). Adding a 20 step, keeping only 1 and 10, or removing 2/3/5 is a
   table change; no code change.
2. Also change `index.html` `DENOMS` / `PRICE` (pricing block) and the `SHIP` fallback (delivery block). The page's
   delivery texts, the rolling bag total and the "n for £x" prices read `/api/stock` `ladders` at runtime, but the static
   texts (meta descriptions, footer/announce fallbacks, `shipping-returns.html`) must be edited by hand:
   `tests/ladders.test.mjs` and `tests/delivery.test.mjs` fail if page and table disagree.
3. `npm test`. A table that does not validate never charges: `/api/checkout` answers 503 before reserving anything,
   `/api/stock` serves `ladders: null`.

## Test fixtures (never live)

`tests/fixtures/ladders.*.json`, used only by `tests/ladders.test.mjs`:

| Fixture | What |
|---|---|
| `A` | Option A "WAT mirror" (commercial-analyst, 23 Nov): £4 5/10, £5.99/£7.99/£9.99 3/4/5 + 6+ each |
| `B` | Option B: 5 = 3 × single, 10 = 4 × single, 6–9 = 60% each |
| `C` | Option C: soft per-unit discounts 2/3/4/5–9/10+ |
| `shipping_30` | A ladders + free delivery from £30.00, £6.49 below, no free-at-qty |
| `steps_1_10` | only 1 and 10 per pool |
| `steps_20` | A + a 20 step |
| `no_mid` | A without the 2/3/4/5 steps |
| `legacy-pricing.mjs` | frozen pre-table `_pricing.js`; proves the default table charges exactly the same |

## Mode `cart_qty_groups` (preview only: `ladders-preview/`)

A second table model, used by `ladders-preview/M1_mert_list.json` (Mert's list, 23 Nov 2026, K-046). A table
without `mode` is the pools model above; the live `ladders.json` has no `mode` and is unchanged.

- `groups` `{A: {label, single, tier_each}}`: ONLINE single price per group (not the till price) and its 10+ price.
- `cart_qty_tier` `{from: 10, counts: "all_units"}`: the cart's TOTAL unit count (all groups mixed). Below `from`
  every unit pays its group `single`; from `from` every unit pays its group `tier_each`. No intermediate steps.
- **Non-monotonic by design** (9 x £8 = £72, 10 x £2.40 = £24): the table must say `rule.monotonic: false` and
  `rule.monotonic_exception: "cart_qty_threshold"`. The cart answers with `progress()` ("Add 1 more: all 10 for
  £24.00 with free delivery") and `cartSummary()` (single total, charged total, difference, units to unlock).
- Group of a unit: Gradient Edit -> `gradient_group`; other products -> DB line `online_group` (proposed column,
  not built) else `family_groups[family]`. No group = not priced (checkout 503 `pricing_unavailable`, hold released).
- `shipping.free_threshold_pence` may be `null` (no spend threshold; free only by `free_at_qty`).
- Promotion codes and recovery links are off once the 10+ price applies.
- Selection: `GET /api/stock?ladder=M1_mert_list`, `POST /api/checkout {ladder: "M1_mert_list", ...}` ONLY when
  `VERCEL_ENV=preview` or `KL_LADDER_PREVIEW=1`; production ignores the parameter. `POST /api/checkout
  {dry_run: true, ...}` (preview only) prices a Gradient-only bag and returns the numbers: no DB, no Stripe.
- Bundled by `vercel.json` `includeFiles: "{ladders.json,ladders-preview/*.json}"`; every file there must be listed
  in `PREVIEW_LADDERS` (test).

## Changelog

- 2026-11-23 — M1 page + go-live kit (`feat/ladder-m1-on-master`): index.html reads mode `cart_qty_groups` from
  /api/stock (dormant with the pools table: page output sha256-pinned, old-vs-new page text equal); cart line from THIS
  cart (`Add N more …: your total becomes £X with free delivery` / `Add 1 more: total drops to £X …` / `Add N more to
  unlock 10+ prices (from £x each) …`), also above Secure Checkout; `cartSummary()` unlock fields; legacy exports safe
  with an M1 default; pools-table tests pinned to `tests/fixtures/ladders.live-2026-11-23.json`. Go-live = one commit,
  `docs/GO_LIVE_M1.patch` (runbook + rollback + DB SQL: `docs/GO_LIVE_M1.md`). No 'capped' option (Mert 23 Nov).
- 2026-11-23 — `cart_qty_groups` mode + preview table `M1_mert_list` (preview/test only). Live default outputs
  byte-identical (before/after snapshot of live + 7 fixtures + checkout params + /api/stock).

- 2026-11-23 — Delivery fee display (CMA209 §5.14/5.17–5.21): delivery-inclusive rolling bag total, fee next to
  every price and every free-delivery claim, "6 for £14.99" from the table. Display only; no price or amount changed.
- 2026-11-23 — PR-1 ladder engine: table-driven pools, monotonic rule, shipping block, `rules` extension point,
  `progress()`, `ladders` in `/api/stock`. Default table = live behaviour (before/after diff empty).
