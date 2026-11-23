// Mode 'cart_qty_groups' + preview fixture ladders-preview/M1_mert_list.json (Mert's list, 23 Nov 2026; K-046).
//   A £5 / 10+ £1.50 · B £8 / 10+ £2.40 · C £13 / 10+ £3.90; 10+ = ALL units in the cart, groups mixed;
//   1–9 units pay the single price (no intermediate steps); delivery £1.49, free with 10+ units.
// NON-MONOTONIC BY DESIGN: 9 × £8 = £72 but 10 × £2.40 = £24. The tests pin exactly where (q = 4..9 cost more than
// 10 in every group) and that the cart answers with "Add 1 more: all 10 for £24.00".
// The live default table is untouched: tests/ladders.test.mjs (golden + legacy) stays green.
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  LADDERS, loadLadders, priceUnits, freeShipping, shippingFeeP, poolTotalP, publicLadders, progress, cartSummary,
  groupKey, lineGroup, previewLadders, previewAllowed, PREVIEW_LADDERS, MODE_GROUPS,
} from '../api/_pricing.js'
import { createHandler } from '../api/checkout.js'
import stockHandler from '../api/stock.js'
import { GRADIENT } from '../api/_gradient.js'

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const RAW = json('../ladders-preview/M1_mert_list.json')
const loaded = loadLadders(RAW)
assert.ok(loaded.ok, loaded.error)
const M1 = loaded.table
const [G1, G2] = Object.keys(GRADIENT)
const grp = (group, n) => Array.from({ length: n }, () => ({ ladder: false, unitP: 599, group })) // unitP = till price, ignored
const grad = (n) => Array.from({ length: n }, () => ({ ladder: true }))
const total = (units) => priceUnits(units.map((u) => ({ ...u })), M1)
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}

test('M1 fixture loads in mode cart_qty_groups; NOT the live table', () => {
  assert.equal(M1.mode, MODE_GROUPS)
  assert.equal(M1.tierFrom, 10)
  assert.deepEqual(Object.fromEntries(Object.entries(M1.groups).map(([k, g]) => [k, [g.single, g.tier_each]])), { A: [500, 150], B: [800, 240], C: [1300, 390] })
  assert.equal(M1.gradientGroup, 'B')
  assert.deepEqual({ ...M1.freeShip }, { fromP: null, units: 10, feeP: 149, derivedFrom: null })
  assert.notEqual(LADDERS.version, M1.version)
  assert.equal(LADDERS.mode, undefined, 'live table stays in the pools model')
  assert.deepEqual(PREVIEW_LADDERS, ['M1_mert_list'])
})

test('one group, 1 / 5 / 9 units: n × single, penny-exact (A £5, B £8, C £13)', () => {
  const want = { A: [500, 2500, 4500], B: [800, 4000, 7200], C: [1300, 6500, 11700] }
  for (const [k, w] of Object.entries(want)) assert.deepEqual([1, 5, 9].map((q) => total(grp(k, q))), w, k)
  assert.deepEqual([1, 5, 9].map((q) => total(grad(q))), [800, 4000, 7200], 'Gradient Edit = group B')
})

test('10 units of one group: every unit at the 10+ price (£15.00 / £24.00 / £39.00)', () => {
  for (const [k, each, sum] of [['A', 150, 1500], ['B', 240, 2400], ['C', 390, 3900]]) {
    const u = grp(k, 10)
    assert.equal(priceUnits(u, M1), sum)
    assert.ok(u.every((x) => x.price === each && x.pool === k && x.single === M1.groups[k].single))
  }
  assert.equal(total(grad(10)), 2400)
  assert.equal(total(grp('A', 11)), 1650, '11 = 11 × £1.50 (no further steps)')
})

test('10 units MIXED across A + B + C: all at 10+ prices; the 10-count is shared across groups', () => {
  const u = [...grp('A', 4), ...grp('B', 3), ...grp('C', 3)]
  assert.equal(priceUnits(u, M1), 4 * 150 + 3 * 240 + 3 * 390) // 2490
  assert.equal(priceUnits([...grp('A', 4), ...grp('B', 3), ...grp('C', 3)], M1), 2490)
  assert.deepEqual(u.map((x) => x.price), [150, 150, 150, 150, 240, 240, 240, 390, 390, 390])
  assert.equal(u.reduce((s, x) => s + x.price, 0), 2490, 'line items sum exactly')
  // Gradient (B) mixes with the other groups
  assert.equal(total([...grad(2), ...grp('A', 1), ...grp('C', 7)]), 2 * 240 + 150 + 7 * 390)
  // 1 of each group (3 units) = singles
  assert.equal(total([...grp('A', 1), ...grp('B', 1), ...grp('C', 1)]), 500 + 800 + 1300)
})

test('9 + 1 boundary: the 10th unit (any group) re-prices the whole bag', () => {
  assert.equal(total(grp('B', 9)), 7200)
  assert.equal(total([...grp('B', 9), ...grp('A', 1)]), 9 * 240 + 150) // 2310
  assert.equal(total([...grp('B', 9), ...grp('C', 1)]), 9 * 240 + 390) // 2550
  const nine = [...grp('A', 3), ...grp('B', 3), ...grp('C', 3)]
  assert.equal(total(nine), 3 * 500 + 3 * 800 + 3 * 1300) // 7800
  assert.equal(total([...nine, ...grp('A', 1)]), 4 * 150 + 3 * 240 + 3 * 390) // 2490
})

test('MONOTONIC RULE: violated by design ONLY at 9 -> 10; q = 4..9 cost more than 10 in every group', () => {
  for (const k of ['A', 'B', 'C']) {
    const f = [0, ...range(1, 99).map((q) => total(grp(k, q)))]
    const breaks = range(1, 98).filter((q) => f[q] > f[q + 1])
    assert.deepEqual(breaks, [9], `${k}: the only drop is 9 -> 10`)
    const dearerThan10 = range(1, 9).filter((q) => f[q] > f[10])
    assert.deepEqual(dearerThan10, [4, 5, 6, 7, 8, 9], `${k}: 3 singles = the 10 price, 4..9 cost more than 10`)
    assert.equal(f[3], f[10], `${k}: 3 × single = 10 × 10+ price`)
    for (let q = 1; q <= 99; q++) assert.ok(f[q] <= q * M1.groups[k].single, `${k} ${q}: never above n × single`)
  }
  assert.deepEqual([total(grp('B', 9)), total(grp('B', 10))], [7200, 2400], '9 × £8 = £72 vs 10 × £2.40 = £24')
  // the loader refuses this model with monotonic: true (the pools model would charge 4..9 at the 10 price)
  const raw = structuredClone(RAW); raw.rule.monotonic = true
  assert.match(loadLadders(raw).error, /non-monotonic by design/)
})

test('cart answer to the non-monotonic step: progress() says "Add 1 more: total drops to £24.00", cartSummary shows both prices', () => {
  let r = progress(grp('B', 9), M1)
  assert.deepEqual(r.next_tier, { pool: 'B', qty: 10, add: 1, total_pence: 2400, each_pence: null, same_total: false })
  assert.deepEqual(r.free_delivery_gap, { pence: null, units: 1 })
  assert.deepEqual(r.lines, ['Add 1 more: total drops to £24.00 with free delivery'])
  // mixed bag of 7: the unlock total pads with the cheapest group IN THE CART (Komuta rule 23 Nov)
  r = progress([...grp('C', 2), ...grp('A', 5)], M1)
  assert.equal(r.next_tier.add, 3)
  assert.equal(r.next_tier.total_pence, 2 * 390 + 5 * 150 + 3 * 150)
  assert.equal(r.lines[0], 'Add 3 more: your total becomes £19.80 with free delivery')
  r = progress(grp('A', 10), M1)
  assert.deepEqual([r.next_tier, r.best_unlocked, r.free_delivery_gap, r.lines], [null, true, null, ['Best multi-buy price unlocked']])
  for (let q = 1; q <= 12; q++) for (const k of ['A', 'B', 'C']) for (const line of progress(grp(k, q), M1).lines) assert.doesNotMatch(line, /%|save|was|off\b/i)

  let s = cartSummary(grp('B', 9), M1)
  assert.deepEqual([s.single_total_pence, s.tier_total_pence, s.charged_pence, s.difference_pence, s.to_unlock, s.unlock_total_pence], [7200, 2160, 7200, 0, 1, 2400])
  s = cartSummary(grp('B', 10), M1)
  assert.deepEqual([s.single_total_pence, s.charged_pence, s.difference_pence, s.tier_unlocked, s.to_unlock], [8000, 2400, 5600, true, 0])
  s = cartSummary([...grp('A', 4), ...grad(3), ...grp('C', 3)], M1)
  assert.deepEqual([s.single_total_pence, s.charged_pence, s.difference_pence], [4 * 500 + 3 * 800 + 3 * 1300, 2490, 8300 - 2490])
  assert.deepEqual(s.groups.map((x) => [x.group, x.qty, x.each_charged]), [['A', 4, 150], ['B', 3, 240], ['C', 3, 390]])
  assert.throws(() => cartSummary(grad(1)), /not in cart_qty_groups/, 'live table has no group summary')
})

test('shipping: £1.49 for 1–9 units whatever the spend, free from 10 units', () => {
  for (const [units, fee] of [[grp('C', 9), 149], [grp('A', 1), 149], [grp('A', 10), 0], [[...grp('A', 9), ...grp('C', 1)], 0]]) {
    const amt = total(units)
    assert.equal(shippingFeeP(amt, units.length, M1), fee)
  }
  assert.equal(freeShipping(999999, 9, M1), false, 'no spend threshold: £117 of C still pays delivery')
  assert.equal(freeShipping(0, 10, M1), true)
  // totals incl. delivery
  assert.equal(total(grp('B', 9)) + shippingFeeP(7200, 9, M1), 7349)
  assert.equal(total(grp('B', 10)) + shippingFeeP(2400, 10, M1), 2400)
  assert.equal(total(grp('A', 1)) + shippingFeeP(500, 1, M1), 649)
})

test('groups: Gradient -> B; DB family map (hair split is NOT mappable); online_group wins; ungrouped never priced', () => {
  assert.equal(groupKey({ ladder: true }, M1), 'B')
  assert.equal(lineGroup({ family: 'stretch_charm' }, M1), 'B')
  assert.equal(lineGroup({ family: 'stretch_double' }, M1), 'C')
  assert.equal(lineGroup({ family: 'necklace_lux_stone' }, M1), 'C')
  assert.equal(lineGroup({ family: 'diamond' }, M1), 'C')
  assert.equal(lineGroup({ family: 'hair' }, M1), null, 'Hair Clips (B) and Hair Claws (C) share one DB family: per-product group needed')
  assert.equal(lineGroup({ family: 'hair', online_group: 'B' }, M1), 'B')
  assert.equal(lineGroup({ family: 'stretch_charm', online_group: 'Z' }, M1), null, 'an unknown own group is not silently re-mapped')
  assert.equal(lineGroup({ family: 'stretch_charm' }, LADDERS), null, 'live table: no groups')
  assert.throws(() => priceUnits([{ ladder: false, unitP: 599 }], M1), /ungrouped unit/)
  assert.throws(() => priceUnits(grp('Z', 1), M1), /ungrouped unit/)
  const noGrad = structuredClone(RAW); noGrad.gradient_group = null
  assert.throws(() => priceUnits(grad(1), loadLadders(noGrad).table), /gradient not sold/)
  assert.throws(() => poolTotalP('B', 3, M1), /depend on the whole cart/)
  assert.throws(() => priceUnits(grp('A', 100), M1), /above max_units/)
})

test('publicLadders(M1): mode, groups, tier, shipping (what /api/stock serves on a preview)', () => {
  const v = publicLadders(M1)
  assert.equal(v.mode, 'cart_qty_groups')
  assert.deepEqual(v.rule, { monotonic: false, monotonic_exception: 'cart_qty_threshold', rounding: 'integer-pence-floor-spread', max_units: 99 })
  assert.deepEqual(v.cart_qty_tier, { from: 10, counts: 'all_units' })
  assert.deepEqual(v.groups.B, { label: RAW.groups.B.label, single: 800, tier_each: 240 })
  assert.deepEqual(v.shipping, { free_threshold_pence: null, below_threshold_fee_pence: 149, free_at_qty: { enabled: true, qty: 10 }, derived_from: null })
  assert.equal(v.gradient_group, 'B')
})

test('a broken cart_qty_groups table never loads (fail closed)', () => {
  const bad = {
    'unknown mode': (t) => { t.mode = 'percent' },
    'monotonic true': (t) => { t.rule.monotonic = true },
    'no exception': (t) => { delete t.rule.monotonic_exception },
    'tier from 1': (t) => { t.cart_qty_tier.from = 1 },
    'tier counts': (t) => { t.cart_qty_tier.counts = 'per_group' },
    'tier above single': (t) => { t.groups.A.tier_each = 501 },
    'float price': (t) => { t.groups.B.single = 7.99 },
    'lower-case group': (t) => { t.groups.a = t.groups.A },
    'no groups': (t) => { delete t.groups },
    'gradient_group unknown': (t) => { t.gradient_group = 'D' },
    'family -> unknown group': (t) => { t.family_groups.hair = 'D' },
    'family key gradient': (t) => { t.family_groups.gradient = 'B' },
    'pools mixed in': (t) => { t.pools = { gradient: { single: 299 } } },
    'derive threshold': (t) => { t.shipping.derive_threshold = { pool: 'B', qty: 3 } },
    'threshold float': (t) => { t.shipping.free_threshold_pence = 11.98 },
    'rule present': (t) => { t.rules = [{ type: 'cart_discount' }] },
  }
  for (const [label, mutate] of Object.entries(bad)) {
    const t = structuredClone(RAW); mutate(t)
    const r = loadLadders(t)
    assert.equal(r.ok, false, label)
    assert.match(r.error, /^ladders:/, label)
  }
  assert.equal(loadLadders(structuredClone(RAW)).ok, true)
})

test('preview selection: only on a Vercel preview or KL_LADDER_PREVIEW=1; production ignores it', async () => {
  await withEnv({ VERCEL_ENV: 'production', KL_LADDER_PREVIEW: undefined }, () => {
    assert.equal(previewAllowed(), false)
    assert.equal(previewLadders('M1_mert_list'), null)
  })
  await withEnv({ VERCEL_ENV: undefined, KL_LADDER_PREVIEW: undefined }, () => assert.equal(previewLadders('M1_mert_list'), null))
  await withEnv({ VERCEL_ENV: 'preview', KL_LADDER_PREVIEW: undefined }, () => {
    const r = previewLadders('M1_mert_list')
    assert.equal(r.ok, true); assert.equal(r.table.version, M1.version)
    assert.equal(previewLadders(''), null)
    assert.match(previewLadders('../ladders').error, /unknown preview ladder/)
  })
  // every file in ladders-preview/ is listed and loads
  const files = readdirSync(new URL('../ladders-preview/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  assert.deepEqual(files.sort(), [...PREVIEW_LADDERS].sort())
})

test('deploy: ladders-preview is bundled (vercel.json includeFiles); no import.meta in api/*.js (Vercel CJS)', () => {
  const v = json('../vercel.json')
  for (const fn of ['api/checkout.js', 'api/stock.js']) {
    assert.match(v.functions[fn].includeFiles, /ladders\.json/)
    assert.match(v.functions[fn].includeFiles, /ladders-preview\/\*\.json/)
  }
  for (const f of readdirSync(new URL('../api/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    // code lines only (comments may explain the rule)
    assert.doesNotMatch(readFileSync(new URL(`../api/${f}`, import.meta.url), 'utf8'), /^(?!\s*(\/\/|\*)).*import\.meta/m, f)
  }
})

// ---------- /api/checkout and /api/stock with the preview table ----------

const mkDb = (calls) => async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push(url.replace(/^https:\/\/db\.test\/rest\/v1\//, ''))
  const ok = (b) => ({ ok: true, status: 200, json: async () => b })
  if (url.includes('/product_barcodes?')) return ok(decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',').map((b) => ({ barcode: b, product_id: 'p' + b })))
  if (url.includes('/stock_levels?')) return ok(url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((x) => ({ product_id: x, stockroom_count: 50 })))
  if (url.includes('/online_orders?')) return ok([])
  if (url.includes('/rpc/fn_karmi_checkout_reserve')) {
    const fam = { S1: 'stretch_charm', D1: 'stretch_double', N1: 'necklace_lux_stone', H1: 'hair' }
    const lines = body.p_items.map((i) => ({ bc: i.bc, product_id: 'p', family: fam[i.bc], price_pence: 599, name: 'Item ' + i.bc }))
    return ok({ ok: true, ref: 'r', short_session: lines.length > 0, recovery_ok: !lines.length, lines })
  }
  return ok(1)
}
const runCheckout = async (body) => {
  const calls = []
  const stripe = { created: [], checkout: { sessions: { create: async (x) => { stripe.created.push(x); return { id: 'cs', url: 'u' } } } } }
  const h = createHandler({ stripe, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: mkDb(calls), now: () => new Date('2026-11-25T12:00:00Z') })
  let status, out
  const res = { status(c) { status = c; return this }, json(b) { out = b; return this }, end() { return this } }
  await h({ method: 'POST', headers: {}, body, query: {} }, res)
  const s = stripe.created[0]
  return { status, out, calls, s, total: s && s.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0), ship: s && s.shipping_options[0].shipping_rate_data.fixed_amount.amount }
}

test('/api/checkout + M1 on a preview: Stripe lines = group prices, shipping, promo codes off at 10+', async () => {
  await withEnv({ KL_LADDER_PREVIEW: '1' }, async () => {
    let r = await runCheckout({ ladder: 'M1_mert_list', items: [{ bc: G1, qty: 5 }, { bc: G2, qty: 4 }] })
    assert.deepEqual([r.status, r.total, r.ship, r.s.allow_promotion_codes], [200, 7200, 149, true])
    r = await runCheckout({ ladder: 'M1_mert_list', items: [{ bc: G1, qty: 6 }, { bc: G2, qty: 4 }] })
    assert.deepEqual([r.status, r.total, r.ship, r.s.allow_promotion_codes], [200, 2400, 0, false])
    assert.deepEqual(r.s.after_expiration, { recovery: { enabled: false } })
    // mixed: Gradient (B) + Stretch Charm (B, family map) + Stretch Double (C) + Necklace Lux Stone (C) = 10
    r = await runCheckout({ ladder: 'M1_mert_list', items: [{ bc: G1, qty: 4 }, { bc: 'S1', qty: 3 }, { bc: 'D1', qty: 2 }, { bc: 'N1', qty: 1 }] })
    assert.deepEqual([r.status, r.total, r.ship], [200, 7 * 240 + 3 * 390, 0])
    assert.deepEqual(r.s.line_items.map((l) => [l.price_data.product_data.name.split(' · ')[0], l.price_data.unit_amount, l.quantity]),
      [[G1, 240, 4], ['S1', 240, 3], ['D1', 390, 2], ['N1', 390, 1]])
    // hair: no group (Clips B / Claws C split) -> 503, hold released, nothing sent to Stripe
    r = await runCheckout({ ladder: 'M1_mert_list', items: [{ bc: G1, qty: 2 }, { bc: 'H1', qty: 1 }] })
    assert.deepEqual([r.status, r.out.error, r.s], [503, 'pricing_unavailable', undefined])
    assert.ok(r.calls.some((c) => c.includes('fn_karmi_checkout_release')), 'hold released')
    r = await runCheckout({ ladder: 'nope', items: [{ bc: G1, qty: 1 }] })
    assert.deepEqual([r.status, r.out.error], [400, 'unknown_ladder'])
  })
})

test('/api/checkout in PRODUCTION ignores ladder=M1 (default table: 3 Gradient = £7.50)', async () => {
  await withEnv({ KL_LADDER_PREVIEW: undefined, VERCEL_ENV: 'production' }, async () => {
    const r = await runCheckout({ ladder: 'M1_mert_list', dry_run: true, items: [{ bc: G1, qty: 3 }] })
    assert.deepEqual([r.status, r.total, r.ship], [200, 750, 149], 'dry_run and ladder both ignored: a normal checkout')
  })
})

test('/api/checkout dry_run (preview only): priced numbers, no DB, no Stripe', async () => {
  await withEnv({ KL_LADDER_PREVIEW: '1' }, async () => {
    let r = await runCheckout({ ladder: 'M1_mert_list', dry_run: true, items: [{ bc: G1, qty: 9 }, { bc: G2, qty: 1 }] })
    assert.equal(r.status, 200)
    assert.deepEqual(r.calls, [], 'no DB call'); assert.equal(r.s, undefined, 'no Stripe call')
    assert.deepEqual([r.out.dry_run, r.out.ladder, r.out.mode, r.out.units, r.out.amount_pence, r.out.shipping_pence], [true, 'M1_mert_list-2026-11-23', 'cart_qty_groups', 10, 2400, 0])
    assert.deepEqual(r.out.line_items, [{ bc: G1, unit_amount: 240, quantity: 9 }, { bc: G2, unit_amount: 240, quantity: 1 }])
    assert.deepEqual([r.out.summary.single_total_pence, r.out.summary.difference_pence], [8000, 5600])
    r = await runCheckout({ dry_run: true, items: [{ bc: G1, qty: 3 }] })
    assert.deepEqual([r.out.mode, r.out.amount_pence, r.out.shipping_pence, r.out.summary], ['pools', 750, 149, null], 'default table dry run')
    r = await runCheckout({ ladder: 'M1_mert_list', dry_run: true, items: [{ bc: 'S1', qty: 1 }] })
    assert.deepEqual([r.status, r.out.error], [400, 'dry_run_gradient_only'])
  })
})

test('/api/stock ?ladder=M1_mert_list: M1 view on a preview, default table in production', async () => {
  const saved = process.env.OPS_SUPABASE_URL
  delete process.env.OPS_SUPABASE_URL
  try {
    let body
    const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
    await withEnv({ KL_LADDER_PREVIEW: '1' }, async () => {
      await stockHandler({ query: { ladder: 'M1_mert_list' } }, res)
      assert.equal(body.ladders.mode, 'cart_qty_groups')
      assert.equal(body.ladders.version, 'M1_mert_list-2026-11-23')
      await stockHandler({ query: { ladder: 'nope' } }, res)
      assert.equal(body.ladders, null)
    })
    await withEnv({ KL_LADDER_PREVIEW: undefined, VERCEL_ENV: 'production' }, async () => {
      await stockHandler({ query: { ladder: 'M1_mert_list' } }, res)
      assert.equal(body.ladders.version, LADDERS.version)
      assert.equal(body.ladders.mode, undefined)
    })
  } finally {
    if (saved !== undefined) process.env.OPS_SUPABASE_URL = saved
  }
})

// Komuta rule (23 Nov 2026): the "Add N more" figure is THIS cart completed to 10 with the cheapest group already in it
// (10+ prices, delivery free). "drops/becomes" only when that is below the bag now (delivery included); otherwise
// "Add N more to unlock 10+ prices (from £x each) and free UK delivery". Never a generic "cheapest 10" (£15).
test('Komuta unlock line: 1–4 unit carts, mixed and single-group, penny-exact', () => {
  const line = (u) => progress(u, M1).lines[0]
  const sum = (u) => cartSummary(u, M1)
  const cases = [
    // [cart, unlock_total, lowers?, line]
    [grp('A', 1), 1500, false, 'Add 9 more to unlock 10+ prices (from £1.50 each) and free UK delivery'],
    [[...grp('A', 1), ...grp('B', 1)], 150 + 240 + 8 * 150, false, 'Add 8 more to unlock 10+ prices (from £1.50 each) and free UK delivery'],
    [[...grp('A', 1), ...grp('B', 1), ...grp('C', 1)], 150 + 240 + 390 + 7 * 150, true, 'Add 7 more: your total becomes £18.30 with free delivery'],
    [[...grp('A', 2), ...grp('B', 1), ...grp('C', 1)], 300 + 240 + 390 + 6 * 150, true, 'Add 6 more: your total becomes £18.30 with free delivery'],
    [grp('A', 2), 1500, false, 'Add 8 more to unlock 10+ prices (from £1.50 each) and free UK delivery'],
    [grp('A', 3), 1500, true, 'Add 7 more: your total becomes £15.00 with free delivery'],   // 3 x £5 + £1.49 = £16.49 > £15
    [grp('A', 4), 1500, true, 'Add 6 more: your total becomes £15.00 with free delivery'],
    [grad(1), 2400, false, 'Add 9 more to unlock 10+ prices (from £2.40 each) and free UK delivery'],
    [grad(2), 2400, false, 'Add 8 more to unlock 10+ prices (from £2.40 each) and free UK delivery'],   // £17.49 < £24
    [grad(3), 2400, true, 'Add 7 more: your total becomes £24.00 with free delivery'],             // £25.49 > £24
    [grad(4), 2400, true, 'Add 6 more: your total becomes £24.00 with free delivery'],
    [grp('C', 1), 3900, false, 'Add 9 more to unlock 10+ prices (from £3.90 each) and free UK delivery'],
    [grp('C', 2), 3900, false, 'Add 8 more to unlock 10+ prices (from £3.90 each) and free UK delivery'],
    [grp('C', 3), 3900, true, 'Add 7 more: your total becomes £39.00 with free delivery'],
    [grp('C', 4), 3900, true, 'Add 6 more: your total becomes £39.00 with free delivery'],
    [grp('B', 9), 2400, true, 'Add 1 more: total drops to £24.00 with free delivery'],
  ]
  for (const [u, unlock, lowers, want] of cases) {
    const s = sum(u)
    assert.equal(s.unlock_total_pence, unlock, want)
    assert.equal(s.unlock_lowers_total, lowers, want)
    assert.equal(s.unlock_lowers_total, s.unlock_total_pence + s.unlock_shipping_pence < s.charged_pence + s.shipping_pence)
    assert.equal(line(u), want)
  }
  // a Gradient-only (group B) cart never pads with group A: £2.40, not £1.50
  assert.equal(sum(grad(5)).unlock_group, 'B')
  assert.equal(sum(grad(5)).unlock_tier_each_pence, 240)
  // the generic "cheapest 10 = £15.00" never appears for a cart without group A
  for (let q = 1; q <= 9; q++) for (const u of [grad(q), grp('C', q), [...grad(Math.ceil(q / 2)), ...grp('C', Math.floor(q / 2))]]) {
    assert.doesNotMatch(line(u), /£15\.00/, String(q))
  }
})
