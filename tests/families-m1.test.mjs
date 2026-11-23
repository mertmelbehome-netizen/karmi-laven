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
const core = new Function(`${CORE}; return { sfPriceLine, sfFamCard, sfAddText, sfSticky, sfState };`)()
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
    assert.match(prText(h), /70% off when you buy any 10\+ items/, bc)
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
  assert.equal(prText(card('SB', w)), '£8 each · £2.50 each when you buy any 10 or more items')
  assert.doesNotMatch(card('SB', w), /%/)
  assert.equal(prText(card('SA', w)), '£5 each · 70% off when you buy any 10+ items (£1.50 each)')
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
  // the page's own Gradient bar text is unchanged
  assert.match(HTML, /<div class="sp" id="stickyInfo" aria-live="polite">Each <b>£8\.00<\/b>/)
  assert.match(HTML, /<button class="sbtn" id="stickyBtn" onclick="openBundle\(\)">Build your bundle<\/button>/)
})

test('new storefront copy keeps K-08 wording rules', () => {
  const code = SF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  const strings = [...code.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]).filter((s) => /[a-z]{3}/i.test(s))
  for (const s of strings) assert.doesNotMatch(s, /hand-strung|diamond|\blux\b|\bstone\b|crystal|best|finest|premium/i, s)
  assert.doesNotMatch(read('../terms.html'), /£8\.00 per bracelet|£2\.40 per item/, 'terms: no single-group price')
})

test('K-045/K-056: the referee-passed renders only (Karmi 08 A + L2 + 11 Showable + Komuta 23 Nov A(7) wholesale cards); each labelled "AI-styled image"; web-sized; final line names', async () => {
  const { statSync } = await import('node:fs')
  const CARDS = JSON.parse(read('../data/cards.json')).cards
  const SHOW = '2023 2040 1468 1470 1472 1474 1477 1849 1850 1854 1859 1863 1864 1865 0624 6159 6170 6180 2000 6008 80012 80043 7058 7056 6095 6091 03010013 03010035 03010009 03010025 03010002 81004 81006 81009 81013 81014 6002 6009 6011 6017 6042 6058'.split(' ')
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
  assert.match(core.sfFamCard(c0, 'single', o), /<small class="kl-ai">AI-styled image<\/small>/)
  assert.doesNotMatch(core.sfFamCard({ ...c0, ai_image: false }, 'single', o), /AI-styled/)
  assert.match(core.sfFamCard(c0, 'single', o), /loading="lazy"/)
  assert.match(read('../css/storefront.css'), /\.kl-ai\{font-size:12px;[^}]*color:#6b6457/)
})
