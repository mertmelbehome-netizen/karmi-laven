// Page = server pricing. The page's pricing block (index.html /*KL-PRICING-START*/../*KL-PRICING-END*/) is evaluated
// as-is and compared with api/_pricing.js, the code that actually charges.
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bestPriceP, ladderTotalP, priceUnits, freeShipping } from '../api/_pricing.js'
import { GRADIENT, LADDER_TYPES, isGradient } from '../api/_gradient.js'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const BLOCK = HTML.match(/\/\*KL-PRICING-START\*\/([\s\S]*?)\/\*KL-PRICING-END\*\//)[1]
const DATA = (() => { const i = HTML.indexOf('const DATA=') + 'const DATA='.length; let d = 0, j = i; for (; j < HTML.length; j++) { if (HTML[j] === '[') d++; else if (HTML[j] === ']' && --d === 0) break } return JSON.parse(HTML.slice(i, j + 1)) })()
const PAGE_PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])
const PAGE_LADDER_TYPES = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))

/** The page's own functions, with BY built from DATA plus extra (non-Gradient) rows and a live price map (£). */
function page(extra = [], livePrices = {}) {
  const BY = {}
  for (const d of [...DATA, ...extra]) BY[d.barcode] = d
  const window = { klPrice: (bc) => (bc in livePrices ? livePrices[bc] : null) }
  return new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', `${BLOCK}; return { bestPrice, cartTotal, isLadder, unitPrice };`)(
    BY, PAGE_LADDER_TYPES, PAGE_PRICE, window)
}

test('Gradient Edit ladder unchanged: 1 = £2.99, 2 = £5.50, 3 = £7.50, 5 = £12, 6 = £14.99', () => {
  assert.deepEqual([1, 2, 3, 5, 6].map(ladderTotalP), [299, 550, 750, 1200, 1499])
  assert.equal(PAGE_PRICE, 2.99)
})

test('page = server for every Gradient Edit quantity 1..99 (ladder total and the cart total)', () => {
  const p = page()
  const bc = Object.keys(GRADIENT)[0]
  for (let q = 1; q <= 99; q++) {
    assert.equal(Math.round(p.bestPrice(q) * 100), bestPriceP(q), `bestPrice ${q}`)
    const units = Array.from({ length: q }, () => ({ ladder: true }))
    assert.equal(Math.round(p.cartTotal([{ bc, qty: q }]) * 100), priceUnits(units), `cart ${q}`)
    assert.equal(units.reduce((a, u) => a + u.price, 0), ladderTotalP(q), 'line items sum exactly to the total')
  }
})

test('server Gradient Edit list = page DATA rows of the ladder types (no drift)', () => {
  assert.deepEqual(PAGE_LADDER_TYPES, LADDER_TYPES)
  const pageLadder = Object.fromEntries(DATA.filter((d) => LADDER_TYPES.includes(d.type)).map((d) => [d.barcode, d.color_en]))
  assert.deepEqual(pageLadder, { ...GRADIENT })
  assert.ok(DATA.every((d) => !('price' in d)), 'the dead price:1.5 field is gone')
})

test('a new family uses its WAT single price, no ladder: 3 Gradient + 1 Stretch Charm £5.99 = £13.49', () => {
  const units = [{ ladder: true }, { ladder: true }, { ladder: true }, { ladder: false, unitP: 599 }]
  assert.equal(priceUnits(units), 1349)
  assert.deepEqual(units.map((u) => u.price), [250, 250, 250, 599])
  // 5 Stretch Charm alone: 5 × £5.99, never the £12 ladder
  assert.equal(priceUnits(Array.from({ length: 5 }, () => ({ ladder: false, unitP: 599 }))), 2995)
  const p = page([{ barcode: 'SC1', type: 'Stretch Charm Bracelet', color_en: 'Rose' }], { SC1: 5.99 })
  assert.equal(p.isLadder('SC1'), false)
  assert.equal(p.unitPrice('SC1'), 5.99)
  assert.equal(Math.round(p.cartTotal([{ bc: Object.keys(GRADIENT)[0], qty: 3 }, { bc: 'SC1', qty: 1 }]) * 100), 1349)
  assert.equal(Math.round(p.cartTotal([{ bc: 'SC1', qty: 5 }]) * 100), 2995)
})

test('page = server on mixed carts (Gradient 0..12 × other prices × qty)', () => {
  const extra = [{ barcode: 'A', type: 'Hair Claws', color_en: 'x' }, { barcode: 'B', type: 'Necklace Lux Stone', color_en: 'y' }]
  const p = page(extra, { A: 7.99, B: 9.99 })
  const g = Object.keys(GRADIENT)[1]
  for (let lq = 0; lq <= 12; lq++) for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) {
    if (!lq && !a && !b) continue
    const units = [...Array(lq).fill(0).map(() => ({ ladder: true })), ...Array(a).fill(0).map(() => ({ ladder: false, unitP: 799 })),
      ...Array(b).fill(0).map(() => ({ ladder: false, unitP: 999 }))]
    const lines = [lq && { bc: g, qty: lq }, a && { bc: 'A', qty: a }, b && { bc: 'B', qty: b }].filter(Boolean)
    assert.equal(Math.round(p.cartTotal(lines) * 100), priceUnits(units), `${lq}/${a}/${b}`)
  }
})

test('a non-Gradient unit without a server price can never be charged; unknown page price = not sellable', () => {
  assert.throws(() => priceUnits([{ ladder: false }]), /unpriced/)
  assert.throws(() => priceUnits([{ ladder: false, unitP: 0 }]), /unpriced/)
  const p = page([{ barcode: 'Z', type: 'Stretch Charm Bracelet', color_en: 'z' }], {})
  assert.equal(p.unitPrice('Z'), null)
  assert.equal(isGradient('Z'), false)
})

test('free shipping unchanged: >= £12 or 5+ units', () => {
  assert.equal(freeShipping(1199, 4), false)
  assert.equal(freeShipping(1200, 1), true)
  assert.equal(freeShipping(599, 5), true)
})
