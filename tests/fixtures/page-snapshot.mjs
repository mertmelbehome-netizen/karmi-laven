// Live-default page snapshot (M1 fast path, 23 Nov 2026): evaluates index.html's pricing + delivery (+ M1, when present)
// blocks with the LIVE default /api/stock `ladders` and records every number/text they produce. The sha256 of this
// record was taken on the page BEFORE the M1 page code (commit c3be709) and is pinned in tests/m1-page.test.mjs: the M1
// code may not change one byte of what the live default shows or charges.
import { createHash } from 'node:crypto'

export function blocks(html) {
  const get = (name) => { const m = html.match(new RegExp(`/\\*${name}-START\\*/([\\s\\S]*?)/\\*${name}-END\\*/`)); return m ? m[1] : '' }
  return { pricing: get('KL-PRICING'), delivery: get('KL-DELIVERY'), m1: get('KL-M1') }
}

export function pageData(html) {
  const i = html.indexOf('const DATA=') + 'const DATA='.length
  let d = 0, j = i
  for (; j < html.length; j++) { if (html[j] === '[') d++; else if (html[j] === ']' && --d === 0) break }
  return JSON.parse(html.slice(i, j + 1))
}

/** The page's functions evaluated as-is. window.klLadders = `ladders` (null = before /api/stock answered). */
export function pageFns(html, { ladders = null, extra = [], livePrices = {}, groups = {} } = {}) {
  const DATA = pageData(html)
  const BY = {}
  for (const d of [...DATA, ...extra]) BY[d.barcode] = d
  const PRICE = Number(html.match(/\],\s*PRICE=([\d.]+);/)[1])
  const LADDER_TYPES = JSON.parse(html.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const window = { klPrice: (bc) => (bc in livePrices ? livePrices[bc] : null), klGroup: (bc) => groups[bc] || null, klLadders: ladders }
  const b = blocks(html)
  const names = ['cartTotal', 'deliveryFor', 'rollingText', 'shipSentence', 'cardShipText', 'applyLadderShipping', 'gradTotalP', 'unitPrice', 'isLadder', 'bestPrice', 'SHIP']
  const m1Names = b.m1 ? ['m1On', 'm1T', 'm1Group', 'm1Summary', 'm1Lines', 'm1PriceText', 'm1PriceHtml', 'm1TierHint', 'm1Texts', 'm1CartTotalP', 'm1Deal'] : []
  return new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', `${b.pricing}\n${b.delivery}\n${b.m1}\n; return { ${[...names, ...m1Names].join(', ')} };`)(
    BY, LADDER_TYPES, PRICE, window)
}

/** Everything the live default produces, as one JSON string; its sha256 is the regression pin. */
export function liveRecord(html, liveView) {
  const DATA = pageData(html)
  const G = DATA.find((d) => ['Lux Bracelet', 'Lux Cobra Bracelet'].includes(d.type)).barcode
  const extra = [{ barcode: 'X599', type: 'Stretch Charm Bracelet', color_en: 'X' }, { barcode: 'X999', type: 'Necklace Lux Stone', color_en: 'Y' }]
  const livePrices = { X599: 5.99, X999: 9.99 }
  const out = {}
  for (const [phase, ladders] of [['before_stock', null], ['after_stock', liveView]]) {
    const p = pageFns(html, { ladders, extra, livePrices })
    if (ladders) out[`${phase}_apply`] = p.applyLadderShipping(ladders)
    const r = (out[phase] = {})
    r.ship = { ...p.SHIP }
    r.sentence = p.shipSentence()
    r.card = p.cardShipText()
    r.unit = [G, 'X599', 'X999', 'NOPE'].map((bc) => p.unitPrice(bc))
    r.grad = Array.from({ length: 100 }, (_, q) => p.gradTotalP(q))
    r.carts = []
    for (let g = 0; g <= 14; g++) for (let a = 0; a <= 3; a++) for (let c = 0; c <= 2; c++) {
      const lines = [g && { bc: G, qty: g }, a && { bc: 'X599', qty: a }, c && { bc: 'X999', qty: c }].filter(Boolean)
      const units = g + a + c
      const sub = p.cartTotal(lines)
      r.carts.push([g, a, c, sub, p.rollingText(Math.round(sub * 100), units)])
    }
    r.delivery = []
    for (let amt = 0; amt <= 2000; amt += 7) for (let u = 0; u <= 11; u++) { const d = p.deliveryFor(amt, u); r.delivery.push([d.feeP, d.totalP, d.free]) }
  }
  return JSON.stringify(out)
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')
