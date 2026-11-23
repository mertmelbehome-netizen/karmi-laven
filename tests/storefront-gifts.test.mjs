// Gifts tab (growth plan W49-A2): a curated list of EXISTING, referee-passed, sellable pieces, defined in ONE place
// (data/gifts.json). No new products, no price / promo / deal change, no price literal in the list: every price text
// comes from the served table through the cards. The pure functions run as-is from js/storefront.js (KL-SF-CORE) and
// index.html (KL-SF-LAYOUT).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, SF_CHIP, SF_TITLE, SF_GIFTS_MIN, sfVisibleTabs, sfGiftRows, sfGiftCount, sfParseHash, sfHash };`)()
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const lay = new Function(`${LAYOUT}; return { SFL_TABS, SFL_CHIP, sfBar };`)()
const GIFTS_RAW = read('../data/gifts.json')
const GIFTS = JSON.parse(GIFTS_RAW)
const CARDS = JSON.parse(read('../data/cards.json')).cards
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const LADDER = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\])/)[1].replace(/'/g, '"'))
const items = GIFTS.sections.flatMap((s) => s.items)
const bcOf = (x) => String(typeof x === 'object' ? x.bc : x)
const file = (p) => new URL('..' + p, import.meta.url)

test('gifts.json only references existing, referee-passed pieces with a real photo (no tiles, rings, hair; no new products)', () => {
  assert.ok(items.length >= 4)
  const bcs = items.map(bcOf)
  assert.equal(new Set(bcs).size, bcs.length, 'no duplicate pick')
  for (const it of items) {
    const bc = bcOf(it), c = CARDS.find((x) => x.barcode === bc), d = DATA.find((x) => String(x.barcode) === bc)
    assert.ok(c || d, bc + ': not an existing product of the page')
    if (c) {
      assert.ok(c.photo && c.photo_qc === true, bc + ': family pick needs a QC-passed photo (photo_qc), never a colour tile')
      assert.ok(!['rings', 'hair'].includes(c.tab), bc + ': no rings / hair picks')
      assert.ok(existsSync(file(c.photo)), bc + ': photo file exists')
      assert.equal(typeof it, 'string', bc + ': family picks carry no per-pick overrides (identity from cards.json)')
    } else {
      assert.ok(LADDER.includes(d.type), bc + ': Gradient Edit piece')
      assert.ok(d.img && !d.img.startsWith('/img/tone/'), bc + ': Gradient pick needs a real/passed photo, not a colour tile')
      assert.ok(existsSync(file(d.img)), bc + ': photo file exists')
      assert.equal(bc, '1268', 'Gradient picks: only the referee-passed render (morning_review/19_live_gradient_audit)')
      assert.equal(it.ai_image, true, bc + ': render = labelled AI-styled image')
    }
  }
})

test('gifts.json: no price / % / deal / deadline literal anywhere; headings are short words only', () => {
  assert.doesNotMatch(GIFTS_RAW, /£|%|\bpence\b|\bsave\b|free gift|\boff\b|\bdeal\b/i)
  for (const s of GIFTS.sections) {
    assert.deepEqual(Object.keys(s).filter((k) => !['heading', 'items'].includes(k)), [])
    if (s.heading == null) continue
    assert.doesNotMatch(s.heading, /\d|£|%|free|save|christmas|order by|deliver|last|today|hurry|under|over/i, s.heading)
    assert.ok(s.heading.length <= 30)
  }
  assert.equal(GIFTS.sections[0].heading, undefined, 'no heading above the first cards (V-01)')
  for (const it of items) if (typeof it === 'object') assert.deepEqual(Object.keys(it).sort(), ['ai_image', 'bc'])
})

test('Gifts tab: chip after Hair, before Rings; same label in the pre-paint bar; #gifts deep link', () => {
  assert.deepEqual(core.SF_TABS, ['gradient', 'bracelets', 'necklaces', 'hair', 'gifts', 'rings'])
  assert.deepEqual(lay.SFL_TABS, core.SF_TABS, 'pre-paint chip bar knows the Gifts chip (CLS)')
  assert.equal(core.SF_CHIP.gifts, 'Gifts'); assert.equal(lay.SFL_CHIP.gifts, 'Gifts'); assert.equal(core.SF_TITLE.gifts, 'Gifts')
  assert.deepEqual(core.sfParseHash('#gifts'), { tab: 'gifts', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#gifts-x'), { tab: 'gifts', sub: 'all' })
  assert.equal(core.sfHash('gifts', 'all'), '#gifts')
  // pre-paint bar on a cold #gifts deep link: the Gifts chip is there and selected
  const doc = { createElement: () => ({ setAttribute() {}, innerHTML: '' }) }
  const nav = lay.sfBar(doc, ['gradient', 'bracelets', 'necklaces', 'gifts'], null, 'gifts')
  assert.match(nav.innerHTML, /id="kltab-gifts" data-tab="gifts" aria-controls="klFam" aria-selected="true" tabindex="0">Gifts /)
  assert.match(lay.sfBar(doc, ['gradient', 'bracelets'], null, 'gifts').innerHTML, /id="kltab-gifts"[^>]* hidden>/, 'not shown when not visible')
  // first visit (no remembered chips): the Gifts chip is painted with the others
  assert.match(HTML, /: \['gradient', 'bracelets', 'necklaces', 'gifts'\];/)
})

test('Gifts tab hidden with fewer than 4 sellable picks; rows keep order, skip unsellable picks and empty sections', () => {
  assert.equal(core.SF_GIFTS_MIN, 4)
  const cards = [{ tab: 'bracelets', st: 'single' }]
  assert.deepEqual(core.sfVisibleTabs(cards, (c) => c.st), ['gradient', 'bracelets'], 'no count = hidden')
  assert.deepEqual(core.sfVisibleTabs(cards, (c) => c.st, 3), ['gradient', 'bracelets'])
  assert.deepEqual(core.sfVisibleTabs(cards, (c) => c.st, 4), ['gradient', 'bracelets', 'gifts'])
  const doc = { sections: [{ items: ['a', 'b'] }, { heading: 'H1', items: ['c', { bc: 'd', ai_image: true }] }, { heading: 'H2', items: ['e'] }, { heading: 'H3', items: ['a'] }] }
  assert.deepEqual(core.sfGiftRows(doc, () => true), [{ bc: 'a' }, { bc: 'b' }, { h: 'H1' }, { bc: 'c' }, { bc: 'd' }, { h: 'H2' }, { bc: 'e' }], 'dedupe: H3 had only a repeat')
  const few = core.sfGiftRows(doc, (bc) => bc !== 'a' && bc !== 'b' && bc !== 'e')
  assert.deepEqual(few, [{ bc: 'c' }, { bc: 'd' }], 'no heading above the first cards; empty sections dropped')
  assert.equal(core.sfGiftCount(few), 2)
  assert.deepEqual(core.sfVisibleTabs([], () => 'hidden', core.sfGiftCount(few)), ['gradient'])
  assert.deepEqual(core.sfGiftRows(null, () => true), [], 'no gifts file = no rows')
  // the real list: enough picks for the tab when they are on sale
  assert.ok(core.sfGiftCount(core.sfGiftRows(GIFTS, () => true)) >= core.SF_GIFTS_MIN)
})

test('Gifts panel wording: intro without % (cards carry single price + 10+ condition, K-046); no free gift / save / dates', () => {
  const fn = SF.slice(SF.indexOf('function renderGifts('), SF.indexOf('function refreshFamButtons(')).replace(/\s\/\/ .*$/gm, '')   // code only, not comments
  assert.match(fn, /textContent = 'Gift picks from across the shop';/)
  assert.doesNotMatch(fn, /%|free gift|\bsave\b|christmas|order by/i)
  assert.match(fn, /famCardHTML\(c, giftState\(c\)\)/, 'gift cards = the family card markup (M1 price + delivery line, rings note automatic)')
  // only sellable picks are rows; a pick needs a QC-passed photo (never a colour tile / tile_sellable), never a ring
  assert.match(SF, /function giftState\(c\) \{\r?\n\s*if \(!c \|\| c\.tab === 'rings' \|\| !\(c\.photo && c\.photo_qc\)\) return 'hidden';/)
  assert.match(SF, /function giftOk\(bc\) \{ var s = giftState\(giftCard\(bc\)\); return s === 'sellable' \|\| s === 'single'; \}/)
})
