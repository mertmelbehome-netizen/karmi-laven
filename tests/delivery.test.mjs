// Delivery fee display (CMA209 §5.14, §5.17 route 2, §5.18, §5.21; CMA open letter 2 Nov 2026). DISPLAY ONLY:
//   1. every "free … over/from £12" text on the site also states the £1.49 fee below the threshold (§5.21);
//   2. the static texts (meta, footer, fallbacks) carry today's ladders.json numbers — this fails when ladders.json's
//      shipping block changes and the static HTML is not updated with it;
//   3. the page's rolling bag total (index.html /*KL-DELIVERY-START*/../*KL-DELIVERY-END*/) includes the FULL fee until
//      the bag is free (§5.14) and equals what the server charges (api/_pricing.js shippingFeeP), penny-exact;
//   4. the "6 for" price shown = the ladder total for 6 (£14.99 today), never the old "£15";
//   5. the numbers follow /api/stock `ladders` at runtime (a different table changes the texts, not the code).
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadLadders, publicLadders, priceUnits, shippingFeeP, ladderTotalP, LADDERS } from '../api/_pricing.js'
import { GRADIENT, LADDER_TYPES } from '../api/_gradient.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SHIP_PAGE = read('../shipping-returns.html')
const RAW_TABLE = JSON.parse(read('../ladders.json'))
// M1 go-live (docs/GO_LIVE_M1.md): ladders.json in mode cart_qty_groups -> the pools-era static texts are replaced and
// checked by the M1 tests at the end; the page's pools fallback code keeps being checked against the frozen 23 Nov table.
const M1MODE = RAW_TABLE.mode === 'cart_qty_groups'
const TABLE = M1MODE ? JSON.parse(read('./fixtures/ladders.live-2026-11-23.json')) : RAW_TABLE
const SKIP_M1 = M1MODE && 'ladders.json is M1: pools-era static texts replaced (see the M1 tests below)'
const FEE = TABLE.shipping.below_threshold_fee_pence
const FREE = TABLE.shipping.free_threshold_pence
const QTY = TABLE.shipping.free_at_qty.enabled ? TABLE.shipping.free_at_qty.qty : null
const gbp = (p) => `£${(p / 100).toFixed(2)}`
const gbpShort = (p) => (p % 100 === 0 ? `£${p / 100}` : gbp(p))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The page without the 4 MB DATA line (images) for text scans.
const TEXT = HTML.split(/\r?\n/).filter((l) => !l.startsWith('const DATA=')).join('\n')
const PRICING = HTML.match(/\/\*KL-PRICING-START\*\/([\s\S]*?)\/\*KL-PRICING-END\*\//)[1]
const DELIVERY = HTML.match(/\/\*KL-DELIVERY-START\*\/([\s\S]*?)\/\*KL-DELIVERY-END\*\//)[1]
const DATA = (() => { const i = HTML.indexOf('const DATA=') + 'const DATA='.length; let d = 0, j = i; for (; j < HTML.length; j++) { if (HTML[j] === '[') d++; else if (HTML[j] === ']' && --d === 0) break } return JSON.parse(HTML.slice(i, j + 1)) })()
const PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])

/** The page's own pricing + delivery functions (fresh SHIP each call), with optional extra rows / live prices / ladders. */
function page({ extra = [], livePrices = {}, ladders = null } = {}) {
  const BY = {}
  for (const d of [...DATA, ...extra]) BY[d.barcode] = d
  const window = { klPrice: (bc) => (bc in livePrices ? livePrices[bc] : null), klLadders: ladders }
  return new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', `${PRICING}\n${DELIVERY}\n; return { cartTotal, deliveryFor, rollingText, shipSentence, cardShipText, applyLadderShipping, gradTotalP, SHIP };`)(
    BY, LADDER_TYPES, PRICE, window)
}
/** page() after /api/stock answered with the frozen pools table (its shipping block applied, as on the live page). */
function poolsPage(opts = {}) { const L = publicLadders(LADDERS); const p = page({ ...opts, ladders: L }); assert.equal(p.applyLadderShipping(L), true); return p }
const G = Object.keys(GRADIENT)[0]
const bag = (p, lines) => { const units = lines.reduce((a, c) => a + c.qty, 0); return p.rollingText(Math.round(p.cartTotal(lines) * 100), units) }

// ---------- 1. §5.21: no free-delivery claim without the fee ----------
test('§5.21: every "free … over/from £12" text on index.html and shipping-returns.html also states the £1.49 fee', { skip: SKIP_M1 }, () => {
  const claim = new RegExp(`free[^.<>]{0,60}?(?:over|from|of)\\s*${esc(gbpShort(FREE))}(?![\\d.])`, 'gi')
  let n = 0
  for (const [name, src] of [['index.html', TEXT], ['shipping-returns.html', SHIP_PAGE]]) {
    for (const m of src.matchAll(claim)) {
      n++
      const around = src.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160)
      assert.ok(around.includes(gbp(FEE)), `${name}: "${m[0]}" has no ${gbp(FEE)} fee next to it: …${around}…`)
    }
  }
  assert.ok(n >= 8, `expected the free-delivery claims to be found (got ${n})`)
  assert.ok(!/free uk shipping over/i.test(TEXT), 'the old fee-less "Free UK shipping over £12" is gone')
})

test('§5.21: each meta / OG / Twitter description that mentions free delivery states the fee and the threshold', { skip: SKIP_M1 }, () => {
  const metas = [...TEXT.matchAll(/<meta (?:name|property)="(description|og:description|twitter:description)" content="([^"]*)"/g)]
  assert.equal(metas.length, 3)
  for (const [, kind, content] of metas) {
    if (/free/i.test(content)) assert.ok(content.includes(`${gbp(FEE)} UK delivery, free from ${gbpShort(FREE)}`), `${kind}: ${content}`)
  }
})

// ---------- 2. static texts = ladders.json ----------
test('static delivery texts carry ladders.json numbers (fails if ladders.json shipping changes without the HTML)', { skip: SKIP_M1 }, () => {
  const sentences = [...TEXT.matchAll(/£(\d+\.\d\d) UK delivery, free from £(\d+(?:\.\d\d)?)(?: \(or (\d+) items\))?/g)]
  const cards = [...TEXT.matchAll(/\+ £(\d+\.\d\d) UK delivery · free from £(\d+(?:\.\d\d)?)(?: or (\d+) items)?/g)]
  assert.ok(sentences.length >= 9, `sentence texts found: ${sentences.length}`)
  assert.ok(cards.length >= 1, 'hero fallback card text found')
  for (const m of [...sentences, ...cards]) {
    assert.equal(Math.round(Number(m[1]) * 100), FEE, `fee in "${m[0]}"`)
    assert.equal(Math.round(Number(m[2]) * 100), FREE, `threshold in "${m[0]}"`)
    assert.equal(m[3] === undefined ? null : Number(m[3]), QTY, `free-at-qty in "${m[0]}"`)
  }
  // shipping-returns.html (static page, no JS)
  assert.ok(SHIP_PAGE.includes(`UK standard delivery — ${gbp(FEE)}.`) && SHIP_PAGE.includes(`Free on orders of ${gbpShort(FREE)} or more`))
  if (QTY) assert.ok(SHIP_PAGE.includes(`or of ${QTY} or more items`))
  // page fallback constant
  const p = page()
  assert.deepEqual({ ...p.SHIP }, { freeP: FREE, feeP: FEE, freeQty: QTY })
  assert.equal(p.shipSentence(), `${gbp(FEE)} UK delivery, free from ${gbpShort(FREE)}${QTY ? ` (or ${QTY} items)` : ''}`)
})

// ---------- 3. rolling total (§5.14 / §5.18) ----------
test('rolling total from the first item: 0 / 1 / 4 / 5 / 6 Gradient Edit bracelets', () => {
  const p = poolsPage()
  assert.equal(bag(p, []), '')
  assert.equal(bag(p, [{ bc: G, qty: 1 }]), 'Bag £4.48 inc. £1.49 delivery')
  assert.equal(bag(p, [{ bc: G, qty: 4 }]), 'Bag £11.98 inc. £1.49 delivery') // 4 = £10.49 (3 for £7.50 + £2.99)
  assert.equal(bag(p, [{ bc: G, qty: 5 }]), 'Bag £12.00 · free UK delivery')
  assert.equal(bag(p, [{ bc: G, qty: 6 }]), 'Bag £14.99 · free UK delivery')
})

test('§5.14: a £11.96 basket carries the FULL £1.49; £12.00 is free (non-Gradient prices, under 5 items)', () => {
  const extra = [{ barcode: 'X299', type: 'Other', color_en: 'X' }, { barcode: 'X600', type: 'Other', color_en: 'Y' }, { barcode: 'X1199', type: 'Other', color_en: 'Z' }]
  const p = poolsPage({ extra, livePrices: { X299: 2.99, X600: 6.0, X1199: 11.99 } })
  assert.equal(bag(p, [{ bc: 'X299', qty: 4 }]), 'Bag £13.45 inc. £1.49 delivery') // £11.96 + £1.49
  assert.equal(bag(p, [{ bc: 'X600', qty: 2 }]), 'Bag £12.00 · free UK delivery')
  assert.equal(bag(p, [{ bc: 'X1199', qty: 1 }]), 'Bag £13.48 inc. £1.49 delivery') // 1p under: full fee, never partial
  assert.deepEqual(p.deliveryFor(1199, 1), { feeP: 149, totalP: 1348, free: false })
  assert.deepEqual(p.deliveryFor(1200, 1), { feeP: 0, totalP: 1200, free: true })
  assert.deepEqual(p.deliveryFor(0, 0), { feeP: 0, totalP: 0, free: false })
})

test('rolling total = what the server charges (subtotal + shippingFeeP), penny-exact, 0..£30 × 1..8 units', () => {
  const p = poolsPage()
  for (let amt = 0; amt <= 3000; amt++) for (let u = 1; u <= 8; u++) {
    const d = p.deliveryFor(amt, u)
    if (d.feeP !== shippingFeeP(amt, u) || d.totalP !== amt + shippingFeeP(amt, u)) assert.fail(`amt ${amt} units ${u}: page ${d.feeP}, server ${shippingFeeP(amt, u)}`)
  }
  // and on real carts: page bag total = server units total + server fee
  for (const q of [1, 2, 3, 4, 5, 6, 7, 12]) {
    const units = Array.from({ length: q }, () => ({ ladder: true }))
    const sub = priceUnits(units)
    const d = p.deliveryFor(Math.round(p.cartTotal([{ bc: G, qty: q }]) * 100), q)
    assert.equal(d.totalP, sub + shippingFeeP(sub, q), `${q} bracelets`)
  }
})

// ---------- 4. "6 for" = the table ----------
test('"6 for" price shown = the ladder total for 6 (£14.99), never "£15"', { skip: SKIP_M1 }, () => {
  assert.equal(ladderTotalP(6), 1499)
  const qs = [...TEXT.matchAll(/data-kl-q="(\d+)">£(\d+\.\d\d)</g)]
  assert.ok(qs.length >= 5)
  for (const [, q, shown] of qs) assert.equal(Math.round(Number(shown) * 100), ladderTotalP(Number(q)), `${q} for £${shown}`)
  assert.ok(!/6 for £15\b/.test(TEXT), 'no "6 for £15" left')
  assert.ok(!/price:\s*15(\.00)?\b/.test(TEXT), 'TIERS no longer hard-codes 15.00')
  assert.equal(page().gradTotalP(6), 1499)
})

// ---------- 5. numbers follow /api/stock ladders at runtime ----------
test('runtime: /api/stock ladders change the fee, threshold, free-at-qty and ladder totals the page shows', () => {
  const fx = (k) => { const r = loadLadders(JSON.parse(read(`./fixtures/ladders.${k}.json`))); assert.ok(r.ok, r.error); return publicLadders(r.table) }
  // live table through /api/stock = today's numbers
  const live = page({ ladders: publicLadders(LADDERS) })
  assert.equal(live.applyLadderShipping(publicLadders(LADDERS)), true)
  assert.equal(live.shipSentence(), '£1.49 UK delivery, free on orders of £12+ (or 5+ items)')
  assert.equal(live.cardShipText(), '+ £1.49 UK delivery · free on orders of £12+ or 5+ items')
  assert.equal(live.gradTotalP(6), 1499)
  // a different table (fixture shipping_30: free from £30, £6.49 below, no qty rule)
  const t30 = fx('shipping_30')
  const p = page({ ladders: t30 })
  assert.equal(p.applyLadderShipping(t30), true)
  assert.equal(p.shipSentence(), '£6.49 UK delivery, free on orders of £30+')
  assert.equal(p.rollingText(1200, 5), 'Bag £18.49 inc. £6.49 delivery')
  assert.equal(p.rollingText(3000, 1), 'Bag £30.00 · free UK delivery')
  assert.equal(p.gradTotalP(6), t30.pools.gradient.totals[6])
  // a broken shipping block is ignored: the fallback stays
  const q = page()
  assert.equal(q.applyLadderShipping({ shipping: { free_threshold_pence: 'x' } }), false)
  assert.equal(q.applyLadderShipping(null), false)
  assert.equal(q.shipSentence(), '£1.49 UK delivery · free with any 10+ items', 'fallback = M1 ladders.json shipping (K-047 wording)')
})


test('structured data (JSON-LD offer) carries the delivery fee from ladders.json (§5.21: a search-result price is an advert)', () => {
  const blocks = [...TEXT.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
  const offers = blocks.map((b) => b.offers).filter(Boolean)
  assert.ok(offers.length >= 1, 'an offer exists')
  for (const o of offers) {
    assert.equal(o.shippingDetails?.shippingRate?.value, (FEE / 100).toFixed(2), 'shippingRate = ladders.json fee')
    assert.equal(o.shippingDetails?.shippingRate?.currency, 'GBP')
    assert.equal(o.shippingDetails?.shippingDestination?.addressCountry, 'GB')
  }
})

test('the story strip "£2.99 each" carries the delivery fee next to it', { skip: SKIP_M1 }, () => {
  assert.match(TEXT, /<b>£2\.99<\/b> each <span class="dl" data-kl="fee1">\+ £1\.49 UK delivery<\/span>/)
})

// ---------- M1 (ladders.json in mode cart_qty_groups): static texts follow the quantity threshold ----------
// K&D / Komuta 23 Nov: with M1 there is no spend threshold, so NO "free from/over £x" or "(or 5 items)" text may remain
// in the shipped HTML (body text, meta / OG / Twitter, JSON-LD) or on shipping-returns.html / terms.html; every free
// claim is "£1.49 UK delivery · free with any 10+ items" (fee in the same text, CMA209 §5.21; K-047 "any 10 items").
const M1_SHIP = M1MODE ? `${gbp(RAW_TABLE.shipping.below_threshold_fee_pence)} UK delivery · free with any ${RAW_TABLE.shipping.free_at_qty.qty}+ items` : null
const visibleHtml = (h) => h.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
test('M1: no spend-threshold delivery text left (index.html incl. meta + JSON-LD, shipping-returns.html, terms.html)', { skip: !M1MODE && 'ladders.json is the pools table' }, () => {
  const bad = /free (?:uk )?(?:delivery |shipping )?(?:from|over|on orders of) £\d|\(or \d+ items\)|or \d+ items|or of \d+ or more items|£12/i
  for (const [name, src] of [['index.html', visibleHtml(TEXT)], ['shipping-returns.html', SHIP_PAGE], ['terms.html', read('../terms.html')]]) {
    const m = src.match(bad)
    assert.equal(m, null, `${name}: "${m && src.slice(Math.max(0, m.index - 60), m.index + 60)}"`)
  }
})
test('M1: every static free-delivery claim is the quantity sentence with the fee; meta descriptions too', { skip: !M1MODE && 'ladders.json is the pools table' }, () => {
  const html = visibleHtml(TEXT)
  const claims = [...html.matchAll(/[^<>]*free with any \d+\+ items[^<>]*/g)].map((m) => m[0])
  assert.doesNotMatch(html, /free with \d+\+ items|when you buy \d+\+? /, 'K-047: every claim says "any 10+ items"')
  assert.ok(claims.length >= 8, `claims found: ${claims.length}`)
  for (const c of claims) assert.ok(c.includes(gbp(RAW_TABLE.shipping.below_threshold_fee_pence)), `fee missing: ${c}`)
  const metas = [...TEXT.matchAll(/<meta (?:name|property)="(description|og:description|twitter:description)" content="([^"]*)"/g)]
  assert.equal(metas.length, 3)
  for (const [, kind, content] of metas) assert.ok(content.includes(M1_SHIP), `${kind}: ${content}`)
  assert.ok(SHIP_PAGE.includes(`UK standard delivery — ${gbp(RAW_TABLE.shipping.below_threshold_fee_pence)}.`))
  assert.ok(SHIP_PAGE.includes(`Free with any ${RAW_TABLE.shipping.free_at_qty.qty}+ items in your order`))
})
test('M1: JSON-LD offer price = the Gradient group single price; delivery fee = the table', { skip: !M1MODE && 'ladders.json is the pools table' }, () => {
  const gr = RAW_TABLE.groups[RAW_TABLE.gradient_group]
  const offers = [...TEXT.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).map((b) => b.offers).filter(Boolean)
  assert.ok(offers.length >= 1)
  for (const o of offers) {
    for (const k of ['lowPrice', 'highPrice', 'price']) if (k in o) assert.equal(o[k], (gr.single / 100).toFixed(2), k)
    assert.equal(o.shippingDetails?.shippingRate?.value, (RAW_TABLE.shipping.below_threshold_fee_pence / 100).toFixed(2))
    if (o.shippingDetails?.description) assert.equal(o.shippingDetails.description, M1_SHIP)
  }
  assert.doesNotMatch(visibleHtml(TEXT), /£2\.99/, 'no £2.99 left in the shipped HTML')
})
