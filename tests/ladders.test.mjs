// Table-driven multi-buy engine (api/_pricing.js + ladders.json, 23 Nov 2026).
//   1. The default ladders.json = the live table: golden 1..12 and a full comparison with the frozen pre-table code
//      (tests/fixtures/legacy-pricing.mjs) — zero behaviour change.
//   2. The same checks on three TEST fixtures (tests/fixtures/ladders.{A,B,C}.json = options A/B/C; never live):
//      monotonic, never above n × single, penny-exact, pools shared by price, mixed carts, known points, shipping.
//   3. Fail closed: a broken table / missing pool never prices anything; /api/checkout answers 503 before reserving.
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LADDERS, LADDERS_ERROR, loadLadders, priceUnits, freeShipping, shippingFeeP, poolTotalP, poolKey, publicLadders,
  applyCartRules, progress, SHIP_FEE_P,
  bestPriceP, ladderTotalP, UNIT, DENOMS, FREE_SHIP_P, FREE_SHIP_UNITS,
} from '../api/_pricing.js'
import * as legacy from './fixtures/legacy-pricing.mjs'
import { createHandler } from '../api/checkout.js'
import stockHandler, { _setLadders } from '../api/stock.js'
import { GRADIENT } from '../api/_gradient.js'

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const RAW_LIVE = json('./fixtures/ladders.live-2026-11-23.json') // = ladders.json until the M1 go-live (tests/m1-page.test.mjs)
const FIX = Object.fromEntries(['A', 'B', 'C', 'shipping_30', 'steps_1_10', 'steps_20', 'no_mid'].map((k) => {
  const r = loadLadders(json(`./fixtures/ladders.${k}.json`))
  assert.ok(r.ok, `fixture ${k}: ${r.error}`)
  return [k, r.table]
}))
const [G1, G2] = Object.keys(GRADIENT)
const g = (n) => Array.from({ length: n }, () => ({ ladder: true }))
const p = (price, n) => Array.from({ length: n }, () => ({ ladder: false, unitP: price }))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ---------- 1. default table = live behaviour ----------

test('default ladders.json loads: only the gradient pool, £12 / 5 units free shipping, monotonic rule on', () => {
  assert.equal(LADDERS_ERROR, null)
  assert.ok(LADDERS)
  assert.deepEqual(Object.keys(LADDERS.pools), ['gradient'], 'no family multi-buy in the live table')
  assert.deepEqual({ ...LADDERS.freeShip }, { fromP: 1200, units: 5, feeP: 149, derivedFrom: null })
  assert.deepEqual(RAW_LIVE.shipping, { free_threshold_pence: 1200, below_threshold_fee_pence: 149, free_at_qty: { enabled: true, qty: 5 }, derive_threshold: null })
  assert.deepEqual(RAW_LIVE.rules, [], 'no cart-level rules')
  assert.equal(RAW_LIVE.ui.progress_line, false, 'new bag progress line OFF: customers see today\'s bag text')
  assert.equal(RAW_LIVE.rule.monotonic, true)
  // backward-compatible exports keep their old values
  assert.equal(UNIT, legacy.UNIT)
  assert.deepEqual(DENOMS, legacy.DENOMS)
  assert.equal(FREE_SHIP_P, legacy.FREE_SHIP_P)
  assert.equal(FREE_SHIP_UNITS, legacy.FREE_SHIP_UNITS)
  assert.equal(SHIP_FEE_P, 149)
})

test('GOLDEN live table, 1..12: Gradient £2.99/5.50/7.50/10.49/12/14.99/17.50/19.50/22.49/24/26.99/29.50; families n × single', () => {
  const want = [299, 550, 750, 1049, 1200, 1499, 1750, 1950, 2249, 2400, 2699, 2950]
  assert.deepEqual(range(1, 12).map(ladderTotalP), want)
  assert.deepEqual(range(1, 12).map((q) => priceUnits(g(q))), want)
  for (const price of [400, 599, 799, 999]) {
    assert.deepEqual(range(1, 12).map((q) => priceUnits(p(price, q))), range(1, 12).map((q) => q * price), `£${price / 100}`)
  }
})

test('BEFORE/AFTER: default table = frozen pre-table code on every quantity 1..99, mixed carts and shipping (diff empty)', () => {
  const diffs = []
  const same = (label, mk) => {
    const a = mk(), b = mk()
    const ta = legacy.priceUnits(a), tb = priceUnits(b)
    if (ta !== tb || JSON.stringify(a.map((u) => u.price)) !== JSON.stringify(b.map((u) => u.price))) diffs.push(label)
  }
  for (let q = 1; q <= 99; q++) {
    if (legacy.bestPriceP(q) !== bestPriceP(q) || legacy.ladderTotalP(q) !== ladderTotalP(q)) diffs.push(`ladder ${q}`)
    same(`G${q}`, () => g(q))
  }
  for (const price of [1, 250, 299, 400, 599, 799, 999, 1234]) for (let q = 1; q <= 12; q++) same(`P${price}x${q}`, () => p(price, q))
  for (let lq = 0; lq <= 12; lq++) for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let c = 0; c <= 3; c++) {
    if (lq + a + b + c) same(`M${lq}/${a}/${b}/${c}`, () => [...p(400, a), ...g(lq), ...p(599, b), ...p(999, c)])
  }
  for (let amt = 0; amt <= 3000; amt++) for (const u of [1, 4, 5, 6, 12]) {
    if (legacy.freeShipping(amt, u) !== freeShipping(amt, u)) diffs.push(`ship ${amt}/${u}`)
  }
  assert.deepEqual(diffs, [], 'before/after output difference must be empty')
})

test('page pricing block mirrors the table: DENOMS, PRICE and FREE_SHIP in index.html = ladders.json', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const block = html.match(/\/\*KL-PRICING-START\*\/([\s\S]*?)\/\*KL-PRICING-END\*\//)[1]
  const pageDenoms = JSON.parse(block.match(/const DENOMS=(\[[^;]*\]);/)[1]).map(([q, c]) => [q, Math.round(c * 100)])
  const gp = RAW_LIVE.pools.gradient
  const tableDenoms = [...Object.entries(gp.bundles).map(([q, c]) => [Number(q), c]), [1, gp.single]].sort((a, b) => b[0] - a[0])
  assert.deepEqual(pageDenoms, tableDenoms, 'change index.html DENOMS together with ladders.json (until the page reads /api/stock ladders)')
  assert.equal(Math.round(Number(html.match(/\],\s*PRICE=([\d.]+);/)[1]) * 100), gp.single)
  // shipping: the page's fallback SHIP (KL-DELIVERY block) = the table; the texts themselves: tests/delivery.test.mjs
  const ship = html.match(/const SHIP=\{freeP:(\d+), feeP:(\d+), freeQty:(\d+|null)\};/)
  assert.equal(Number(ship[1]), RAW_LIVE.shipping.free_threshold_pence)
  assert.equal(Number(ship[2]), RAW_LIVE.shipping.below_threshold_fee_pence)
  assert.equal(ship[3] === 'null' ? null : Number(ship[3]), RAW_LIVE.shipping.free_at_qty.enabled ? RAW_LIVE.shipping.free_at_qty.qty : null)
})

// ---------- 2. the same checks on fixtures A / B / C ----------

for (const [name, T] of Object.entries(FIX)) {
  test(`fixture ${name}: every pool monotonic, f(1) = single, f(q) <= q × single, q = 1..99`, () => {
    for (const [k, pool] of Object.entries(T.pools)) {
      assert.equal(poolTotalP(k, 1, T), pool.single, `${k} q=1`)
      for (let q = 1; q <= 99; q++) {
        const f = poolTotalP(k, q, T)
        assert.ok(Number.isInteger(f), `${k} q=${q} integer pence`)
        assert.ok(f <= q * pool.single, `${k} q=${q} above n × single`)
        if (q < 99) assert.ok(f <= poolTotalP(k, q + 1, T), `${k}: ${q} costs more than ${q + 1}`)
      }
    }
  })

  test(`fixture ${name}: penny-exact spread, pools shared by price, mixed carts 0..12`, () => {
    for (let lq = 0; lq <= 12; lq++) for (let a = 0; a <= 12; a += 3) for (let b = 0; b <= 6; b++) for (let c = 0; c <= 4; c++) {
      if (!(lq + a + b + c)) continue
      // two different 999 products (Stretch Double + Necklace) and an unpooled price (1234) in one bag
      const units = [...p(599, b), ...g(lq), ...p(400, a), ...p(999, c), ...p(999, c ? 1 : 0), ...p(1234, c % 2)]
      const total = priceUnits(units, T)
      assert.equal(units.reduce((s, u) => s + u.price, 0), total, 'line items sum exactly to the total')
      const n999 = c + (c ? 1 : 0)
      const want = poolTotalP('gradient', lq, T) + poolTotalP('400', a, T) + poolTotalP('599', b, T) + poolTotalP('999', n999, T) + 1234 * (c % 2)
      assert.equal(total, want, `${lq}/${a}/${b}/${c}`)
      for (const k of ['gradient', '400', '599', '999']) {
        const ps = units.filter((u) => u.pool === k).map((u) => u.price)
        if (ps.length) assert.ok(Math.max(...ps) - Math.min(...ps) <= 1, `${k}: units differ by at most 1p`)
      }
      assert.ok(units.filter((u) => u.unitP === 1234).every((u) => u.pool === null && u.price === 1234), 'no pool = single price')
    }
  })
}

test('fixture A known points (05_pr_scope.md §1 table, 1..12)', () => {
  const T = FIX.A
  const want = {
    400: [400, 800, 1200, 1200, 1200, 1600, 1600, 1600, 1600, 1600, 2000, 2400],
    599: [599, 1198, 1198, 1597, 1794, 1794, 2093, 2392, 2691, 2990, 3289, 3588],
    799: [799, 1598, 1598, 2131, 2394, 2394, 2793, 3192, 3591, 3990, 4389, 4788],
    999: [999, 1998, 1998, 2664, 2994, 2994, 3493, 3992, 4491, 4990, 5489, 5988],
    gradient: [299, 550, 750, 1049, 1200, 1499, 1750, 1950, 2249, 2400, 2699, 2950],
  }
  for (const [k, w] of Object.entries(want)) assert.deepEqual(range(1, 12).map((q) => poolTotalP(k, q, T)), w, k)
  // the monotonic rule drops A's "5 for £19.97": 5 units = the 6-unit price
  assert.equal(poolTotalP('599', 5, T), 1794)
})

test('fixtures B and C known points (karmi_price_ladder_options.md)', () => {
  const pts = {
    B: { 400: { 5: 1200, 10: 1600 }, 599: { 5: 1797, 10: 2396 }, 799: { 5: 2397, 10: 3196 }, 999: { 5: 2997, 10: 3996 } },
    C: { 400: { 3: 960, 5: 1400, 10: 2400 }, 599: { 3: 1438, 5: 2096, 10: 3594 }, 799: { 3: 1918, 5: 2796, 10: 4794 }, 999: { 3: 2398, 5: 3496, 10: 5994 } },
  }
  for (const [f, pools] of Object.entries(pts)) for (const [k, qs] of Object.entries(pools)) for (const [q, w] of Object.entries(qs)) {
    assert.equal(poolTotalP(k, Number(q), FIX[f]), w, `${f} ${k} × ${q}`)
  }
  // B: 4 Stretch Charm would cost more than 5 -> monotonic rule charges the 5 price
  assert.equal(poolTotalP('599', 4, FIX.B), 1797)
})

test('shipping from the table, penny-exact: live £12 / £1.49 / 5 items; fixture shipping_30 = £30 / £6.49 / no qty rule', () => {
  // live default (A/B/C carry the same block)
  for (const T of [LADDERS, FIX.A, FIX.B, FIX.C]) {
    assert.equal(freeShipping(1199, 4, T), false); assert.equal(freeShipping(1200, 1, T), true); assert.equal(freeShipping(599, 5, T), true)
    assert.equal(shippingFeeP(1199, 4, T), 149); assert.equal(shippingFeeP(1200, 4, T), 0)
  }
  assert.equal(freeShipping(priceUnits(p(599, 2)), 2), false, 'live: 2 × £5.99 = £11.98 still pays £1.49')
  const S = FIX.shipping_30
  assert.deepEqual({ ...S.freeShip }, { fromP: 3000, units: null, feeP: 649, derivedFrom: null })
  assert.equal(freeShipping(2999, 50, S), false, '1p under £30 is not free, and 50 items do not unlock it (qty rule off)')
  assert.equal(freeShipping(3000, 1, S), true)
  assert.equal(shippingFeeP(2999, 50, S), 649)
  assert.equal(shippingFeeP(3000, 1, S), 0)
})

test('derive_threshold option (off by default) only LOWERS the threshold to a pool total', () => {
  const raw = json('./fixtures/ladders.A.json')
  raw.shipping.derive_threshold = { pool: '599', qty: 3 }
  let T = loadLadders(raw).table
  assert.deepEqual({ ...T.freeShip, derivedFrom: { ...T.freeShip.derivedFrom } }, { fromP: 1198, units: 5, feeP: 149, derivedFrom: { pool: '599', qty: 3 } })
  assert.equal(freeShipping(priceUnits(p(599, 3), T), 3, T), true, '3 × £5.99 = £11.98 ships free when derived')
  raw.shipping.derive_threshold = { pool: '999', qty: 3 }
  T = loadLadders(raw).table
  assert.equal(T.freeShip.fromP, 1200, '£19.98 would raise it: kept at £12')
})

test('steps added/removed by table change only: 1 and 10 only; a 20 step; intermediate 2/3/4/5 removed', () => {
  const S = FIX.steps_1_10
  assert.deepEqual(range(1, 12).map((q) => poolTotalP('400', q, S)), [400, 800, 1200, 1600, 1600, 1600, 1600, 1600, 1600, 1600, 2000, 2400],
    'monotonic: 4..9 items cost what 10 cost (£16)')
  assert.equal(poolTotalP('599', 5, S), 2990, '5 × £5.99 = £29.95 > 10 for £29.90')
  assert.equal(poolTotalP('599', 4, S), 2396)
  const T20 = FIX.steps_20
  assert.equal(poolTotalP('400', 20, T20), 2800)
  assert.equal(poolTotalP('400', 20, FIX.A), 3200, 'without the step: 10 + 10')
  assert.equal(poolTotalP('400', 15, T20), 2800, '15 = the 20 price (monotonic)')
  assert.equal(poolTotalP('gradient', 20, T20), 4400)
  const N = FIX.no_mid
  assert.deepEqual(range(1, 7).map((q) => poolTotalP('599', q, N)), [599, 1198, 1794, 1794, 1794, 1794, 2093])
  assert.deepEqual([8, 9, 10].map((q) => poolTotalP('gradient', q, N)), [2392, 2400, 2400])
})

test('cart-level rules = extension point only: [] accepted, any rule rejected (not implemented), applyCartRules guard', () => {
  const raw = json('./fixtures/ladders.A.json')
  raw.rules = [{ type: 'cart_discount', min_spend_pence: 3000, percent: 10 }]
  const r = loadLadders(raw)
  assert.equal(r.ok, false)
  assert.match(r.error, /cart_discount' not implemented/)
  raw.rules = {}
  assert.match(loadLadders(raw).error, /rules must be an array/)
  assert.equal(applyCartRules(1234, []), 1234)
  assert.equal(applyCartRules(1234), 1234, 'live table: identity')
  assert.throws(() => applyCartRules(1234, [{ type: 'cart_discount' }]), /not implemented/)
})

test('progress(): next tier + free-delivery gap from the table (one function), English lines, no %/save', () => {
  // live table: 1 Gradient
  let r = progress(g(1))
  assert.deepEqual(r.next_tier, { pool: 'gradient', qty: 2, add: 1, total_pence: 550, each_pence: 275, same_total: false })
  assert.deepEqual(r.free_delivery_gap, { pence: 901, units: 4 })
  assert.deepEqual(r.lines, ['Add 1 more: 2 for £5.50 (£2.75 each)', 'Add £9.01 for free delivery'])
  // 3 Gradient (£2.50 each): 4 for £10.49 is dearer per unit, so the next step is 5 for £12 (£2.40 each)
  r = progress(g(3))
  assert.deepEqual([r.next_tier.qty, r.next_tier.total_pence, r.next_tier.each_pence], [5, 1200, 240])
  // 5 Gradient: free, best price unlocked
  r = progress(g(5))
  assert.equal(r.free_delivery_gap, null)
  assert.equal(r.next_tier, null)
  assert.deepEqual(r.lines, ['Best multi-buy price unlocked'])
  // live family product: no pool -> only the delivery line
  r = progress(p(599, 1))
  assert.deepEqual(r.lines, ['Add £6.01 for free delivery'])
  // fixture A £4: 3 for £12 -> 4 is still £12
  r = progress(p(400, 3), FIX.A)
  assert.deepEqual(r.lines[0], 'Add 1 more, still £12.00 (£3.00 each)')
  assert.equal(r.free_delivery_gap, null, '£12 reaches the threshold')
  // fixture shipping_30: 3 × £5.99 = £11.98; next 4 for £15.97 (no rounded "each"); gap £18.02, no unit gap
  r = progress(p(599, 3), FIX.shipping_30)
  assert.deepEqual(r.next_tier, { pool: '599', qty: 4, add: 1, total_pence: 1597, each_pence: null, same_total: false })
  assert.deepEqual(r.free_delivery_gap, { pence: 1802, units: null })
  assert.deepEqual(r.lines, ['Add 1 more: 4 for £15.97', 'Add £18.02 for free delivery'])
  // last touched pool decides; the gap uses the whole bag
  r = progress([...p(999, 1), ...g(1)], FIX.A)
  assert.equal(r.next_tier.pool, 'gradient')
  assert.equal(r.free_delivery_gap, null, '£9.99 + £2.99 = £12.98')
  for (const T of Object.values(FIX)) for (let q = 1; q <= 12; q++) for (const u of [g(q), p(400, q), p(599, q), p(999, q)]) {
    for (const line of progress(u, T).lines) assert.doesNotMatch(line, /%|save|was|off\b/i)
    const gap = progress(u, T).free_delivery_gap
    if (gap) assert.equal(gap.pence, T.freeShip.fromP - priceUnits(u.map((x) => ({ ...x })), T), 'gap is penny-exact')
  }
  assert.equal(LADDERS.progressLine, false, 'live: the page must not show these lines yet')
})

test('pool key = the DB single price; Gradient barcodes always use the gradient pool', () => {
  assert.equal(poolKey({ ladder: true }, FIX.A), 'gradient')
  assert.equal(poolKey({ ladder: false, unitP: 999 }, FIX.A), '999')
  assert.equal(poolKey({ ladder: false, unitP: 649 }, FIX.A), null, 'a price that drifted (WAT £6.49) loses the multi-buy, never mis-pools')
  assert.equal(poolKey({ ladder: false, unitP: 299 }, FIX.A), null, 'a £2.99 non-Gradient product does not join the Gradient ladder')
  assert.equal(poolKey({ ladder: false, unitP: 599 }), null, 'live table: no family pool')
})

test('checkout with fixture A: Stripe lines sum to the pooled total; promo/recovery rules unchanged; derived shipping', async () => {
  const prices = { S1: 599, S2: 599, N1: 999, D1: 999 }
  const calls = []
  const db = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push(url)
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) return ok(decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',').map((b) => ({ barcode: b, product_id: 'p' + b })))
    if (url.includes('/stock_levels?')) return ok(url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((x) => ({ product_id: x, stockroom_count: 50 })))
    if (url.includes('/online_orders?')) return ok([])
    if (url.includes('/rpc/fn_karmi_checkout_reserve')) {
      const lines = body.p_items.map((i) => ({ bc: i.bc, product_id: 'p', family: 'f', price_pence: prices[i.bc], name: 'Item ' + i.bc }))
      return ok({ ok: true, ref: 'r', short_session: lines.length > 0, recovery_ok: !lines.length, lines })
    }
    return ok(1)
  }
  const run = async (items, ladders = FIX.A) => {
    const stripe = { created: [], checkout: { sessions: { create: async (x) => { stripe.created.push(x); return { id: 'cs', url: 'u' } } } } }
    const h = createHandler({ stripe, ladders, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
    let status; const res = { status(c) { status = c; return this }, json() { return this }, end() { return this } }
    await h({ method: 'POST', headers: {}, body: { items } }, res)
    const s = stripe.created[0]
    return { status, s, total: s && s.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0) }
  }
  // 2 × S1 + 1 × S2 (both £5.99) = one pool, 3 for £11.98 (2p under £12: £1.49 shipping, as live)
  let r = await run([{ bc: 'S1', qty: 2 }, { bc: 'S2', qty: 1 }])
  assert.equal(r.status, 200)
  assert.equal(r.total, 1198)
  assert.equal(r.s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 149)
  // same bag with fixture shipping_30: fee from the table (£6.49); 5+ items no longer free
  r = await run([{ bc: 'S1', qty: 3 }, { bc: 'S2', qty: 3 }], FIX.shipping_30)
  assert.equal(r.total, 1794)
  assert.deepEqual([r.s.shipping_options[0].shipping_rate_data.fixed_amount.amount, r.s.shipping_options[0].shipping_rate_data.display_name], [649, 'UK standard shipping'])
  r = await run([{ bc: 'N1', qty: 3 }, { bc: 'D1', qty: 3 }], FIX.shipping_30)
  assert.equal(r.total, 2994)
  assert.equal(r.s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 649, '£29.94: 6p under £30')
  r = await run([{ bc: 'N1', qty: 3 }, { bc: 'D1', qty: 4 }], FIX.shipping_30)
  assert.equal(r.s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0)
  assert.equal(r.s.allow_promotion_codes, false, 'unchanged: no codes once a capped product is in the bag')
  // Necklace + Stretch Double (both £9.99) share one pool; plus 6 Gradient (£14.99); lines sum penny-exactly
  r = await run([{ bc: 'N1', qty: 2 }, { bc: G1, qty: 6 }, { bc: 'D1', qty: 4 }])
  assert.equal(r.total, poolTotalP('999', 6, FIX.A) + 1499)
  assert.equal(r.total, 2994 + 1499)
  // Gradient-only: promo codes + recovery exactly as before
  r = await run([{ bc: G1, qty: 3 }, { bc: G2, qty: 2 }])
  assert.equal(r.total, 1200)
  assert.equal(r.s.allow_promotion_codes, true)
  assert.deepEqual(r.s.after_expiration, { recovery: { enabled: true, allow_promotion_codes: true } })
})

// ---------- 3. fail closed ----------

test('a broken table never loads (fail closed): every malformed shape is rejected with a reason', () => {
  const base = () => json('./fixtures/ladders.A.json')
  const bad = {
    'not an object': () => null,
    'array': () => [],
    'no version': (t) => { delete t.version },
    'no rule': (t) => { delete t.rule },
    'monotonic off': (t) => { t.rule.monotonic = false },
    'unknown rounding': (t) => { t.rule.rounding = 'half-up' },
    'max_units 0': (t) => { t.rule.max_units = 0 },
    'free threshold float': (t) => { t.shipping.free_threshold_pence = 11.98 },
    'no shipping block': (t) => { delete t.shipping },
    'negative fee': (t) => { t.shipping.below_threshold_fee_pence = -1 },
    'free_at_qty not boolean': (t) => { t.shipping.free_at_qty = { enabled: 'yes', qty: 5 } },
    'derive unknown pool': (t) => { t.shipping.derive_threshold = { pool: '123', qty: 3 } },
    'rules missing': (t) => { delete t.rules },
    'rule present': (t) => { t.rules = [{ type: 'cart_discount' }] },
    'progress flag not boolean': (t) => { t.ui = { progress_line: 1 } },
    'no pools': (t) => { delete t.pools },
    'gradient pool missing': (t) => { delete t.pools.gradient },
    'pool key not a price': (t) => { t.pools.hair = t.pools['400'] },
    'pool key != single': (t) => { t.pools['400'].single = 401 },
    'single not integer': (t) => { t.pools.gradient.single = 2.99 },
    'bundle qty 1': (t) => { t.pools['400'].bundles['1'] = 300 },
    'bundle qty above max': (t) => { t.pools['400'].bundles['100'] = 300 },
    'bundle total float': (t) => { t.pools['599'].bundles['3'] = 11.98 },
    'bundle total negative': (t) => { t.pools['599'].bundles['3'] = -1 },
    'bundles as array': (t) => { t.pools['599'].bundles = [[3, 1198]] },
    'tail without each': (t) => { t.pools['599'].tail = { from: 6 } },
    'tail from 1': (t) => { t.pools['599'].tail = { from: 1, each: 100 } },
    'bundle cheaper than single': (t) => { t.pools['999'].bundles['2'] = 500 },
  }
  for (const [label, mutate] of Object.entries(bad)) {
    let t = base()
    const out = mutate(t)
    if (out !== undefined) t = out
    const r = loadLadders(t)
    assert.equal(r.ok, false, label)
    assert.ok(r.error && /^ladders:/.test(r.error), `${label}: ${r.error}`)
  }
  assert.equal(loadLadders(base()).ok, true, 'the untouched fixture still loads')
})

test('no table = no price: priceUnits/freeShipping throw; unknown pool or q above max throws', () => {
  assert.throws(() => priceUnits(g(1), null), /ladder table invalid/)
  assert.throws(() => freeShipping(1200, 1, null), /ladder table invalid/)
  assert.throws(() => poolTotalP('123', 1, FIX.A), /no ladder pool/)
  assert.throws(() => poolTotalP('gradient', 100, FIX.A), /above max_units/)
  assert.throws(() => priceUnits(g(100)), /above max_units/)
  assert.throws(() => priceUnits([{ ladder: false, unitP: 5.99 }], FIX.A), /unpriced/)
})

test('/api/checkout with an invalid table: 503 before any DB reserve or Stripe call', async () => {
  const calls = []
  const stripe = { checkout: { sessions: { create: async () => { calls.push('stripe'); return {} } } } }
  const h = createHandler({ stripe, ladders: null, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: async (u) => { calls.push(u); return { ok: true, json: async () => ({}) } } })
  let status, body
  const res = { status(c) { status = c; return this }, json(b) { body = b; return this }, end() { return this } }
  await h({ method: 'POST', headers: {}, body: { items: [{ bc: G1, qty: 1 }] } }, res)
  assert.equal(status, 503)
  assert.equal(body.error, 'checkout_unavailable')
  assert.deepEqual(calls, [], 'nothing reserved, nothing sent to Stripe')
})

test('/api/stock serves the table as `ladders` (additive); null when the table is invalid', async () => {
  const view = publicLadders()
  assert.equal(view.version, RAW_LIVE.version)
  assert.deepEqual(view.shipping, { free_threshold_pence: 1200, below_threshold_fee_pence: 149, free_at_qty: { enabled: true, qty: 5 }, derived_from: null })
  assert.deepEqual([view.rules, view.ui], [[], { progress_line: false }])
  assert.deepEqual(view.pools.gradient.totals.slice(0, 7), [0, 299, 550, 750, 1049, 1200, 1499])
  assert.deepEqual(view.pools.gradient.bundles, { 2: 550, 3: 750, 5: 1200 })
  assert.equal(view.pools.gradient.totals.length, 100)
  assert.equal(publicLadders(null), null)
  const saved = { url: process.env.OPS_SUPABASE_URL, key: process.env.OPS_SUPABASE_SERVICE_KEY }
  delete process.env.OPS_SUPABASE_URL
  try {
    let body
    const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
    await stockHandler({ query: {} }, res)
    assert.deepEqual(Object.keys(body), ['ok', 'store', 'stock', 'error', 'ladders', 'storefront'], 'old fields first, unchanged; ladders added; storefront flags (PR-2) added')
    assert.equal(body.ladders.version, RAW_LIVE.version)
    _setLadders(null)
    await stockHandler({ query: {} }, res)
    assert.equal(body.ladders, null)
  } finally {
    _setLadders(view)
    if (saved.url !== undefined) process.env.OPS_SUPABASE_URL = saved.url
    if (saved.key !== undefined) process.env.OPS_SUPABASE_SERVICE_KEY = saved.key
  }
})
