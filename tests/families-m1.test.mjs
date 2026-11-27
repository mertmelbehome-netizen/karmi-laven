// Families view under M1 (mode cart_qty_groups), 23 Nov 2026 (morning review 10_families_screens):
//   1. family card price line = the Gradient cards' M1 text (index.html m1PriceHtml / m1PriceText) for the same group;
//      add button "Add to bag — £X.XX" with the group single price; no group = no price = hidden (K-12).
//   2. the % appears only when the table makes it exact (B tier £2.50 -> no %), never from storefront.js itself.
//   3. mobile sticky bar per tab: Gradient keeps the page bar; other tabs "From £X each" + delivery + "Shop <tab>".
//   Families OFF: storefront.js is never loaded (tests/storefront.test.mjs) and the page-output pins
//   (tests/m1-page.test.mjs, tests/m1-70off.test.mjs) are unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, loadLadders, publicLadders } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { pageFns } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { sfPriceLine, sfFamCard, sfAddText, sfSticky, sfState, sfDeal, sfTabPick };`)()
const RAW = JSON.parse(read('../ladders-preview/M1_mert_list.json'))
const load = (raw) => { const r = loadLadders(raw); assert.ok(r.ok, r.error); return r.table }
const [G1] = Object.keys(GRADIENT)
const extra = [{ barcode: 'SA', type: 'Stretch Bracelet', color_en: 'a' }, { barcode: 'SB', type: 'Stretch Charm Bracelet', color_en: 'b' },
  { barcode: 'SC', type: 'Charm Necklace', color_en: 'c' }, { barcode: 'NG', type: 'Hair Clips', color_en: 'n' }]
const groups = { SA: 'A', SB: 'B', SC: 'C' }   // NG: no online group
const W = (table) => {
  const livePrices = { SA: 5.99, SB: 5.99, SC: 9.99, NG: 4 }, v = publicLadders(table), p = pageFns(HTML, { ladders: v, extra, groups, livePrices })
  assert.equal(p.applyLadderShipping(v), true)
  return { ...p, klPrice: (bc) => livePrices[bc] ?? null }   // = window.klPrice (/api/stock price_pence)
}
const card = (bc, w, st = 'single') => core.sfFamCard({ barcode: bc, name: 'N', line: 'L', swatch: '#fff', photo: '/x.jpg' }, st,
  { line: core.sfPriceLine(bc, w), badge: null, ship: w.cardShipText(), full: false, dis: false, why: '' })
const prText = (html) => { const m = html.match(/<div class="pr">([\s\S]*?)<\/div><div class="fee"/); return m ? m[1].replace(/<[^>]+>/g, '') : null }
const addText = (html) => { const m = html.match(/<button[^>]*class="add"[^>]*>([^<]*)<\/button>/); return m && m[1] }

test('family card M1 price line = m1PriceText of the same group; add button = group single price', () => {
  assert.equal(LADDERS.mode, 'cart_qty_groups')
  const w = W(LADDERS)
  assert.equal(w.m1On(), true)
  for (const [bc, single] of [['SA', '£5.00'], ['SB', '£8.00'], ['SC', '£13.00']]) {
    const h = card(bc, w)
    assert.equal(prText(h), w.m1PriceText(bc), bc)
    // deal-first (owner 24 Nov 2026, re-pinned on purpose): the 10+ price leads with its condition, the single price follows
    assert.match(prText(h), /^£\d+\.\d\d each when you buy any 10\+ items \(70% off\) · £\d+ each for 1–9 items$/, bc)
    assert.match(h, /<b class="m1big">£\d+\.\d\d<\/b> each <span class="m1c">when you buy any 10\+ items/, bc)
    assert.equal(addText(h), 'Add to bag — ' + single, bc)
    assert.equal(core.sfPriceLine(bc, w).p, Math.round(w.unitPrice(bc) * 100), 'price = what the M1 bag charges, not the till price')
  }
  // a family card shows exactly the same price text as a Gradient card of the same group (B)
  assert.equal(prText(card('SB', w)), w.m1PriceText(G1))
  // no online group: no price, so the card is hidden (fail closed, K-12)
  assert.deepEqual(core.sfPriceLine('NG', w), { p: null, html: '', m1: true })
  assert.equal(core.sfState({ priceP: core.sfPriceLine('NG', w).p, photoOk: true, sellable: 5, stock: 5, badge: false }), 'hidden')
})

test('70% only when the table is exact: B tier £2.50 -> no % on a B family card, A/C keep it', () => {
  const raw = structuredClone(RAW); raw.groups.B.tier_each = 250
  const w = W(load(raw))
  assert.equal(prText(card('SB', w)), '£2.50 each when you buy any 10+ items · £8 each for 1–9 items')   // deal-first re-pin (24 Nov)
  assert.doesNotMatch(card('SB', w), /%/)
  assert.equal(prText(card('SA', w)), '£1.50 each when you buy any 10+ items (70% off) · £5 each for 1–9 items')   // deal-first re-pin (24 Nov)
  // no percent_claim in the table: no % anywhere
  const w0 = W(load({ ...RAW, ui: { ...RAW.ui, percent_claim: null } }))
  for (const bc of ['SA', 'SB', 'SC']) assert.doesNotMatch(card(bc, w0), /%/, bc)
  // storefront.js never writes a percentage itself (it only reuses the page's m1PriceHtml)
  assert.doesNotMatch(CORE.replace(/\/\*[\s\S]*?\*\//g, ''), /% off|percent_claim/)
})

test('pools table (rollback): family price = till price, plain money, no M1 text', () => {
  const w = W(load(JSON.parse(read('./fixtures/ladders.live-2026-11-23.json'))))
  assert.equal(w.m1On(), false)
  assert.deepEqual(core.sfPriceLine('SA', w), { p: 599, html: '£5.99', m1: false })
  assert.equal(addText(card('SA', w)), 'Add to bag — £5.99')
})

test('mobile sticky bar per tab (empty bag)', () => {
  assert.equal(core.sfSticky('gradient', 800, 149), null, 'Gradient: the page keeps "Each £8.00" + Build your bundle')
  assert.deepEqual(core.sfSticky('bracelets', 500, 149), { info: 'From <b>£5.00</b> each<span class="dl" data-kl="fee1">+ £1.49 UK delivery</span>', btn: 'Shop Bracelets' })
  assert.deepEqual(core.sfSticky('necklaces', 1300, 149), { info: 'From <b>£13.00</b> each<span class="dl" data-kl="fee1">+ £1.49 UK delivery</span>', btn: 'Shop Necklaces' })
  assert.equal(core.sfSticky('hair', 800, 0).info, 'From <b>£8.00</b> each<span class="dl" data-kl="fee1">Free UK delivery</span>')
  assert.equal(core.sfSticky('hair', null, 149).info, '<span class="dl" data-kl="fee1">+ £1.49 UK delivery</span>', 'no sellable card: no price claim')
  for (const t of ['bracelets', 'necklaces', 'hair']) assert.doesNotMatch(core.sfSticky(t, 500, 149).btn, /bundle/i)
  // deal-first (owner 24 Nov 2026, re-pinned on purpose): the Gradient bar leads with the 10+ price + condition, single price kept
  assert.match(HTML, /<div class="sp" id="stickyInfo" aria-live="polite"><b>£2\.40<\/b> each when you buy any 10\+ items<span class="dl one">£8 each for 1–9 items<\/span>/)
  const w = W(LADDERS)
  // family tabs: with deal parts the lowest 10+ price of the tab leads, its condition next to it, the single price stays on the bar
  const dA = core.sfDeal(['SA', 'SB'], w)
  assert.deepEqual(dA, { from: true, big: '£1.50', cond: 'when you buy any 10+ items (70% off)', cond0: 'when you buy any 10+ items', short: 'for any 10+ items', one: 'Single pieces from £5.00' })
  assert.deepEqual(core.sfDeal(['SB'], w), { from: false, big: '£2.40', cond: 'when you buy any 10+ items (70% off)', cond0: 'when you buy any 10+ items', short: 'for any 10+ items', one: '£8 each for 1–9 items' })
  assert.equal(core.sfDeal(['NG'], w), null, 'no online group: no deal claim')
  assert.equal(core.sfSticky('bracelets', 500, 149, null, dA).info, 'From <b>£1.50</b> each for any 10+ items<span class="dl" data-kl="fee1">+ £1.49 UK delivery</span>')
  assert.equal(core.sfSticky('bracelets', null, 149, null, dA).info, '<span class="dl" data-kl="fee1">+ £1.49 UK delivery</span>', 'no sellable card: no price claim')
  assert.equal(core.sfDeal(['SA'], { m1On: () => false }), null, 'pools table: no deal parts')
  assert.match(HTML, /<button class="sbtn" id="stickyBtn" onclick="openBundle\(\)">Build your bundle<\/button>/)
})

test('new storefront copy keeps K-08 wording rules', () => {
  const code = SF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  const strings = [...code.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]).filter((s) => /[a-z]{3}/i.test(s))
  for (const s of strings) assert.doesNotMatch(s, /hand-strung|diamond|\blux\b|\bstone\b|crystal|best|finest|premium/i, s)   // K-069 ring look labels (lead, K&D to confirm)
  assert.doesNotMatch(read('../terms.html'), /£8\.00 per bracelet|£2\.40 per item/, 'terms: no single-group price')
})

test('K-045/K-056: the referee-passed renders only (Karmi 08 A + L2 + 11 Showable + Komuta 23 Nov A(7) wholesale cards); no image label (footer note instead); web-sized; final line names', async () => {
  const { statSync } = await import('node:fs')
  const CARDS = JSON.parse(read('../data/cards.json')).cards
  // hair clips 1849-1865 + claws 0301xxxx withdrawn 23 Nov (owner: on-model renders do not sit right; tests/hair-no-onmodel)
  // G12-1 v2 (calibrated, 23 Nov, morning_review/36_g12_calibration): 0624 render cyan vs real navy -> measured-colour tile, still sellable
  { const c = CARDS.find((x) => x.barcode === '0624'); assert.equal(c.photo, null); assert.equal(c.tile_sellable, true); assert.ok(!c.ai_image); assert.equal(c.swatch, '#3c637a') }
  const SHOW = '2023 2040 1468 1472 1474 1477 6159 6170 6180 2000 6008 80012 80043 7058 7056 6095 6091 81004 81006 81009 81013 81014 6002 6009 6011 6017 6042 6058'.split(' ')
  // Bangle + Sparkle Line 13 (owner go-ahead 26 Nov 2026, morning_review/47_bangle_sparkle_final; one AI-styled image each)
  SHOW.push(...'80030 80028 80047 80034 80011 80016 80022 80024 81026 81056 81049 81038 81025'.split(' '))
  assert.ok(!CARDS.some((c) => c.barcode === '6093'), '6093 failed the referees')
  assert.deepEqual(CARDS.filter((c) => c.photo_qc).map((c) => c.barcode).sort(), [...SHOW].sort())
  for (const c of CARDS.filter((x) => x.photo_qc)) {
    assert.equal(c.ai_image, true, c.barcode)
    assert.equal(c.photo, `/img/fam/${c.barcode}.jpg`)
    assert.ok(statSync(new URL('..' + c.photo, import.meta.url)).size <= 150 * 1024, 'web-sized ' + c.photo)
    assert.doesNotMatch(c.name, /No\. \d|^\d+$/, 'no placeholder name ' + c.barcode)
  }
  for (const c of CARDS) assert.doesNotMatch(c.line, /Bangle Bracelet|Necklace Lux|Diamond/, 'K-056 line names ' + c.barcode)
  const w = W(LADDERS), c0 = { barcode: 'SB', name: 'N', line: 'L', swatch: '#fff', photo: '/x.jpg', ai_image: true }
  const o = { line: core.sfPriceLine('SB', w), badge: null, ship: '', full: false, dis: false, why: '' }
  // 27 Nov 2026 (owner): the per-image label is gone (one footer line instead); the AI card renders no label at all
  assert.match(core.sfFamCard(c0, 'single', o), /<div class="imgwrap"><img [^>]*><\/div><div class="cbody"><h3 class="nm">/)
  assert.doesNotMatch(core.sfFamCard(c0, 'single', o), /AI-styled|kl-ai/)
  assert.doesNotMatch(core.sfFamCard({ ...c0, ai_image: false }, 'single', o), /AI-styled|kl-ai/)
  assert.match(core.sfFamCard(c0, 'single', o), /loading="lazy"/)
  assert.match(read('../css/storefront.css'), /\.kl-ai\{font-size:12px;[^}]*color:#6b6457/)
})

// Komuta 24 Nov 2026 (CMA: a 'from' price must be available on what is shown): the hero block and the sticky bar use the
// lowest 10+ price among the cards SHOWN on the active tab + sub-chip, never a site-wide figure from another tab.
test('per-tab "from": hero (sfHeroPrice) and sticky/info (sfDeal) = the lowest 10+ price of the cards on the active tab', () => {
  const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
  const { sfHeroPrice } = new Function(`${LAYOUT}; return { sfHeroPrice };`)()
  const LINE = { 'Stretch Bracelet': 'A', 'Stretch Charm Bracelet': 'B', Bangle: 'C', 'Stretch Double Bracelet': 'C', 'Sparkle Line': 'C' }
  const CARDS = JSON.parse(read('../data/cards.json')).cards.filter((c) => c.tab === 'bracelets')
  const view = publicLadders(LADDERS)
  const w = pageFns(HTML, { ladders: view, extra: CARDS.map((c) => ({ barcode: c.barcode, type: c.line, color_en: c.name })),
    groups: Object.fromEntries(CARDS.filter((c) => LINE[c.line]).map((c) => [c.barcode, LINE[c.line]])) })
  const money = (p) => (p % 100 === 0 ? '£' + p / 100 : '£' + (p / 100).toFixed(2))
  const rows = [...Object.keys(GRADIENT).map((bc) => ({ bc, tab: 'gradient', line: 'Bead Bracelet', ok: true })),
    ...CARDS.map((c) => ({ bc: c.barcode, tab: c.tab, line: c.line, ok: true }))]
  const check = (tab, sub, want, from) => {
    const bcs = core.sfTabPick(tab, sub, rows).filter((bc) => w.m1Group(bc))   // = js tabBcs(): priced pieces only
    const keys = [...new Set(bcs.map((bc) => w.m1Group(bc)))]
    const lowest = Math.min(...keys.map((k) => view.groups[k].tier_each))
    assert.equal(money(lowest), want, `${tab}/${sub}`)
    const h = sfHeroPrice(view, keys), d = core.sfDeal(bcs, w)
    assert.equal(h.big, want, `hero ${tab}/${sub}`); assert.equal(h.from, from, `hero from ${tab}/${sub}`)
    assert.equal(d.big, want, `sticky ${tab}/${sub}`); assert.equal(d.from, from, `sticky from ${tab}/${sub}`)
    assert.equal(core.sfSticky(tab, 100, 149, null, d) && core.sfSticky(tab, 100, 149, null, d).info.indexOf('<b>' + want + '</b>') >= 0 || tab === 'gradient', true)
  }
  check('gradient', 'all', '£2.40', false)   // Gradient tab: its cards are group B only (never 'from £1.50')
  check('bracelets', 'all', '£1.50', true)   // mixed A/B/C: the lowest price present, with 'from'
  check('bracelets', 'stretch', '£1.50', false)   // only A cards
  check('bracelets', 'charm', '£2.40', false)
  check('bracelets', 'bangle', '£3.90', false)   // only C cards: never a lower figure from another tab
  assert.deepEqual(core.sfTabPick('rings', 'all', rows), [], 'no ring rows here; js tabBcs drops rings anyway (K-069)')
})
