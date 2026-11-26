// Rings tab UI (owner decision K-069; spec morning_review/31_rings_ui_spec.md). The engine (api/_pricing.js flat group R,
// PR #73) ships dark; this file proves the PAGE agrees with it to the penny and never shows a ring with the 10+ texts.
//   1. ladders.json R disabled (production today): no ring is priced on the page, every page number/text as before, no
//      ring card can show (no QC photo, no tile exception) and no ring barcode is asked from /api/stock.
//   2. R enabled (test-only table): page m1Summary = engine cartSummary for mixed bags (rings + 10+ items, penny-exact,
//      delivery included); rings count toward neither the 10+ count nor the 70% figure, but (K-070/K-071, Mert 24 Nov 2026)
//      they DO count toward free delivery (free with any 10+ items, rings included).
//   3. E1: a ring card / Rings header / sticky bar carry the ring line ("£20 for any 5 rings · £4 each · minimum 5",
//      "+ £1.49 UK delivery; free with any 10+ items (rings included)", "We pick — every ring is different, designs vary");
//      a bag with rings says the 10+ PRICE count is for non-ring items. N2: the 10+ hero block steps aside on the Rings tab.
//   4. 1-4 rings: "Add N more rings to check out (minimum 5)", checkout disabled; the server's 400 rings_min_5 reads the same.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, loadLadders, publicLadders, priceUnits, cartSummary, shipBasis, shippingFeeP } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { blocks, pageData } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const RAW = JSON.parse(read('../ladders.json'))
const CARDS = JSON.parse(read('../data/cards.json')).cards
const RINGS = CARDS.filter((c) => c.tab === 'rings')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, SF_SUBS, sfSubOf, sfParseHash, sfHash, sfVisibleTabs, sfFamCard, sfSticky, sfState };`)()
// K-070 item-count mechanics are kept under the 24 Nov 2026 delivery block (£1.49, free with 10+ items; the engine still
// supports free_at_qty). The LIVE delivery (owner 25 Nov 2026: £3.99, free from £30.00 paid) with rings ON: ON_LIVE tests.
const QTY24 = (r) => { r.shipping = { free_threshold_pence: null, below_threshold_fee_pence: 149, free_at_qty: { enabled: true, qty: 10 }, derive_threshold: null }; return r }
const ON = (() => { const r = QTY24(structuredClone(RAW)); r.flat_groups.R.enabled = true; return loadLadders(r).table })()
const OFF24 = loadLadders(QTY24(structuredClone(RAW))).table
const ON_LIVE = (() => { const r = structuredClone(RAW); r.flat_groups.R.enabled = true; return loadLadders(r).table })()
const [G1] = Object.keys(GRADIENT)

// the page's pricing + delivery + M1 blocks, as-is; klGroup: 'RA' -> A, 'RB' -> B, 'RC' -> C, ring barcodes -> R
function page(view, extraGroups = {}) {
  const DATA = pageData(HTML), BY = {}
  for (const d of DATA) BY[d.barcode] = d
  for (const c of [...RINGS, { barcode: 'RA', line: 'Stretch Bracelet' }, { barcode: 'RB', line: 'Stretch Charm Bracelet' }, { barcode: 'RC', line: 'Bangle' }]) BY[c.barcode] = { barcode: c.barcode, type: c.line, color_en: c.name || c.line }
  const groups = { RA: 'A', RB: 'B', RC: 'C', ...Object.fromEntries(RINGS.map((c) => [c.barcode, 'R'])), ...extraGroups }
  const PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])
  const LADDER_TYPES = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const window = { klPrice: () => null, klGroup: (bc) => groups[bc] || null, klLadders: view }
  const b = blocks(HTML)
  const names = ['applyLadderShipping', 'deliveryFor', 'cartTotal', 'unitPrice', 'm1Group', 'm1Summary', 'm1Lines', 'klRingsShipNote', 'm1PriceText', 'm1PriceHtml', 'm1Texts', 'm1Flat', 'm1FlatKeys', 'm1FlatOf', 'm1RingTexts', 'm1BagDelivery', 'cardShipText', 'shipSentence']
  const p = new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', `${b.pricing}\n${b.delivery}\n${b.m1}\n; return { ${names.join(', ')} };`)(BY, LADDER_TYPES, PRICE, window)
  if (view) p.applyLadderShipping(view)
  return p
}
const RING = RINGS[0].barcode, RING2 = RINGS[5].barcode
const units = (lines) => lines.flatMap(({ bc, qty }) => Array.from({ length: qty }, () =>
  bc === G1 ? { ladder: true } : { ladder: false, unitP: 1, group: { RA: 'A', RB: 'B', RC: 'C' }[bc] || 'R' }))
const engineDelivery = (lines, table) => {
  const u = units(lines), total = priceUnits(u, table), sb = shipBasis(u, total, table)
  return { total, fee: shippingFeeP(sb.amountP, sb.units, table) }
}

// ---------- 1. disabled (production) ----------
test('R disabled (ladders.json): a ring barcode is not priced on the page; no ring text; nothing else changes', () => {
  assert.equal(RAW.flat_groups.R.enabled, false)
  const v = publicLadders(LADDERS), p = page(v)
  assert.equal(p.m1Group(RING), null)
  assert.equal(p.unitPrice(RING), null, 'no price = card hidden (K-12), never a guessed price')
  assert.equal(p.m1RingTexts(), null)
  assert.deepEqual(p.m1FlatKeys(), [])
  assert.equal(p.m1PriceText(RING), '')
  const lines = [{ bc: 'RB', qty: 9 }, { bc: RING, qty: 5 }]
  const s = p.m1Summary(lines)
  assert.equal(s.ungrouped, 5); assert.ok(!('tier_units' in s) && !('flat_short' in s), 'no ring fields with R off')
  const { ungrouped, ...pg } = s
  assert.deepEqual(pg, cartSummary(units([{ bc: 'RB', qty: 9 }]), LADDERS))
  assert.ok(!('rings' in p.m1Lines(lines)))
})

test('ring cards: data only (tab rings, no photo, no tile exception), every barcode of 28_rings_plan, unique, mapped to a sub-chip', () => {
  const want = ['82005', 'GEN-19C88F4F', 'GEN-497A945A', '82004', '82002', '82001', '82008', 'GEN-433BE6C6', 'GEN-ZIRCON-RING', '82006',
    'GEN-41A83C40', 'GEN-30B52FD6', 'GEN-E64396A6', 'GEN-C112D067', 'GEN-2536586E', '103193146']
  assert.deepEqual(RINGS.map((c) => c.barcode).sort(), [...want].sort())
  for (const bad of ['GEN-ACD5DD24', '82007']) assert.ok(!CARDS.some((c) => c.barcode === bad), 'left out: ' + bad)
  for (const c of RINGS) {
    assert.equal(c.photo, null, c.barcode); assert.equal(c.photo_qc, false); assert.ok(!('tile_sellable' in c), 'rings: photo first')
    assert.ok(core.sfSubOf('rings', c.line), 'sub-chip for ' + c.line)
    assert.doesNotMatch(`${c.name} ${c.line}`, /stainless|zircon|crystal|gemstone|natural|genuine|sterling|real |stone/i, c.barcode)
  }
})

test('gating: a ring card without a QC photo is never sellable and never in the grid; the Rings tab is hidden; R off = ring barcodes not requested', () => {
  // famState: rings never take the colour-tile exception
  assert.match(SF, /photoOk: !!\(c\.photo && c\.photo_qc\) \|\| \(c\.tab !== 'rings' && c\.tile_sellable === true\)/)
  assert.equal(core.sfState({ priceP: 400, photoOk: false, sellable: 10, stock: 10 }), 'photo')
  assert.equal(core.sfState({ priceP: null, photoOk: true, sellable: 10, stock: 10 }), 'hidden', 'R disabled = no price = hidden')
  // the grid drops 'photo' ring cards (no "Photo coming" tiles in Rings)
  assert.match(SF, /!\(x\.c\.tab === 'rings' && x\.s === 'photo'\)/)
  const cards = RINGS.map((c) => ({ ...c, st: 'photo' })).concat([{ tab: 'bracelets', st: 'single' }])
  assert.deepEqual(core.sfVisibleTabs(cards, (c) => c.st), ['bracelets', 'gradient'])
  assert.deepEqual(core.sfVisibleTabs([{ tab: 'rings', st: 'single' }], (c) => c.st), ['bracelets', 'rings', 'gradient'], 'turn on = photo + R enabled (Bracelets always: it holds the Gradient Edit)')
  assert.match(SF, /function famBcs\(\) \{ var r = typeof window\.m1FlatKeys === 'function' && window\.m1FlatKeys\(\)\.length > 0; return FAM\.filter\(function \(c\) \{ return c\.tab !== 'rings' \|\| r; \}\)/)
  // pre-paint chip bar: Rings after Hair, before the Gradient Edit (owner 26 Nov 2026: Beaded last); never painted from memory
  const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
  const L = new Function(`${LAYOUT}; return { SFL_TABS, SFL_CHIP };`)()
  assert.deepEqual(L.SFL_TABS, core.SF_TABS); assert.equal(core.SF_TABS[core.SF_TABS.length - 1], 'gradient'); assert.equal(core.SF_TABS[core.SF_TABS.indexOf('hair') + 1], 'rings')
  assert.equal(L.SFL_CHIP.rings, 'Rings')
})

// ---------- 2. enabled: page = engine ----------
test('R enabled: page m1Summary = engine cartSummary for mixed bags, every field (ring fields too), penny-exact delivery', () => {
  const v = publicLadders(ON), p = page(v)
  const bags = {
    '10 bracelets + 5 rings': [{ bc: 'RA', qty: 10 }, { bc: RING, qty: 5 }],
    '9 bracelets + 5 rings': [{ bc: 'RA', qty: 9 }, { bc: RING, qty: 5 }],
    '4 rings': [{ bc: RING, qty: 4 }],
    '5 rings only': [{ bc: RING, qty: 3 }, { bc: RING2, qty: 2 }],
    '9 B + 3 rings': [{ bc: 'RB', qty: 9 }, { bc: RING, qty: 3 }],
    'Gradient 6 + C 4 + 12 rings': [{ bc: G1, qty: 6 }, { bc: 'RC', qty: 4 }, { bc: RING, qty: 12 }],
  }
  for (const [name, lines] of Object.entries(bags)) {
    const { ungrouped, ...pg } = p.m1Summary(lines)
    assert.equal(ungrouped, 0, name)
    assert.deepEqual(pg, cartSummary(units(lines), ON), name)
  }
  // grid: 0..12 ladder items x 0..7 rings, page total + delivery = server charge
  for (let a = 0; a <= 12; a++) for (let r = 0; r <= 7; r++) {
    const lines = [a && { bc: 'RB', qty: a }, r && { bc: RING, qty: r }].filter(Boolean); if (!lines.length) continue
    const s = p.m1Summary(lines), d = p.m1BagDelivery(s, a + r)
    assert.deepEqual(s, { ...cartSummary(units(lines), ON), ungrouped: 0 }, `${a}/${r}`)
    if (r >= 5 || r === 0) {
      const e = engineDelivery(lines, ON)
      assert.equal(s.charged_pence, e.total, `${a}/${r} total`); assert.equal(d.feeP, e.fee, `${a}/${r} delivery`)
      assert.equal(d.totalP, e.total + e.fee)
    }
  }
  // the four named cases, in plain numbers
  const n = (lines) => { const s = p.m1Summary(lines); return [s.charged_pence, s.shipping_pence, s.tier_units, s.tier_unlocked, s.pct_off] }
  assert.deepEqual(n(bags['10 bracelets + 5 rings']), [10 * 150 + 2000, 0, 10, true, 70])
  assert.deepEqual(n(bags['9 bracelets + 5 rings']), [9 * 500 + 2000, 0, 9, false, 70], 'K-070: 14 items incl. rings = free delivery, still no 10+ price')
  assert.deepEqual(n(bags['4 rings']), [1600, 149, 0, false, null])
  assert.deepEqual(n(bags['5 rings only']), [2000, 149, 0, false, null])
})

test('R enabled, bag without rings: page = engine and = the table without R (only the E1c "non-ring" note on progress lines)', () => {
  const p = page(publicLadders(ON)), off = page(publicLadders(OFF24))
  for (let a = 1; a <= 12; a++) for (const bc of ['RA', 'RB', G1]) {
    const lines = [{ bc, qty: a }], { tier_units, ship_units, flat_short, ...s } = p.m1Summary(lines)
    assert.equal(ship_units, tier_units)
    assert.deepEqual(s, off.m1Summary(lines)); assert.deepEqual(flat_short, [])
    const L = p.m1Lines(lines), { rings, ...rest } = L
    assert.deepEqual(rings, [])
    const o = off.m1Lines(lines)
    assert.deepEqual({ ...rest, progress: rest.progress && rest.progress.replace(/^Add (\d+) more non-ring items?/, 'Add $1 more').replace(/every non-ring item/g, 'every item') }, o)
    if (o.progress) assert.match(rest.progress, /non-ring item/, 'rings ON: rings never count, even with none in the bag')
  }
})

// K-070/K-071 (Mert, 24 Nov 2026): rings count toward free delivery, never toward the 10+ / 70% price. Page = engine.
test('K-070 bags (page = engine): 10 rings / 5+5 / 6 non-ring + 4 rings / 4 rings; delivery counts rings, 70% does not', () => {
  const p = page(publicLadders(ON))
  const row = (lines) => { const s = p.m1Summary(lines), L = p.m1Lines(lines), d = p.m1BagDelivery(s, s.units)
    assert.deepEqual(s, { ...cartSummary(units(lines), ON), ungrouped: 0 })
    return { total: s.charged_pence, ship: d.feeP, tier: s.tier_unlocked, groups: s.groups.map((g) => g.group + ':' + g.each_charged), L } }
  let r = row([{ bc: RING, qty: 6 }, { bc: RING2, qty: 4 }])   // 10 rings only
  assert.deepEqual([r.total, r.ship, r.tier, r.groups], [4000, 0, false, ['R:400']])
  assert.equal(r.L.progress, null); assert.deepEqual(r.L.rings, []); assert.equal(r.L.delivery, undefined)
  r = row([{ bc: RING, qty: 5 }, { bc: 'RB', qty: 5 }])   // 5 rings + 5 ladder items
  assert.deepEqual([r.total, r.ship, r.tier, r.groups], [2000 + 5 * 800, 0, false, ['B:800', 'R:400']])
  assert.match(r.L.progress, /^Add 5 more non-ring items/); assert.doesNotMatch(r.L.progress, /free delivery/)
  r = row([{ bc: 'RB', qty: 6 }, { bc: RING, qty: 4 }])   // 6 non-ring + 4 rings: delivery free, B at its 1-9 price; rings short
  assert.deepEqual([r.total, r.ship, r.tier, r.groups], [6 * 800 + 1600, 0, false, ['B:800', 'R:400']])
  assert.deepEqual(r.L.rings, ['Add 1 more ring to check out (minimum 5)'])
  r = row([{ bc: RING, qty: 4 }])   // 4 rings
  assert.deepEqual([r.total, r.ship, r.tier], [1600, 149, false]); assert.deepEqual(r.L.rings, ['Add 1 more ring to check out (minimum 5)'])
  // counted rings make delivery free BEFORE the 10+ price: own delivery line, the unlock line does not claim free delivery
  r = row([{ bc: RING, qty: 5 }, { bc: 'RB', qty: 3 }])
  assert.equal(r.ship, 149)
  assert.equal(r.L.delivery, 'Add 2 more items (rings included) for free delivery')
  assert.doesNotMatch(r.L.progress, /free/)
  // no ring in the bag: no delivery line (= before)
  assert.equal(p.m1Lines([{ bc: 'RB', qty: 3 }]).delivery, undefined)
})

test('LIVE delivery (owner 25 Nov 2026) + rings ON: page = engine (rings count toward £30.00, 10+ alone not free); ring delivery line', () => {
  const p = page(publicLadders(ON_LIVE))
  for (let a = 0; a <= 12; a++) for (let r = 0; r <= 9; r++) {
    const lines = [a && { bc: 'RB', qty: a }, r && { bc: RING, qty: r }].filter(Boolean); if (!lines.length) continue
    const s = p.m1Summary(lines), d = p.m1BagDelivery(s, a + r)
    assert.deepEqual(s, { ...cartSummary(units(lines), ON_LIVE), ungrouped: 0 }, `${a}/${r}`)
    if (r >= 5 || r === 0) {
      const e = engineDelivery(lines, ON_LIVE)
      assert.equal(s.charged_pence, e.total, `${a}/${r} total`); assert.equal(d.feeP, e.fee, `${a}/${r} delivery`)
    }
  }
  const fee = (lines) => p.m1Summary(lines).shipping_pence
  assert.equal(fee([{ bc: RING, qty: 5 }]), 399)                         // £20.00
  assert.equal(fee([{ bc: RING, qty: 8 }]), 0)                           // £32.00
  assert.equal(fee([{ bc: RING, qty: 5 }, { bc: 'RB', qty: 2 }]), 0)    // £36.00
  assert.equal(fee([{ bc: 'RB', qty: 10 }]), 399)                        // 10+ = £24.00 -> pays
  assert.equal(p.m1Lines([{ bc: RING, qty: 5 }]).delivery, 'Add £10.00 for free delivery')
  assert.equal(p.m1RingTexts().ship, '+ £3.99 UK delivery, free on orders of £30 or more')
})

// ---------- 3. texts ----------
test('E1: ring price / delivery / design lines; never the generic 10+ free line, no %, no save, no strike-through', () => {
  const p = page(publicLadders(ON)), T = p.m1RingTexts()
  assert.equal(T.price, '£20 for any 5 rings · £4 each · minimum 5')
  assert.equal(T.ship, '+ £1.49 UK delivery; free with any 10+ items (rings included)')
  assert.equal(T.design, 'We pick — every ring is different, designs vary')
  assert.equal(p.m1PriceText(RING), T.price)
  assert.equal(p.m1PriceHtml(RING).replace(/<[^>]*>/g, ''), T.price)
  assert.equal(p.unitPrice(RING), 4)
  const all = [T.price, T.ship, T.design, T.priceHtml, T.group, T.sub(5), T.short(1), T.short(3)].join(' | ')
  assert.doesNotMatch(all, /non-ring|%|\bsave|<s>|<del>|line-through|was £|stainless|zircon|crystal|gemstone|\blux\b|diamond|\bstone|designed|hand-strung/i)
  assert.doesNotMatch(all.replace('free with any 10+ items (rings included)', ''), /free with any|10\+/, 'the only 10+ text next to rings = the delivery line, rings included')
  assert.equal(T.group, 'Rings (min 5)'); assert.equal(T.sub(5), '5 rings · £20.00'); assert.equal(T.sub(1), '1 ring · £4.00')
  // the ring card: own delivery hook (applyShipTexts never rewrites it with cardShipText), the design line, no 10+ text
  const card = core.sfFamCard({ barcode: RING, name: 'Steel-look Chunky', line: 'Steel-look Chunky Ring', swatch: '#ccc', photo: '/img/x.jpg' }, 'single',
    { line: { p: 400, html: T.priceHtml }, ship: T.ship, shipKey: 'ringship', note: T.design })
  assert.match(card, /data-kl="ringship">\+ £1\.49 UK delivery; free with any 10\+ items \(rings included\)</)
  assert.match(card, /<p class="kl-note">We pick — every ring is different, designs vary<\/p>/)
  assert.doesNotMatch(card, /non-ring|70%|data-kl="cardship"/)
  assert.doesNotMatch(HTML, /\[data-kl="ringship"\]/, 'applyShipTexts does not touch the ring line')
  // famCardHTML wires it for ring cards
  assert.match(SF, /ship: R \? R\.ship : cardShipText\(\), shipKey: R \? 'ringship' : null, note: R \? R\.design : null/)
  // sticky bar on the Rings tab
  const st = core.sfSticky('rings', 400, 149, T)
  assert.equal(st.btn, 'Shop Rings'); assert.doesNotMatch(st.info, /non-ring|70%|From/)
  assert.match(st.info, /£20 for any 5 rings/)
  // non-ring cards: markup byte-identical to before (no shipKey/note)
  const c = { barcode: 'X', name: 'N', line: 'Bangle', swatch: '#ccc', photo: '/img/x.jpg' }
  assert.match(core.sfFamCard(c, 'single', { line: { p: 1300, html: 'h' }, ship: 'S' }), /<div class="fee" data-kl="cardship">S<\/div><button/)
})

test('E1 (b): a bag with rings says the 10+ count is for non-ring items; 1-4 rings = "Add N more rings to check out (minimum 5)"', () => {
  const p = page(publicLadders(ON))
  let L = p.m1Lines([{ bc: 'RB', qty: 9 }, { bc: RING, qty: 3 }])
  assert.deepEqual(L.rings, ['Add 2 more rings to check out (minimum 5)'])
  assert.match(L.progress, /^Add 1 more non-ring item for 70% off every non-ring item/)
  L = p.m1Lines([{ bc: 'RA', qty: 6 }, { bc: RING, qty: 5 }])
  assert.deepEqual(L.rings, []); assert.match(L.progress, /^Add 4 more non-ring items/)
  L = p.m1Lines([{ bc: RING, qty: 4 }])
  assert.deepEqual(L.rings, ['Add 1 more ring to check out (minimum 5)']); assert.equal(L.progress, null)
  L = p.m1Lines([{ bc: RING, qty: 1 }]); assert.deepEqual(L.rings, ['Add 4 more rings to check out (minimum 5)'])
  // 10+ applied with rings: the "£y each (70% off)" figures name the ladder groups only (never a ring price)
  L = p.m1Lines([{ bc: 'RB', qty: 10 }, { bc: RING, qty: 5 }])
  assert.equal(L.applied, '10+ price applied: £2.40 each (70% off)'); assert.deepEqual(L.rings, [])
  // bag footer (m1Foot): free line + band say "items (rings included)" (K-070), the 10+ price line "non-ring items" (E1c);
  // checkout disabled while rings are short
  const foot = HTML.match(/function m1Foot\(\)\{[\s\S]*?\n\}/)[0]
  assert.match(foot, /free with any '\+SHIP\.freeQty\+'\+ items'\+sn\+'<\/span>/)
  assert.match(foot, /'Free UK delivery with any '\+SHIP\.freeQty\+'\+ items'\+sn\+' · otherwise '/)
  assert.match(foot, /ni=klRingsNote\(\), sn=klRingsShipNote\(\);/)
  assert.match(foot, /cb\.disabled=!cart\.length\|\|rl\.length>0/)
  // ring lines grouped in the bag with their own subtotal
  assert.match(HTML, /'<div class="ci-grp" role="group" aria-label="'\+T\.group\+'"><div class="ci-gh"><b>'\+T\.group\+'<\/b><span>'\+T\.sub\(n\)\+'<\/span><\/div>'/)
})

test('checkout: 1-4 rings never reach /api/checkout; the server 400 rings_min_5 shows "Add N more rings to check out (minimum 5)"', () => {
  const co = HTML.match(/async function checkout\(\)\{[\s\S]*?\n\}/)[0]
  assert.match(co, /if\(m1On\(\)\)\{ const L=m1Lines\(cart\); if\(L\.rings&&L\.rings\.length\)\{ renderCart\(\); toast\(L\.rings\[0\],7000\); return; \} \}/)
  assert.match(HTML, /const nr=cart\.filter\(c=>!\(m1On\(\)&&m1FlatOf\(c\.bc\)\)\);/, "the bag's '+ Add' (10+ line) never adds a ring")
  assert.match(co, /if\(r\.status===400\)\{[\s\S]*?\/_min_\\d\+\$\/\.test\(String\(j\.error\|\|''\)\)[\s\S]*?T\.short\(it\.add\)/)
})

test('N2: on the Rings tab the 10+ hero price / delivery block steps aside for the ring line; rings never set the hero "from" price', () => {
  assert.match(SF, /\.filter\(function \(bc\) \{ return !isRing\(bc\) && priceP\(bc\) > 0; \}\);   \/\/ K-069: rings never set the 'from' price/)   // per-tab tabBcs (24 Nov)
  const fn = SF.match(/function syncRingInfo\(\) \{[\s\S]*?\n  \}/)[0]
  assert.match(fn, /\$\$\('\.launch, \.launchfee', info\)\.forEach\(function \(e\) \{ e\.classList\.toggle\('kl-roff', !!R\); \}\)/)
  assert.match(fn, /ri\.textContent = R \? R\.price \+ ' · ' \+ R\.ship : ''/)
  assert.match(fn, /if \(gd\) gd\.hidden = !!R;/, 'the generic 10+ delivery line under the Rings title is hidden')
  assert.match(CSS, /\.kl-dlv\[hidden\], \.kl-roff, \.kl-ringinfo\[hidden\]\{display:none !important\}/)
  // even with R enabled the page-wide texts (hero, meta, FAQ, JSON-LD, CTA) are the ladder-group texts (no ring auto pick-up)
  const on = page(publicLadders(ON)).m1Texts(), off = page(publicLadders(OFF24)).m1Texts()
  // except the E1b/E1c note on every 10+ price claim ('any 10+ non-ring items') and the K-070 delivery note
  // ('free with any 10+ items (rings included)'); full scan: tests/rings-e1c.test.mjs
  assert.equal(JSON.stringify({ ...on, count: on.count(15) }).replace(/(Buy \d+\+) non-ring items,/g, '$1,').replace(/ non-ring(?= items?\b)/g, '').replace(/ items \(rings included\)/g, ' items'), JSON.stringify({ ...off, count: off.count(15) }))
})

test('sub-chips: spec hashes and labels (no unverified material words), hash round trip incl. #rings-steel-chunky', () => {
  assert.deepEqual(core.SF_SUBS.rings.map((x) => x.k), ['steel-chunky', 'steel', 'charm', 'ivory', 'chip', 'butterfly', 'sparkle', 'antique', 'enamel', 'rough-cut'])
  assert.deepEqual(core.SF_SUBS.rings.map((x) => x.label), ['Steel-look Chunky', 'Steel-look', 'Charm', 'Ivory', 'Chip', 'Butterfly & Starfish', 'Sparkle', 'Antique-Style', 'Enamel', 'Rough-Cut Look'])
  assert.deepEqual(core.sfParseHash('#rings-steel-chunky'), { tab: 'rings', sub: 'steel-chunky' })
  assert.deepEqual(core.sfParseHash('#rings-rough-cut'), { tab: 'rings', sub: 'rough-cut' })
  assert.deepEqual(core.sfParseHash('#rings'), { tab: 'rings', sub: 'all' })
  assert.equal(core.sfHash('rings', 'steel-chunky'), '#rings-steel-chunky')
  assert.equal(core.sfSubOf('rings', 'Steel-look Ring'), 'steel'); assert.equal(core.sfSubOf('rings', 'Steel-look Chunky Ring'), 'steel-chunky')
  assert.equal(core.sfSubOf('rings', 'Statement Sparkle Ring'), 'sparkle')
  assert.match(SF, /id="klRSubs" role="tablist" aria-label="Ring styles"/)
})

test('E1b/E1c + K-070: "any 10+ non-ring items" on 10+ price claims, "free with any 10+ items (rings included)" on delivery, ONLY while rings are on', () => {
  assert.match(HTML, /function klRingsNote\(\)\{ try\{ return \(typeof m1FlatKeys==='function' && m1FlatKeys\(\)\.length\) \? ' non-ring' : ''; \}catch\(e\)\{ return ''; \} \}/)
  assert.match(HTML, /function klRingsShipNote\(\)\{ try\{ return \(typeof m1FlatKeys==='function' && m1FlatKeys\(\)\.length\) \? ' \(rings included\)' : ''; \}catch\(e\)\{ return ''; \} \}/)
  const on = page(publicLadders(ON)), off = page(publicLadders(OFF24))
  assert.match(on.shipSentence(), /free with any 10\+ items \(rings included\)$/)
  assert.equal(on.cardShipText(), '+ £1.49 UK delivery · free with any 10+ items (rings included)')
  assert.equal(off.klRingsShipNote(), '')
  assert.doesNotMatch(off.shipSentence(), /rings/)
})
