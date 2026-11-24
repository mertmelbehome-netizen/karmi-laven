// M1 fast path on the EXISTING page (23 Nov 2026; Komuta: live by Wed 25 / Thu 26 Nov, does not wait for PR-2).
//   1. LIVE DEFAULT UNCHANGED: what index.html shows/charges with today's ladders.json is byte-identical to the page before
//      the M1 code (sha256 of tests/fixtures/page-snapshot.mjs liveRecord, taken on c3be709).
//   2. M1 (mode cart_qty_groups) page = server: cart total, cartSummary, delivery, the "Add 1 more" cliff line, penny-exact.
//   3. S1 texts: "£8 each · £2.40 each when you buy any 10 or more items"; every "free with 10+" names the £1.49 fee; no %,
//      no strike-through, no "save".
//   4. Go-live guard: M1 runs only when ladders.json (or a preview table) is in mode cart_qty_groups; the page's
//      M1_FALLBACK must equal the served table once ladders.json is switched (docs/GO_LIVE_M1.md).
//   Mert 23 Nov (via Komuta): 3–9 units are NOT capped; 'single' is the only behaviour (no 'capped' option).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, loadLadders, publicLadders, priceUnits, cartSummary, progress, shippingFeeP } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import stockHandler from '../api/stock.js'
import { blocks, pageFns, liveRecord, sha256 } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const RAW_PCT = JSON.parse(read('../ladders-preview/M1_mert_list.json'))   // ui.percent_claim 70 (K-046)
// S1 (no percentage claim) keeps the two-price wording tests below; the 70% tests use M1P
const M1 = loadLadders({ ...RAW_PCT, ui: { ...RAW_PCT.ui, percent_claim: null } }).table
const M1V = publicLadders(M1)
const [G1, G2] = Object.keys(GRADIENT)
// page before the M1 code (c3be709) = 17b7e873…; re-pinned in the M1 cleanup PR (K&D N4): with the pools table served the
// prices, carts and fees are unchanged and only the two spend-threshold texts are reworded ("free from £12 (or 5 items)" ->
// "free on orders of £12+ (or 5+ items)"); before /api/stock answers the static SHIP fallback is now the served M1 table.
const LIVE_SHA = '5367af03c1277ae61ba181420c1507d8df3537e76d9792a4a927d61f9e091368' // re-pinned for K-047 'free with any 10+ items' (record = #46 pin with 'any' added, nothing else; checked)

// ---------- 1. live default unchanged ----------
// The pools-era page code (M1_FALLBACK forced to null, the frozen 23 Nov table) still produces exactly what the page
// did before M1 - also after the go-live, so a rollback (ladders.json back) restores the old behaviour byte for byte.
const LIVE_FIX = JSON.parse(read('./fixtures/ladders.live-2026-11-23.json'))
const HTML_POOLS = HTML.replace(/const M1_FALLBACK=.*?;   \/\/ GO-LIVE/, 'const M1_FALLBACK=null;   // GO-LIVE')
test('live default: page output byte-identical to the page before M1 (sha256 pin)', () => {
  assert.equal(sha256(liveRecord(HTML_POOLS, publicLadders(loadLadders(LIVE_FIX).table))), LIVE_SHA)
})
test('frozen 23 Nov table fixture = ladders.json while ladders.json is the pools table', () => {
  const raw = JSON.parse(read('../ladders.json'))
  if (raw.mode !== 'cart_qty_groups') assert.deepEqual(LIVE_FIX, raw)
  else assert.equal(LIVE_FIX.version, 'live-2026-11-23')
})

test('pools table: M1 code is dormant (m1On false before and after /api/stock answers)', () => {
  for (const ladders of [null, publicLadders(loadLadders(LIVE_FIX).table)]) {
    const p = pageFns(HTML_POOLS, { ladders })
    assert.equal(p.m1On(), false)
    assert.equal(p.m1Texts(), null)
  }
  if (LADDERS.mode !== 'cart_qty_groups') assert.match(HTML, /const M1_FALLBACK=null;/, 'fallback stays null while ladders.json is the pools table')
})

test('live default: requests unchanged unless the page URL carries ?ladder= (preview only)', () => {
  assert.match(HTML, /const lp=klLadderParam\(\); if\(lp\) body\.ladder=lp;/)
  assert.match(HTML, /if\(lp\) url\+=/)
  assert.match(HTML, /function klLadderParam\(\)\{[^\n]*\/\^\[A-Za-z0-9_-\]\{1,40\}\$\//)
})

// ---------- 2. M1 page = server ----------
const extra = [{ barcode: 'SA', type: 'Stretch Bracelet', color_en: 'a' }, { barcode: 'SC', type: 'Bangle', color_en: 'c' }, { barcode: 'NG', type: 'Hair Clips', color_en: 'n' }]
const groups = { SA: 'A', SC: 'C' } // NG: no group = not sold
const m1Page = () => {
  const p = pageFns(HTML, { ladders: M1V, extra, groups })
  assert.equal(p.applyLadderShipping(M1V), true)
  return p
}
const units = (lines) => lines.flatMap((c) => Array.from({ length: c.qty }, () => (c.bc in GRADIENT ? { ladder: true } : { ladder: false, unitP: 599, group: groups[c.bc] })))

test('M1: Gradient Edit 0..30 units: page cart total = server priceUnits; delivery = server', () => {
  const p = m1Page()
  for (let q = 0; q <= 30; q++) {
    const lines = q ? [{ bc: G1, qty: Math.ceil(q / 2) }, { bc: G2, qty: Math.floor(q / 2) }].filter((l) => l.qty) : []
    const server = q ? priceUnits(units(lines), M1) : 0
    assert.equal(Math.round(p.cartTotal(lines) * 100), server, `${q}`)
    assert.equal(p.m1CartTotalP(lines), server)
    if (q) assert.equal(p.deliveryFor(server, q).feeP, shippingFeeP(server, q, M1), `fee ${q}`)
  }
  assert.equal(Math.round(p.cartTotal([{ bc: G1, qty: 9 }]) * 100), 7200)
  assert.equal(Math.round(p.cartTotal([{ bc: G1, qty: 10 }]) * 100), 2400)
  assert.equal(p.rollingText(7200, 9), 'Bag £73.49 inc. £1.49 delivery')
  assert.equal(p.rollingText(2400, 10), 'Bag £24.00 · free UK delivery')
})

test('M1: mixed groups (A/B/C) page m1Summary = server cartSummary, every field', () => {
  const p = m1Page()
  for (let g = 0; g <= 6; g++) for (let a = 0; a <= 4; a++) for (let c = 0; c <= 3; c++) {
    const lines = [g && { bc: G1, qty: g }, a && { bc: 'SA', qty: a }, c && { bc: 'SC', qty: c }].filter(Boolean)
    const { ungrouped, ...page } = p.m1Summary(lines)
    assert.equal(ungrouped, 0)
    assert.deepEqual(page, cartSummary(units(lines), M1), `${g}/${a}/${c}`)
  }
  // a product without an online group is never priced on the page (unitPrice null = not sellable)
  assert.equal(p.unitPrice('NG'), null)
  assert.equal(p.unitPrice(G1), 8)
  assert.equal(p.unitPrice('SA'), 5)
  assert.equal(p.m1Summary([{ bc: 'NG', qty: 2 }]).ungrouped, 2)
})

test('M1 cart lines (Komuta rule): figure from THIS cart; "drops/becomes" only when lower; 10+ applied + promo off', () => {
  const p = m1Page()
  const L = (q) => p.m1Lines([{ bc: G1, qty: q }])
  assert.deepEqual(L(0), { progress: null, applied: null, promo: null })
  // Gradient-only (group B): 1–2 units, 10 at £2.40 = £24.00 is NOT below the bag (£9.49 / £17.49) -> unlock wording
  assert.equal(L(1).progress, 'Add 9 more to unlock 10+ prices (from £2.40 each) and free UK delivery')
  assert.equal(L(2).progress, 'Add 8 more to unlock 10+ prices (from £2.40 each) and free UK delivery')
  // 3–8: £24.00 is below the bag -> "your total becomes", with an example from the cart
  assert.equal(L(3).progress, 'Add 7 more (e.g. Bead bracelets): your total becomes £24.00 with free delivery')
  assert.equal(L(5).progress, 'Add 5 more (e.g. Bead bracelets): your total becomes £24.00 with free delivery')
  assert.equal(L(8).progress, 'Add 2 more (e.g. Bead bracelets): your total becomes £24.00 with free delivery')
  assert.deepEqual(L(9), { progress: 'Add 1 more: total drops to £24.00 with free delivery', applied: null, promo: null })
  assert.deepEqual(L(10), { progress: null, applied: '10+ price applied: £2.40 each', promo: 'Promo codes can’t be used with the 10+ price.' })
  assert.equal(L(14).applied, '10+ price applied: £2.40 each')
  // mixed 10: different 10+ prices -> no single "each" figure
  assert.equal(p.m1Lines([{ bc: G1, qty: 4 }, { bc: 'SA', qty: 3 }, { bc: 'SC', qty: 3 }]).applied, '10+ price applied: every item at its 10+ price')
  // Komuta cases, mixed carts 1–4 units (A = SA, B = Gradient, C = SC)
  const M = (lines) => p.m1Lines(lines).progress
  assert.equal(M([{ bc: 'SA', qty: 1 }]), 'Add 9 more to unlock 10+ prices (from £1.50 each) and free UK delivery')
  assert.equal(M([{ bc: 'SA', qty: 1 }, { bc: G1, qty: 1 }]), 'Add 8 more to unlock 10+ prices (from £1.50 each) and free UK delivery')
  assert.equal(M([{ bc: 'SA', qty: 1 }, { bc: G1, qty: 1 }, { bc: 'SC', qty: 1 }]), 'Add 7 more (e.g. Stretch Bracelets): your total becomes £18.30 with free delivery')
  assert.equal(M([{ bc: 'SA', qty: 2 }, { bc: G1, qty: 1 }, { bc: 'SC', qty: 1 }]), 'Add 6 more (e.g. Stretch Bracelets): your total becomes £18.30 with free delivery')
  assert.equal(M([{ bc: 'SC', qty: 3 }]), 'Add 7 more (e.g. Bangles): your total becomes £39.00 with free delivery')
  assert.equal(M([{ bc: 'SC', qty: 2 }]), 'Add 8 more to unlock 10+ prices (from £3.90 each) and free UK delivery')
  // a cart without group A never shows the generic £15.00
  for (let q = 1; q <= 9; q++) assert.doesNotMatch(M([{ bc: G1, qty: q }, { bc: 'SC', qty: 1 }]) || '', /£15\.00/)
  // page line = engine progress() line (the "(e.g. …)" example is page-only), every cart 1..9 of A/B/C mixes
  for (let g = 0; g <= 9; g++) for (let a = 0; a <= 4; a++) for (let c = 0; c <= 3; c++) {
    const n = g + a + c
    if (!n || n >= 10) continue
    const lines = [g && { bc: G1, qty: g }, a && { bc: 'SA', qty: a }, c && { bc: 'SC', qty: c }].filter(Boolean)
    assert.equal(M(lines).replace(/ \(e\.g\. [^)]*\)/, ''), progress(units(lines), M1).lines[0], `${g}/${a}/${c}`)
  }
})

test('M1 texts (S1): card/modal price, delivery, static swaps; no %, strike-through or "save"', () => {
  const p = m1Page()
  assert.equal(p.m1PriceText(G1), '£2.40 each when you buy any 10+ items · £8 each for 1–9 items')   // deal-first re-pin (owner 24 Nov 2026)
  assert.equal(p.m1PriceText('SA'), '£1.50 each when you buy any 10+ items · £5 each for 1–9 items')
  assert.equal(p.m1PriceText('NG'), '')
  assert.equal(p.shipSentence(), '£1.49 UK delivery · free with any 10+ items')
  assert.equal(p.cardShipText(), '+ £1.49 UK delivery · free with any 10+ items')
  assert.deepEqual({ ...p.SHIP }, { freeP: null, feeP: 149, freeQty: 10 })
  const T = p.m1Texts()
  assert.equal(T.hero, '<span class="m1d"><b class="m1big">£2.40</b> each <span class="m1c">when you buy any 10+ items</span></span><span class="m1sep"> · </span><span class="m1one">£8 each for 1–9 items</span>')   // deal-first re-pin (owner 24 Nov 2026)
  assert.equal(T.count(38), '38 shades · £2.40 each when you buy any 10+ items · £8 each for 1–9 items')
  assert.match(T.cta, /£2\.40 each when you buy any 10\+ items · £8 each for 1–9 items · <span data-kl="ship">£1\.49 UK delivery · free with any 10\+ items<\/span>/)
  assert.match(T.each, /data-kl="fee1">\+ £1\.49 UK delivery · free with any 10\+ items</)
  const all = [T.hero, T.cta, T.each, T.faqq, T.faqa, p.m1PriceText(G1), p.shipSentence(), p.cardShipText(), p.m1Lines([{ bc: G1, qty: 9 }]).progress].join(' | ')
  assert.doesNotMatch(all, /%|<s>|<del>|\bsave|saving|was £|instead of/i)
  // §5.21: every "free with 10+" names the fee
  for (const t of [T.cta, T.faqa, p.shipSentence(), p.cardShipText()]) if (/free with|free UK delivery/i.test(t)) assert.match(t, /£1\.49/, t)
  // the M1 block itself has no forbidden wording in its text literals
  assert.doesNotMatch(blocks(HTML).m1.replace(/\/\/.*$/gm, ''), /%'|save £|<s>/i)
})

test('M1 bundle builder: 1 / 5 / 10, Gradient totals £8 / £40 / £24', () => {
  const p = m1Page()
  assert.deepEqual([1, 5, 9, 10, 12].map((q) => p.gradTotalP(q)), [800, 4000, 7200, 2400, 2880])
  assert.match(HTML, /const M1_TIERS=\[\{n:1,label:''\},\{n:5,label:''\},\{n:10,label:'10\+ price'\}\]/)
})

// ---------- 4. go-live guard ----------
test('go-live guard: when ladders.json is in mode cart_qty_groups, M1_FALLBACK = the served table', () => {
  const m = HTML.match(/const M1_FALLBACK=(.*?);   \/\/ GO-LIVE/)
  assert.ok(m, 'M1_FALLBACK line present')
  if (LADDERS.mode === 'cart_qty_groups') assert.deepEqual(JSON.parse(m[1]), publicLadders(LADDERS))
  else assert.equal(m[1], 'null')
})

// ---------- /api/stock online_group: M1 only ----------
test('/api/stock: online_group served only with an M1 table; the live default body has no new field', async () => {
  const saved = { u: process.env.OPS_SUPABASE_URL, k: process.env.OPS_SUPABASE_SERVICE_KEY, p: process.env.KL_LADDER_PREVIEW }
  const real = globalThis.fetch
  process.env.OPS_SUPABASE_URL = 'https://db.test'; process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  globalThis.fetch = async (url) => {
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) return ok([{ barcode: G1, product_id: 'pg' }])
    if (url.includes('/stock_levels?')) return ok([{ product_id: 'pg', stockroom_count: 40 }])
    if (url.includes('/online_orders?')) return ok([])
    if (url.includes('fn_karmi_online_status')) return ok({ window: { open: true, message: null }, items: {
      S1: { sellable: 3, stock: 9, price_pence: 599, family: 'stretch_charm' }, // no column yet -> family_groups
      C1: { sellable: 2, stock: 5, price_pence: 799, online_group: 'C' },       // DB column (after go-live SQL)
      H1: { sellable: 2, stock: 5, price_pence: 799, family: 'hair' },          // no group -> not sellable in M1
    } })
    return ok([])
  }
  const run = async (query) => { let body; await stockHandler({ query }, { setHeader() {}, status() { return this }, json(b) { body = b; return this } }); return body }
  try {
    process.env.KL_LADDER_PREVIEW = '1'
    let b = await run({ bc: `${G1},S1,C1,H1`, ladder: 'M1_mert_list' })
    assert.deepEqual(b.online_group, { S1: 'B', C1: 'C' })
    assert.deepEqual(b.sellable, { S1: 3, C1: 2, H1: 0 })
    b = await run({ bc: `${G1},S1,C1,H1` })
    if (LADDERS.mode === 'cart_qty_groups') {
      assert.deepEqual(b.online_group, { S1: 'B', C1: 'C' }, 'after go-live the default table is M1')
    } else {
      assert.equal('online_group' in b, false, 'live default: no online_group key')
      assert.deepEqual(b.sellable, { S1: 3, C1: 2, H1: 2 }, 'live default sellable unchanged')
    }
  } finally {
    globalThis.fetch = real
    for (const [k, v] of [['OPS_SUPABASE_URL', saved.u], ['OPS_SUPABASE_SERVICE_KEY', saved.k], ['KL_LADDER_PREVIEW', saved.p]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})
