// Owner decision (Mert, 25 Nov 2026): UK delivery £3.99; FREE when the basket total the customer actually pays is >= £30.00
// (after the 10+ cart-quantity price and any deal price); a 10+ basket under £30 PAYS delivery (no item-count free
// delivery). ONE rule: ladders.json `shipping`. The server (api/_pricing.js shippingFeeP, used by api/checkout.js on the
// SERVER-priced lines) charges it; the page (index.html SHIP / deliveryFor / m1Fee) only displays it. This file pins:
//   1. the rule in ladders.json; 2. the server fee at the boundary (£29.99 pays, £30.00 free) and for 10+ baskets;
//   3. page = server, penny-exact, over a grid of amounts x unit counts (live table and the static fallback);
//   4. no "From £5" delivery text in shipped HTML/JS; no import.meta in api/*.js (Vercel CommonJS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { LADDERS, publicLadders, priceUnits, shippingFeeP, freeShipping, cartSummary } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { pageFns } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const RAW = JSON.parse(read('../ladders.json'))
const HTML = read('../index.html')
const [G1] = Object.keys(GRADIENT)

test('rule lives in ladders.json: fee 399 p, free from 3000 p spend, item-count free delivery OFF', () => {
  assert.equal(RAW.shipping.below_threshold_fee_pence, 399)
  assert.equal(RAW.shipping.free_threshold_pence, 3000)
  assert.equal(RAW.shipping.free_at_qty.enabled, false)
  assert.deepEqual({ ...LADDERS.freeShip }, { fromP: 3000, units: null, feeP: 399, derivedFrom: null }, 'the loaded (charged) table')
  const v = publicLadders(LADDERS).shipping
  assert.deepEqual(v, { free_threshold_pence: 3000, below_threshold_fee_pence: 399, free_at_qty: { enabled: false }, derived_from: null }, '/api/stock view')
})

test('server fee: £29.99 pays £3.99, exactly £30.00 is free, whatever the unit count', () => {
  for (const units of [1, 5, 9, 10, 11, 25, 99]) {
    assert.equal(shippingFeeP(2999, units), 399, `2999 / ${units}`)
    assert.equal(shippingFeeP(3000, units), 0, `3000 / ${units}`)
    assert.equal(shippingFeeP(3001, units), 0, `3001 / ${units}`)
    assert.equal(shippingFeeP(1, units), 399)
    assert.equal(freeShipping(2999, units), false); assert.equal(freeShipping(3000, units), true)
  }
})

test('server fee is on the POST-discount basket: 10+ under £30 pays, 10+ at/over £30 free, 9 singles over £30 free', () => {
  const B = (n) => Array.from({ length: n }, () => ({ ladder: true }))           // Gradient Edit = group B (£8, 10+ £2.40)
  const A = (n) => Array.from({ length: n }, () => ({ ladder: false, unitP: 1, group: 'A' }))   // £5, 10+ £1.50
  const C = (n) => Array.from({ length: n }, () => ({ ladder: false, unitP: 1, group: 'C' }))   // £13, 10+ £3.90
  const fee = (u) => { const amt = priceUnits(u); return [amt, shippingFeeP(amt, u.length)] }
  assert.deepEqual(fee(B(1)), [800, 399])
  assert.deepEqual(fee(B(3)), [2400, 399])
  assert.deepEqual(fee(B(4)), [3200, 0])
  assert.deepEqual(fee(B(9)), [7200, 0])
  assert.deepEqual(fee(B(10)), [2400, 399], '10+ basket under £30 PAYS delivery')
  assert.deepEqual(fee(B(12)), [2880, 399])
  assert.deepEqual(fee(B(13)), [3120, 0])
  assert.deepEqual(fee(A(6)), [3000, 0], 'exactly £30.00')
  assert.deepEqual(fee(A(10)), [1500, 399])
  assert.deepEqual(fee(A(20)), [3000, 0], '20 x £1.50 = exactly £30.00 after the 10+ price')
  assert.deepEqual(fee([...A(19)]), [2850, 399])
  assert.deepEqual(fee(C(10)), [3900, 0])
  // cartSummary carries the same numbers the bag shows (shipping_pence) and the unlock delivery
  const s = cartSummary(B(9))
  assert.deepEqual([s.charged_pence, s.shipping_pence, s.unlock_total_pence, s.unlock_shipping_pence], [7200, 0, 2400, 399])
})

const groups = { SA: 'A', SC: 'C' }
const extra = [{ barcode: 'SA', type: 'Stretch Bracelet', color_en: 'a' }, { barcode: 'SC', type: 'Bangle', color_en: 'c' }]
test('page = server: SHIP fallback and the /api/stock table give the server fee for every amount 0..£60 x 1..15 units', () => {
  const view = publicLadders(LADDERS)
  const before = pageFns(HTML, { ladders: null, extra, groups })                // static fallback (before /api/stock answers)
  const after = pageFns(HTML, { ladders: view, extra, groups }); assert.equal(after.applyLadderShipping(view), true)
  for (const p of [before, after]) {
    assert.deepEqual({ ...p.SHIP }, { freeP: 3000, feeP: 399, freeQty: null })
    for (let amt = 0; amt <= 6000; amt++) for (let u = 1; u <= 15; u++) {
      const d = p.deliveryFor(amt, u), f = shippingFeeP(amt, u)
      if (d.feeP !== f || d.totalP !== amt + f) assert.fail(`amt ${amt} units ${u}: page ${d.feeP}, server ${f}`)
    }
  }
})

test('page = server on real bags (M1 summary): total, delivery, and the "Add £x for free delivery" nudge = engine', () => {
  const view = publicLadders(LADDERS)
  const p = pageFns(HTML, { ladders: view, extra, groups }); p.applyLadderShipping(view)
  const units = (lines) => lines.flatMap((c) => Array.from({ length: c.qty }, () => (c.bc in GRADIENT ? { ladder: true } : { ladder: false, unitP: 1, group: groups[c.bc] })))
  for (let g = 0; g <= 14; g++) for (let a = 0; a <= 8; a++) for (let c = 0; c <= 3; c++) {
    const lines = [g && { bc: G1, qty: g }, a && { bc: 'SA', qty: a }, c && { bc: 'SC', qty: c }].filter(Boolean)
    if (!lines.length) continue
    const s = p.m1Summary(lines), u = units(lines), amt = priceUnits(u), fee = shippingFeeP(amt, u.length)
    assert.equal(s.charged_pence, amt, `${g}/${a}/${c}`)
    assert.equal(s.shipping_pence, fee, `${g}/${a}/${c}`)
    const L = p.m1Lines(lines)
    if (fee === 0) assert.equal(L.delivery, undefined, `${g}/${a}/${c}: free, no nudge`)
    else if (!L.progress || !/free (UK )?delivery/.test(L.progress)) assert.equal(L.delivery, `Add £${((3000 - amt) / 100).toFixed(2)} for free delivery`, `${g}/${a}/${c}`)
  }
  assert.equal(p.m1Lines([{ bc: G1, qty: 10 }]).delivery, 'Add £6.00 for free delivery')
  assert.equal(p.shipSentence(), '£3.99 UK delivery, free on orders of £30 or more')
  assert.equal(p.cardShipText(), '+ £3.99 UK delivery, free on orders of £30 or more')
})

test('no "From £5" delivery text in shipped HTML / JS; the 10+ price text "from £1.50 each" stays', () => {
  const files = ['../index.html', '../shipping-returns.html', '../terms.html', '../privacy.html', '../contact.html', '../review.html',
    ...readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `../js/${f}`),
    ...readdirSync(new URL('../api/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `../api/${f}`)]
  const delivery5 = /(?:deliver|shipping|postage)[^.<>\n]{0,40}from £5|from £5[^.<>\n]{0,40}(?:deliver|shipping|postage)|From £5/i
  for (const f of files) {
    const src = read(f).split(/\r?\n/).filter((l) => !l.startsWith('const DATA=')).join('\n')
    const m = src.match(delivery5)
    assert.equal(m, null, `${f}: "${m && src.slice(Math.max(0, m.index - 60), m.index + 60)}"`)
    assert.doesNotMatch(src, /free with any \d+\+ items[^']*['"]?\s*<\/|£1\.49 UK delivery/, f)
  }
  // the price text stays (sticky / hero / cards: "from £1.50 each" at 10+ is generated from the table)
  assert.match(read('../js/storefront.js'), /'from ' \+ sfMoney\(b\.each\) \+ ' each when you buy '/)
})

test('no import.meta in api/*.js (Vercel compiles api/*.js to CommonJS; it once broke the whole checkout)', () => {
  for (const f of readdirSync(new URL('../api/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const code = read(`../api/${f}`).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    assert.doesNotMatch(code, /import\.meta/, f)
  }
})

test('checkout uses INLINE shipping_rate_data (no pre-created Stripe shipping_rate id to update in the dashboard)', () => {
  const src = read('../api/checkout.js')
  assert.match(src, /shipping_rate_data: \{ display_name: 'Free UK shipping'/)
  assert.match(src, /shipping_rate_data: \{ display_name: 'UK standard shipping', type: 'fixed_amount', fixed_amount: \{ amount: shippingFeeP\(sb\.amountP, sb\.units, table\)/)
  assert.doesNotMatch(src, /shipping_rate:\s*['"`]shr_/)
  assert.doesNotMatch(src, /shopify/i)
})
