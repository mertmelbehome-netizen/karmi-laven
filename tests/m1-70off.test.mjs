// K-046 (Mert, 23 Nov 2026): "70% off" at 10+ is shown on the card and in the bag, ALWAYS next to the single price on
// the same screen; no 'was' price, no strike-through, no "save £x". K&D implementation list:
// agents/quality-audit/outputs/2026-11-23_karmi_70off_owner_decision_checklist.md (items 1-7, 9).
// The % is computed from the table (p10 x 10 == p1 x 3, integer pence) and must equal ui.percent_claim; else no %.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, loadLadders, publicLadders, priceUnits, cartSummary, progress, shippingFeeP, pctOff } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { pageFns } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const RAW = JSON.parse(read('../ladders-preview/M1_mert_list.json'))
const load = (raw) => { const r = loadLadders(raw); assert.ok(r.ok, r.error); return r.table }
const M1P = load(RAW)
const NOPCT = load({ ...RAW, ui: { ...RAW.ui, percent_claim: null } })
const [G1, G2] = Object.keys(GRADIENT)
const extra = [{ barcode: 'SA', type: 'Stretch Bracelet', color_en: 'a' }, { barcode: 'SC', type: 'Bangle', color_en: 'c' }]
const groups = { SA: 'A', SC: 'C' }
const page = (table) => { const v = publicLadders(table); const p = pageFns(HTML, { ladders: v, extra, groups }); assert.equal(p.applyLadderShipping(v), true); return p }
const units = (lines) => lines.flatMap((c) => Array.from({ length: c.qty }, () => (c.bc in GRADIENT ? { ladder: true } : { ladder: false, unitP: 599, group: groups[c.bc] })))
const FORBIDDEN = /<s>|<del>|<strike>|line-through|\bsave\b|saving|was £|RRP/i

test('ladders.json (go-live) and the M1 fixture both claim exactly 70; the loader only takes a whole number 1..99 or null', () => {
  assert.equal(LADDERS.mode, 'cart_qty_groups')
  assert.equal(publicLadders(LADDERS).ui.percent_claim, 70)
  assert.equal(publicLadders(M1P).ui.percent_claim, 70)
  for (const bad of [70.5, 0, 100, '70', true]) assert.match(loadLadders({ ...RAW, ui: { ...RAW.ui, percent_claim: bad } }).error, /percent_claim/, String(bad))
  assert.equal(publicLadders(NOPCT).ui.percent_claim, null)
})

test('#1 the % comes from the data: A 500/150, B 800/240, C 1300/390 = 70; any other price = no %', () => {
  for (const k of ['A', 'B', 'C']) {
    const g = M1P.groups[k]
    assert.equal(g.tier_each * 10, g.single * 3, k)
    assert.equal(pctOff(g, M1P), 70, k)
    assert.equal(pctOff(g, NOPCT), null, k)
  }
  // change one ladder to £2.50: that group shows no % anywhere (server + page), the others still do
  const raw = structuredClone(RAW); raw.groups.B.tier_each = 250
  const T = load(raw)
  assert.equal(pctOff(T.groups.B, T), null)
  assert.equal(pctOff(T.groups.A, T), 70)
  const p = page(T)
  assert.equal(p.m1PriceText(G1), '£8 each · £2.50 each when you buy any 10 or more items')
  assert.equal(p.m1PriceText('SA'), '£5 each · 70% off when you buy any 10+ items (£1.50 each)')
  for (let q = 1; q <= 14; q++) {
    const L = p.m1Lines([{ bc: G1, qty: q }])
    assert.doesNotMatch([L.progress, L.applied].join(' '), /%/, `B@£2.50 q=${q}`)
    assert.doesNotMatch(progress(units([{ bc: G1, qty: q }]), T).lines.join(' '), /%/)
  }
  // a mixed bag A(70) + B(not 70): no "% off every item"
  const mix = [{ bc: G1, qty: 2 }, { bc: 'SA', qty: 2 }]
  assert.doesNotMatch(p.m1Lines(mix).progress, /%/)
  assert.doesNotMatch(progress(units(mix), T).lines[0], /%/)
  assert.doesNotMatch(p.m1Lines([{ bc: G1, qty: 5 }, { bc: 'SA', qty: 5 }]).applied, /%/)
  // a claim of 60 with 70% prices: nothing is shown (the page never states a figure the owner did not approve)
  const T60 = load({ ...RAW, ui: { ...RAW.ui, percent_claim: 60 } })
  assert.equal(pctOff(T60.groups.B, T60), null)
  assert.doesNotMatch(page(T60).m1PriceText(G1), /%/)
})

test('#2 card: "£8 each · 70% off when you buy any 10+ items (£2.40 each)" - single price first, condition + 10+ price on the same line', () => {
  const p = page(M1P)
  assert.equal(p.m1PriceText(G1), '£8 each · 70% off when you buy any 10+ items (£2.40 each)')
  assert.equal(p.m1PriceText('SA'), '£5 each · 70% off when you buy any 10+ items (£1.50 each)')
  assert.equal(p.m1PriceText('SC'), '£13 each · 70% off when you buy any 10+ items (£3.90 each)')
  assert.match(p.m1PriceHtml(G1), /<span class="m1p">£8<\/span> each<\/span><span class="m1t"> · 70% off when you buy any 10\+ items \(£2\.40 each\)<\/span>/)
  const T = p.m1Texts()
  assert.equal(T.count(38), '38 shades · £8 each · 70% off when you buy any 10+ items (£2.40 each)')
  assert.equal(T.meta, '£8 each · 70% off when you buy any 10+ items (£2.40 each)')
  assert.match(T.each, /<b>£8<\/b> each · 70% off when you buy any 10\+ items \(£2\.40 each\) <span class="dl" data-kl="fee1">\+ £1\.49 UK delivery<\/span>/)
  assert.equal(T.faqq, 'How does 70% off when you buy any 10+ items work?')
  assert.match(T.faqa, /Every bracelet is <b>£8 each<\/b>.*you get <b>70% off every item<\/b>: <b>£2\.40 each<\/b>.*Under 10 items, UK delivery is £1\.49/)
  assert.equal(p.m1TierHint(3), '£8 each · 70% off when you buy any 10+ items (£2.40 each) · + £1.49 UK delivery · free with any 10+ items')
  assert.equal(p.m1TierHint(10), '£2.40 each (70% off) · free UK delivery included')
})

test('#3 bag at 10+: "Instant 70% off applied: £2.40 each instead of £8", one figure pair per group, current single price', () => {
  const p = page(M1P)
  assert.deepEqual(p.m1Lines([{ bc: G1, qty: 10 }]), { progress: null, applied: 'Instant 70% off applied: £2.40 each instead of £8', promo: 'Promo codes can’t be used with the 10+ price.' })
  assert.equal(p.m1Lines([{ bc: G1, qty: 6 }, { bc: G2, qty: 8 }]).applied, 'Instant 70% off applied: £2.40 each instead of £8')
  assert.equal(p.m1Lines([{ bc: G1, qty: 4 }, { bc: 'SA', qty: 3 }, { bc: 'SC', qty: 3 }]).applied,
    'Instant 70% off applied: £1.50 each instead of £5 · £2.40 each instead of £8 · £3.90 each instead of £13')
  // "instead of £x" = the single price of the same group in the served table (not a historic price)
  const raw = structuredClone(RAW); raw.groups.B = { ...raw.groups.B, single: 1000, tier_each: 300 }
  assert.equal(page(load(raw)).m1Lines([{ bc: G1, qty: 10 }]).applied, 'Instant 70% off applied: £3.00 each instead of £10')
})

test('#4 bag 1–9: "Add N more for 70% off every item", N = 10 − all units; page line = engine line', () => {
  const p = page(M1P)
  const M = (lines) => p.m1Lines(lines).progress
  assert.equal(M([{ bc: G1, qty: 1 }]), 'Add 9 more for 70% off every item (from £2.40 each) and free UK delivery')
  assert.equal(M([{ bc: G1, qty: 3 }]), 'Add 7 more (e.g. Bead bracelets) for 70% off every item: your total becomes £24.00 with free delivery')
  assert.equal(M([{ bc: G1, qty: 9 }]), 'Add 1 more for 70% off every item: total drops to £24.00 with free delivery')
  assert.equal(M([{ bc: 'SA', qty: 2 }, { bc: G1, qty: 1 }, { bc: 'SC', qty: 1 }]), 'Add 6 more (e.g. Stretch Bracelets) for 70% off every item: your total becomes £18.30 with free delivery')
  for (let g = 0; g <= 9; g++) for (let a = 0; a <= 4; a++) for (let c = 0; c <= 3; c++) {
    const n = g + a + c
    if (!n || n >= 10) continue
    const lines = [g && { bc: G1, qty: g }, a && { bc: 'SA', qty: a }, c && { bc: 'SC', qty: c }].filter(Boolean)
    const line = M(lines)
    assert.match(line, new RegExp(`^Add ${10 - n} more`), `${g}/${a}/${c}`)
    assert.match(line, /for 70% off every item/)
    assert.equal(line.replace(/ \(e\.g\. [^)]*\)/, ''), progress(units(lines), M1P).lines[0], `${g}/${a}/${c}`)
  }
})

test('#5 no was / RRP / strike-through / "save" in any M1 text, with or without the claim', () => {
  for (const T of [M1P, NOPCT]) {
    const p = page(T), X = p.m1Texts()
    const bags = [1, 3, 9, 10, 14].map((q) => p.m1Lines([{ bc: G1, qty: q }]))
    const all = [X.hero, X.meta, X.cta, X.each, X.faqq, X.faqa, X.count(15), p.m1PriceText(G1), p.m1PriceHtml(G1), p.m1TierHint(4), p.m1TierHint(10),
      ...bags.flatMap((b) => [b.progress, b.applied, b.promo])].filter(Boolean).join(' | ')
    assert.doesNotMatch(all, FORBIDDEN)
    // every % on the page is exactly 70 and sits with a single price and the 10+ price
    for (const m of all.matchAll(/(\d+)%/g)) assert.equal(m[1], '70')
  }
  // no percentage at all without the claim (S1)
  const p = page(NOPCT)
  assert.doesNotMatch([p.m1PriceText(G1), p.m1Lines([{ bc: G1, qty: 10 }]).applied, p.m1Lines([{ bc: G1, qty: 4 }]).progress].join(' '), /%/)
  // the served static page: no strike/was/save and no "free from £12" left in visible copy or meta
  const visible = HTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  assert.doesNotMatch(visible, FORBIDDEN)
  assert.doesNotMatch(visible, /free from £12|over £12/)
})

test('#6/#7 delivery and money unchanged by the claim: £1.49 at 1–9, free at 10+; Stripe totals to the penny', () => {
  const all = (lines) => [...units(lines)]
  const cases = [
    [[{ bc: G1, qty: 1 }], 800, 149],                                                   // ×1 £9.49
    [[{ bc: G1, qty: 9 }], 7200, 149],                                                  // ×9B £73.49
    [[{ bc: G1, qty: 10 }], 2400, 0],                                                   // ×10B £24.00
    [[{ bc: 'SA', qty: 4 }, { bc: G1, qty: 3 }, { bc: 'SC', qty: 3 }], 2490, 0],        // 4A+3B+3C £24.90
  ]
  for (const [lines, total, fee] of cases) {
    for (const T of [M1P, NOPCT, LADDERS]) {
      assert.equal(priceUnits(all(lines), T), total)
      assert.equal(shippingFeeP(total, all(lines).length, T), fee)
    }
    const { pct_off: a, ...withPct } = cartSummary(all(lines), M1P)
    const { pct_off: b, ...noPct } = cartSummary(all(lines), NOPCT)
    assert.deepEqual(withPct, noPct, 'the claim changes no number')
    assert.equal(a, 70); assert.equal(b, null)
    assert.equal(Math.round(page(M1P).cartTotal(lines) * 100), total)
  }
})

test('#9 K-08 words: no "Diamond" / "Lux Stone" in the served group labels', () => {
  for (const T of [LADDERS, M1P]) for (const g of Object.values(publicLadders(T).groups)) assert.doesNotMatch(g.label, /Diamond|Lux Stone/, g.label)
})

test('page CTA: card form + the delivery sentence once (the ad line stays out of the page copy)', () => {
  const T = page(M1P).m1Texts()
  assert.equal(T.cta, 'Mix any shades · £8 each · 70% off when you buy any 10+ items (£2.40 each) · <span data-kl="ship">£1.49 UK delivery · free with any 10+ items</span>')
  assert.equal((T.cta.match(/delivery/g) || []).length, 1)
  // ad line (marketing, K&D #8): condition + from-price + delivery in one frame
  assert.equal(T.ad, 'Buy 10+, get 70% off · from £2.40 each · free UK delivery')
  const S = page(NOPCT).m1Texts()
  assert.equal(S.cta, 'Mix any shades · £8 each · £2.40 each when you buy any 10 or more items · <span data-kl="ship">£1.49 UK delivery · free with any 10+ items</span>')
  assert.equal(S.ad, null)
})

test('#10 accessibility: the secondary "70% off" lines are >= 12 px and #6b6457 (5.5:1 on the page background); bag line #8f5a52', () => {
  for (const [sel, rule] of [['.bundlecta .s', 'font-size:12px; color:#6b6457'], ['.col-head .c', 'font-size:12px; letter-spacing:.22em; text-transform:uppercase; color:#6b6457'],
    ['.story .row .it', 'font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:#6b6457'], ['.cart-m1 .m1on', 'color:#8f5a52; font-weight:600']]) {
    assert.ok(HTML.includes(`${sel}{${rule}`), sel)
  }
})

test('static first paint = JS text from ladders.json (cta, each, faqq, faqa): change the table -> change the HTML too', () => {
  const T = page(LADDERS).m1Texts()
  for (const k of ['cta', 'each', 'faqq', 'faqa']) assert.ok(HTML.includes(`data-kl-m1="${k}">${T[k]}</`), `static ${k} != m1Texts().${k} (regenerate the static HTML)`)
})
