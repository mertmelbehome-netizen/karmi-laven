// Gradient Edit into Bracelets (26 Nov 2026): the 8 Gradient cards on sale sit in the Bracelets grid (All) and under a
// 'Beaded' sub-chip of Bracelets; the separate last 'Beaded' chip is gone. Internally the Gradient Edit stays tab
// 'gradient' (= the Bracelets > Beaded view), so its pool / ladder (api/_pricing.js poolKey, not edited), bundle builder,
// sticky bar, colour bar, gift picks and cart lines are the same code as before. Pure functions run as-is from
// js/storefront.js (KL-SF-CORE) and index.html (KL-SF-LAYOUT); the DOM wiring is pinned on its source lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, SF_SUBS, sfSubOf, sfParseHash, sfHash, sfVisibleSubs, sfVisibleTabs, sfTabPick, sfSticky, sfPoolKey };`)()
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const lay = new Function(`${LAYOUT}; return { sfBar, sfDefTab, SFL_TABS };`)()
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const CARDS = JSON.parse(read('../data/cards.json')).cards
const ON_SALE = ['1266', '1267', '1268', '1269', '1271', '1272', '1302', '1310']   // live 26 Nov (scripts/dev/serve.mjs GRAD_SELLABLE)
const navDoc = { createElement: () => ({ setAttribute() {}, innerHTML: '' }) }

test('no separate Beaded chip: the chip bar has no gradient button; Bracelets is always shown and stands for the Gradient view', () => {
  const html = lay.sfBar(navDoc, ['bracelets', 'necklaces', 'gifts', 'gradient'], null, '').innerHTML
  assert.doesNotMatch(html, /kltab-gradient|data-tab="gradient"/)
  assert.deepEqual([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]), ['bracelets', 'necklaces', 'gifts', 'hair', 'rings'])
  // the Gradient view (#gradient, #bracelets-beaded) selects the Bracelets chip; Bracelets shows even with no family card on sale
  for (const h of ['gradient', 'gradient-cobra', 'bracelets-beaded']) {
    assert.equal(lay.sfDefTab(['necklaces', 'gradient'], h), 'gradient', h)
    assert.match(lay.sfBar(navDoc, ['necklaces', 'gradient'], null, h).innerHTML, /id="kltab-bracelets" data-tab="bracelets" aria-controls="klFam" aria-selected="true" tabindex="0">Bracelets /, h)
  }
  assert.deepEqual(core.sfVisibleTabs([], () => 'hidden', 0), ['bracelets', 'gradient'])
  assert.equal(lay.sfDefTab([], ''), 'bracelets', 'landing = Bracelets (All), which holds the Gradient cards')
  // the internal tab key stays: the Gradient pool key is the server's (api/_pricing.js poolKey), not a chip
  assert.equal(core.SF_TABS[core.SF_TABS.length - 1], 'gradient'); assert.deepEqual(lay.SFL_TABS, core.SF_TABS)
  assert.equal(core.sfPoolKey({ pools: { gradient: {}, 800: {} } }, true, 800), 'gradient')
})

test('old links keep landing on the Gradient cards; the view\'s own URL is #bracelets-beaded', () => {
  for (const [h, sub] of [['#gradient', 'all'], ['#gradient-classic', 'classic'], ['#gradient-cobra', 'cobra'], ['#gradient-nope', 'all'], ['#bracelets-beaded', 'all'], ['#BRACELETS-BEADED', 'all']]) {
    assert.deepEqual(core.sfParseHash(h), { tab: 'gradient', sub }, h)
  }
  assert.equal(core.sfHash('gradient', 'all'), '#bracelets-beaded')
  assert.equal(core.sfHash('bracelets', 'beaded'), '#bracelets-beaded')
  assert.equal(core.sfHash('gradient', 'classic'), '#gradient-classic')
  assert.deepEqual(core.sfParseHash('#bracelets'), { tab: 'bracelets', sub: 'all' })
  // start + popstate + every in-page '#...' link go through sfParseHash -> setTab; setTab maps Bracelets > Beaded to the view
  assert.match(SF, /if \(t === 'bracelets' && s === 'beaded'\) \{ t = 'gradient'; s = 'all'; \}/)
  assert.match(SF, /<a class="btn ghost" href="#bracelets-beaded">See beaded bracelets<\/a>/)
})

test('Bracelets sub-chips: Beaded counts exactly the Gradient pieces on sale; All = family + Gradient', () => {
  assert.deepEqual(core.SF_SUBS.bracelets.map((x) => x.k), ['stretch', 'charm', 'bangle', 'double', 'sparkle', 'beaded'])
  const fam = CARDS.filter((c) => c.tab === 'bracelets').map((c) => ({ line: c.line, ok: true }))
  const grad = DATA.filter((d) => ['Lux Bracelet', 'Lux Cobra Bracelet'].includes(d.type)).map((d) => ({ line: d.type, ok: ON_SALE.includes(d.barcode), sub: 'beaded' }))
  for (const c of fam) assert.notEqual(core.sfSubOf('bracelets', c.line), 'beaded', c.line)
  const v = Object.fromEntries(core.sfVisibleSubs('bracelets', fam.concat(grad)).map((x) => [x.k, x.n]))
  assert.equal(v.beaded, 8)
  assert.equal(v.all, fam.length + 8)
  // the 'from' price of Bracelets > All takes the Gradient cards into account (they are shown there)
  const rows = fam.map((c, i) => ({ bc: 'F' + i, tab: 'bracelets', line: c.line, ok: true }))
    .concat(DATA.map((d) => ({ bc: d.barcode, tab: 'bracelets', line: d.type, sub: 'beaded', ok: ON_SALE.includes(d.barcode) })))
  const all = core.sfTabPick('bracelets', 'all', rows)
  for (const bc of ON_SALE) assert.ok(all.includes(bc), bc)
  assert.deepEqual(core.sfTabPick('bracelets', 'stretch', rows).filter((bc) => ON_SALE.includes(bc)), [])
  assert.match(SF, /return t === 'bracelets' \? fam\.concat\(gradItems\(\)\.map\(function \(x\) \{ return \{ line: x\.line, ok: x\.ok, sub: 'beaded' \}; \}\)\) : fam;/)
  assert.match(SF, /if \(tab === 'bracelets'\) rows = rows\.concat\(\(window\.DATA \|\| \[\]\)\.filter\(function \(d\) \{ return isGrad\(d\.barcode\); \}\)/)
})

test('Bracelets > All = ONE grid (the page\'s own Gradient grid node moved in); Beaded view = the Gradient panel as before', () => {
  assert.match(SF, /'<div id="klBGrid"><div class="grid" id="klFamGrid"><\/div><\/div>'/)
  assert.match(SF, /if \(gall && grid\.parentNode !== bw\) bw\.appendChild\(grid\); else if \(!gall && grid\.parentNode !== pal\) pal\.appendChild\(grid\);/)
  assert.match(SF, /pal\.hidden = !isG; \$\('\.swatchbar'\)\.hidden = !isG;/)
  assert.match(CSS, /html\.kl-v2\[data-kl-gall\] #klBGrid > \.grid\{display:contents\}/)
  // the Bracelets panel sits above the colour bar, so the Beaded view reads: sub-chip row, colour bar, Gradient grid
  assert.match(SF, /var swb = \$\('\.swatchbar'\), at = swb && swb\.parentNode === pal\.parentNode \? swb : pal;\s+pal\.parentNode\.insertBefore\(sec, at\);/)
  // All never keeps a colour filter from the Beaded view
  assert.match(SF, /else if \(Array\.isArray\(list\) && tab !== 'gradient'\) list = DATA;/)
  // family add buttons only: the Gradient cards keep their own onclick (no double add from the delegated handler)
  assert.match(SF, /if \(t\.matches\('#klFamGrid \[data-kl-add\]'\)\)/)
  assert.match(HTML, /<div class="grid" id="grid"><\/div>/)
})

test('sticky bar per tab unchanged: the Gradient view keeps the page bar (bundle builder); Bracelets keeps "Shop Bracelets"', () => {
  assert.equal(core.sfSticky('gradient', 800, 399, null, null), null)
  assert.equal(core.sfSticky('bracelets', 500, 399, null, null).btn, 'Shop Bracelets')
})
