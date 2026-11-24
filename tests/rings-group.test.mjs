// Rings price group R (owner decision K-069, 23 Nov 2026): rings £4.00 each, minimum 5 per order ("£20 for any 5 rings"),
// NOT on the 10+ ladder. Narrowest reading until Mert answers the open points:
//   * a bag may mix rings and other items; every other item keeps its price rules;
//   * rings count toward neither the 10+ price nor free delivery (free at 10+ NON-ring items, else £1.49);
//   * 1-4 rings cannot check out: /api/checkout 400 'rings_min_5' with the missing count; 0 or >= 5 rings is fine;
//   * flat £4 (400 p) for any ring quantity >= 5.
// SHIPS DARK: ladders.json carries flat_groups.R with enabled: false. While disabled the live behaviour, the public
// /api/stock ladders view and every page text (hero, meta, FAQ, JSON-LD range) are byte-for-byte what they were.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LADDERS, loadLadders, publicLadders, priceUnits, lineGroup, cartSummary, progress, shipBasis, shippingFeeP,
  flatMinShortfall, isFlatGroup, groupSingleP,
} from '../api/_pricing.js'
import { createHandler } from '../api/checkout.js'
import { GRADIENT } from '../api/_gradient.js'
import { pageFns } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const RAW = JSON.parse(read('../ladders.json'))
const [G1] = Object.keys(GRADIENT)

const withoutFlat = (raw) => { const r = structuredClone(raw); delete r.flat_groups; delete r._doc_flat_groups; return r }
const enabledRaw = () => { const r = structuredClone(RAW); r.flat_groups.R.enabled = true; return r }
const ON = loadLadders(enabledRaw()).table
const OFF_REF = loadLadders(withoutFlat(RAW)).table

// ---------- 1. disabled (live ladders.json) = no change ----------
test('ladders.json carries R exactly as K-069 + K-070 say (rings count toward free delivery), and DISABLED', () => {
  assert.deepEqual(RAW.flat_groups.R, {
    label: 'Rings', unit_name: 'ring', each: 400, min_qty: 5, counts_to_tier: false, counts_to_free_shipping: true, enabled: false,
  })
  assert.ok(LADDERS, 'live table loads')
  assert.deepEqual(Object.keys(LADDERS.flatGroups), [], 'a disabled flat group is not in the loaded table')
  assert.equal(isFlatGroup('R', LADDERS), false)
  assert.equal(groupSingleP('R', LADDERS), null)
  assert.equal(lineGroup({ online_group: 'R', family: 'ring' }, LADDERS), null, 'a ring line is unpriced (checkout 503), never guessed')
  assert.throws(() => priceUnits([{ ladder: false, unitP: 400, group: 'R' }], LADDERS), /ungrouped/)
  assert.ok(!('R' in LADDERS.groups))
})

test('disabled: public /api/stock ladders view is byte-identical to the table without flat_groups, and = the page M1_FALLBACK', () => {
  const live = publicLadders(LADDERS), ref = publicLadders(OFF_REF)
  assert.equal(JSON.stringify(live), JSON.stringify(ref))
  assert.ok(!('flat_groups' in live))
  const fb = JSON.parse(HTML.match(/const M1_FALLBACK=(\{.*?\});   \/\/ GO-LIVE/)[1])
  assert.equal(JSON.stringify(live), JSON.stringify(fb), 'index.html first paint unchanged')
})

const pageTexts = (view, extraGroups = {}) => {
  const p = pageFns(HTML, { ladders: view, groups: extraGroups })
  const T = p.m1Texts()
  return JSON.stringify({ T, count: T.count(15), ship: p.shipSentence(), card: p.cardShipText(), hint: [1, 9, 10, 14].map(p.m1TierHint) })
}

test('disabled: hero / meta / FAQ / CTA / tier-hint texts unchanged (same as the table without R)', () => {
  assert.equal(pageTexts(publicLadders(LADDERS)), pageTexts(publicLadders(OFF_REF)))
  assert.equal(pageTexts(null), pageTexts(publicLadders(OFF_REF)), 'before /api/stock answers (fallback) too')
})

test('even ENABLED, R never enters the ladder groups; texts stay the same except the E1b/E1c "non-ring items" note on 10+ claims', () => {
  const v = publicLadders(ON)
  assert.deepEqual(Object.keys(v.groups), Object.keys(publicLadders(OFF_REF).groups))
  assert.deepEqual(v.flat_groups, { R: { label: 'Rings', unit_name: 'ring', each: 400, min_qty: 5, counts_to_tier: false, counts_to_free_shipping: true, enabled: true } })
  // K&D E1b/E1c: the only text change when rings are ON is 'non-ring' on every 10+ claim (price AND free delivery)
  assert.equal(pageTexts(v).replace(/(Buy \d+\+) non-ring items,/g, '$1,').replace(/ non-ring(?= items?\b)/g, ''), pageTexts(publicLadders(OFF_REF)))
  assert.match(pageTexts(v), /free with any 10\+ non-ring items/)
  assert.match(pageTexts(v), /70% off when you buy any 10\+ non-ring items/)
  assert.doesNotMatch(pageTexts(publicLadders(OFF_REF)), /non-ring/)
})

test('disabled: engine results for non-ring bags identical to the table without R', () => {
  const B = (n) => Array.from({ length: n }, () => ({ ladder: false, unitP: 500, group: 'B' }))
  for (const n of [1, 5, 9, 10, 14]) {
    const a = B(n), b = B(n)
    assert.equal(priceUnits(a, LADDERS), priceUnits(b, OFF_REF))
    assert.deepEqual(shipBasis(a, 0, LADDERS), { amountP: 0, units: n })
    assert.equal(JSON.stringify(cartSummary(B(n), LADDERS)), JSON.stringify(cartSummary(B(n), OFF_REF)))
    assert.equal(JSON.stringify(progress(B(n), LADDERS)), JSON.stringify(progress(B(n), OFF_REF)))
  }
})

// ---------- 2. table validation ----------
test('flat_groups validation fails closed', () => {
  const bad = {
    'counts_to_tier true (not implemented)': (r) => { r.flat_groups.R.counts_to_tier = true },
    'counts_to_free_shipping missing': (r) => { delete r.flat_groups.R.counts_to_free_shipping },
    'counts_to_free_shipping not a boolean': (r) => { r.flat_groups.R.counts_to_free_shipping = 'yes' },
    'enabled missing': (r) => { delete r.flat_groups.R.enabled },
    'float price': (r) => { r.flat_groups.R.each = 3.99 },
    'min 0': (r) => { r.flat_groups.R.min_qty = 0 },
    'key is a ladder group': (r) => { r.flat_groups.B = { ...r.flat_groups.R } },
    'lower-case key': (r) => { r.flat_groups.r = r.flat_groups.R; delete r.flat_groups.R },
    'no unit_name': (r) => { delete r.flat_groups.R.unit_name },
    'family mapped to R': (r) => { r.family_groups.ring = 'R' },
    'not an object': (r) => { r.flat_groups = [] },
  }
  for (const [name, mut] of Object.entries(bad)) {
    const r = structuredClone(RAW); mut(r)
    assert.equal(loadLadders(r).ok, false, name)
  }
  assert.equal(loadLadders(enabledRaw()).ok, true)
})

// ---------- 3. enabled (test-only table): engine ----------
const ring = () => ({ ladder: false, unitP: 299, group: 'R' })
const bItem = () => ({ ladder: false, unitP: 800, group: 'B' })
const bag = (rings, bs) => [...Array.from({ length: rings }, ring), ...Array.from({ length: bs }, bItem)]

test('enabled engine: £4 flat per ring, min 5, not on the ladder, counts toward free delivery (K-070)', () => {
  let u = bag(5, 0); let t = priceUnits(u, ON)
  assert.equal(t, 2000); assert.ok(u.every((x) => x.price === 400 && x.pool === 'R'))
  assert.equal(shippingFeeP(shipBasis(u, t, ON).amountP, shipBasis(u, t, ON).units, ON), 149)
  assert.throws(() => priceUnits(bag(4, 0), ON), /rings_min_5/)
  assert.deepEqual(flatMinShortfall(bag(4, 3), ON), [{ group: 'R', qty: 4, min_qty: 5, add: 1, reason: 'rings_min_5', message: 'Rings are sold in fives or more: add 1 more ring' }])
  assert.equal(flatMinShortfall(bag(2, 0), ON)[0].message, 'Rings are sold in fives or more: add 3 more rings')
  assert.deepEqual(flatMinShortfall(bag(0, 3), ON), [])
  u = bag(9, 10); t = priceUnits(u, ON)
  assert.equal(t, 9 * 400 + 10 * 240); assert.deepEqual(shipBasis(u, t, ON), { amountP: t, units: 19 })
  u = bag(10, 1); t = priceUnits(u, ON)
  assert.equal(t, 4000 + 800); assert.deepEqual(shipBasis(u, t, ON), { amountP: t, units: 11 })
  assert.equal(shippingFeeP(t, 11, ON), 0, '10 rings + 1 item = free delivery')
  // counts_to_free_shipping false still takes them out (the old K-069 reading)
  const OUT = (() => { const r = enabledRaw(); r.flat_groups.R.counts_to_free_shipping = false; return loadLadders(r).table })()
  u = bag(10, 1); t = priceUnits(u, OUT); assert.deepEqual(shipBasis(u, t, OUT), { amountP: 800, units: 1 })
  u = bag(25, 0); assert.equal(priceUnits(u, ON), 10000, 'no tier on rings')
})

test('enabled cartSummary / progress: rings shown at £4, unlock counts non-ring items only, delivery counts rings, min line first', () => {
  const s = cartSummary(bag(3, 9), ON)
  assert.equal(s.units, 12); assert.equal(s.tier_units, 9); assert.equal(s.tier_unlocked, false); assert.equal(s.to_unlock, 1)
  assert.equal(s.charged_pence, 3 * 400 + 9 * 800)
  assert.equal(s.unlock_total_pence, 3 * 400 + 10 * 240)
  assert.equal(s.shipping_pence, 0, '12 items incl. 3 rings = free delivery (K-070)'); assert.equal(s.unlock_shipping_pence, 0)
  assert.equal(s.pct_off, 70, 'the 70% figure is about the ladder groups only')
  assert.equal(s.flat_short[0].add, 2)
  const p = progress(bag(3, 9), ON)
  assert.equal(p.lines[0], 'Rings are sold in fives or more: add 2 more rings')
  assert.equal(p.free_delivery_gap, null, '9 items + 3 rings = 12: free delivery (rings counted)')
  assert.deepEqual(progress(bag(3, 6), ON).free_delivery_gap, { pence: null, units: 1 }, '6 items + 3 rings = 9: 1 more')
  const only = progress(bag(5, 0), ON)
  assert.equal(only.next_tier, null); assert.deepEqual(only.free_delivery_gap, { pence: null, units: 5 })
  assert.equal(progress(bag(10, 0), ON).free_delivery_gap, null, 'ring-only order of 10 = free delivery')
})

// ---------- 4. enabled: /api/checkout (fake Stripe + fake ops DB, no network) ----------
function fakeDb(lines) {
  const calls = []
  const fn = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null })
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) {
      const bcs = decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',')
      return ok(bcs.map((b) => ({ barcode: b, product_id: 'p' + b })))
    }
    if (url.includes('/stock_levels?')) {
      const pids = url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',')
      return ok(pids.map((p) => ({ product_id: p, stockroom_count: 50 })))
    }
    if (url.includes('/rpc/fn_karmi_checkout_reserve')) return ok({ ok: true, ref: 'r', lines, short_session: false, recovery_ok: false })
    if (url.includes('/rpc/fn_karmi_checkout_attach') || url.includes('/rpc/fn_karmi_checkout_release')) return ok(1)
    return ok([])
  }
  fn.calls = calls
  return fn
}
const LINES = [
  { bc: 'RING1', name: 'Gold Ring', price_pence: 299, family: 'ring', online_group: 'R' },
  { bc: 'CLIP1', name: 'Hair Clips', price_pence: 500, family: 'hair', online_group: 'B' },
]
async function checkout(items, ladders = ON) {
  const stripe = { created: [], checkout: { sessions: { create: async (p) => { stripe.created.push(p); return { id: 'cs_test_1', url: 'https://pay/x' } } } } }
  const db = fakeDb(LINES)
  const h = createHandler({ stripe, ladders, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
  let status, json
  const res = { status(c) { status = c; return this }, json(b) { json = b; return this }, end() { return this } }
  const warn = console.warn; console.warn = () => {}
  try { await h({ method: 'POST', headers: {}, body: { items } }, res) } finally { console.warn = warn }
  const p = stripe.created[0]
  return {
    status, json, db, p,
    lines: p ? Object.fromEntries(p.line_items.map((l) => [l.price_data.product_data.name.split(' · ')[0], [l.price_data.unit_amount, l.quantity]])) : null,
    ship: p ? p.shipping_options[0].shipping_rate_data.fixed_amount.amount : null,
  }
}

test('checkout enabled: 5 rings = £20.00 + £1.49 delivery', async () => {
  const r = await checkout([{ bc: 'RING1', qty: 5 }])
  assert.equal(r.status, 200)
  assert.deepEqual(r.lines, { RING1: [400, 5] })
  assert.equal(r.ship, 149)
})

test('checkout enabled: 4 rings -> 400 rings_min_5 with the missing count; the hold is released; no Stripe session', async () => {
  const r = await checkout([{ bc: 'RING1', qty: 4 }, { bc: 'CLIP1', qty: 2 }])
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'rings_min_5'); assert.equal(r.json.reason, 'rings_min_5')
  assert.equal(r.json.message, 'Rings are sold in fives or more: add 1 more ring')
  assert.equal(r.json.items[0].add, 1)
  assert.equal(r.p, undefined)
  assert.ok(r.db.calls.some((c) => c.url.includes('/rpc/fn_karmi_checkout_release')), 'reservation released')
  const one = await checkout([{ bc: 'RING1', qty: 1 }])
  assert.equal(one.status, 400); assert.match(one.json.message, /add 4 more rings$/)
})

test('checkout enabled: 9 rings + 10 B items -> B at the 10+ price, rings £4, free delivery (10 non-ring items)', async () => {
  const r = await checkout([{ bc: 'RING1', qty: 9 }, { bc: 'CLIP1', qty: 10 }])
  assert.equal(r.status, 200)
  assert.deepEqual(r.lines, { RING1: [400, 9], CLIP1: [240, 10] })
  assert.equal(r.ship, 0)
  assert.equal(r.p.shipping_options[0].shipping_rate_data.display_name, 'Free UK shipping')
})

test('checkout enabled: 10 rings + 1 B item -> B single price (no 10+ price), rings £4, free delivery (rings count, K-070)', async () => {
  const r = await checkout([{ bc: 'RING1', qty: 10 }, { bc: 'CLIP1', qty: 1 }])
  assert.equal(r.status, 200)
  assert.deepEqual(r.lines, { RING1: [400, 10], CLIP1: [800, 1] })
  assert.equal(r.ship, 0)
})

test('checkout: 0 rings unchanged (enabled vs live table); a ring line with R disabled is refused 503, never guessed', async () => {
  for (const q of [1, 9, 10, 12]) {
    const a = await checkout([{ bc: 'CLIP1', qty: q }, { bc: G1, qty: 1 }], ON)
    const b = await checkout([{ bc: 'CLIP1', qty: q }, { bc: G1, qty: 1 }], LADDERS)
    assert.equal(a.status, 200); assert.deepEqual(a.lines, b.lines); assert.equal(a.ship, b.ship)
    assert.deepEqual(a.p.line_items, b.p.line_items)
  }
  const off = await checkout([{ bc: 'RING1', qty: 5 }], LADDERS)
  assert.equal(off.status, 503); assert.equal(off.json.error, 'pricing_unavailable')
})
