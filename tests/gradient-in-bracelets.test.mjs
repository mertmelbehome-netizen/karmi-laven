// Gradient Edit into Bracelets (26 Nov 2026): the 8 Gradient cards on sale sit in the Bracelets grid (All) and under the
// Bracelets sub-chips 'Colour, worn softly' (all 8) / 'Classic' / 'Cobra'; the separate last 'Beaded' chip is gone.
// Komuta 26 Nov (D-002 stands, Mert: 'Gradient kalksin'): no visible 'Gradient' word anywhere; 'Beaded' only as the
// 'Beaded bracelet' card meta; chip label and card line use exactly the same words. Internally the Gradient Edit stays
// tab 'gradient' (= the Bracelets > Colour view), so its pool / ladder (api/_pricing.js poolKey, not edited), bundle
// builder, sticky bar, colour bar, gift picks and cart lines are the same code as before. Pure functions run as-is from
// js/storefront.js (KL-SF-CORE) and index.html (KL-SF-LAYOUT); the DOM wiring is pinned on its source lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, SF_SUBS, SF_TITLE, SF_CHIP, sfSubOf, sfParseHash, sfHash, sfVisibleSubs, sfVisibleTabs, sfTabPick, sfSticky, sfPoolKey };`)()
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const lay = new Function(`${LAYOUT}; return { sfBar, sfDefTab, SFL_TABS, SFL_CHIP, SFL_GSUBS };`)()
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const CARDS = JSON.parse(read('../data/cards.json')).cards
const ON_SALE = ['1266', '1267', '1268', '1269', '1271', '1272', '1302', '1310']   // live 26 Nov (scripts/dev/serve.mjs GRAD_SELLABLE)
const CW = 'Colour, worn softly'
const navDoc = { createElement: () => ({ setAttribute() {}, innerHTML: '' }) }
const gsub = (t) => ['colour', 'colour-' + core.sfSubOf('gradient', t)]   // = storefront gradSubs

/** Cold load of a full URL, the way the page lands: pre-paint sfDefTab(hash) picks the panel, storefront.js start()
 *  runs sfParseHash(location.hash) -> setTab (Bracelets colour keys -> the Gradient view) -> replaceState(sfHash).
 *  Returns the selected Bracelets chip key (renderSubs 'cur'), the final hash and the cards shown (render filter). */
function coldLoad(url) {
  const h = new URL(url).hash
  const pre = lay.sfDefTab(['bracelets', 'necklaces', 'gifts', 'gradient'], h.replace(/^#/, ''))
  const ph = core.sfParseHash(h)
  let t = ph ? ph.tab : 'bracelets', s = ph ? ph.sub : 'all'
  if (t === 'bracelets' && /^(colour|gradient)(-|$)|^beaded$/.test(s)) { t = 'gradient'; s = 'all' }   // setTab guard (not reached: sfParseHash maps first)
  const chip = t === 'gradient' ? (s !== 'all' ? 'colour-' + s : 'colour') : s
  const cards = t === 'gradient' ? ON_SALE.filter((bc) => s === 'all' || core.sfSubOf('gradient', DATA.find((d) => d.barcode === bc).type) === s) : null
  return { pre, tab: t, chip, hash: core.sfHash(t, s), cards }
}

test('old and new links, cold URL load (query strings too), land on the named chip with its cards', () => {
  const B = 'https://karmilaven.com/'
  const all = { pre: 'gradient', tab: 'gradient', chip: 'colour', hash: '#bracelets-colour', cards: ON_SALE }
  const classic = { pre: 'gradient', tab: 'gradient', chip: 'colour-classic', hash: '#bracelets-colour-classic', cards: ['1302', '1310'] }
  const cobra = { pre: 'gradient', tab: 'gradient', chip: 'colour-cobra', hash: '#bracelets-colour-cobra', cards: ['1266', '1267', '1268', '1269', '1271', '1272'] }
  for (const [u, want] of [
    [B + '#gradient', all], [B + '?utm_source=ig&utm_medium=bio#gradient', all], [B + '?sf=families#gradient', all],
    [B + '#gradient-classic', classic], [B + '#gradient-cobra', cobra], [B + '?utm_source=x#gradient-cobra', cobra],
    [B + '#gradient-nope', all], [B + '#bracelets-beaded', all], [B + '#BRACELETS-BEADED', all],
    [B + '#bracelets-gradient', all], [B + '#bracelets-gradient-classic', classic], [B + '?utm_campaign=c#bracelets-gradient-cobra', cobra],
    [B + '#bracelets-colour', all], [B + '?utm_source=ig#bracelets-colour', all], [B + '#bracelets-colour-classic', classic],
    [B + '#bracelets-colour-cobra', cobra], [B + '#bracelets-colour-nope', all],
  ]) assert.deepEqual(coldLoad(u), want, u)
  assert.equal(coldLoad(B + '#bracelets').tab, 'bracelets'); assert.equal(coldLoad(B).hash, '#bracelets')
  // the live wiring that coldLoad mirrors
  assert.match(SF, /var ph = sfParseHash\(location\.hash\);[^\n]*\n\s*setTab\(ph \? ph\.tab : landingTab\(\), false, ph \? ph\.sub : 'all'\);/)
  assert.match(SF, /else if \(!push && location\.hash && location\.hash !== h\) history\.replaceState\(null, '', url\);/)
  assert.match(SF, /var h = sfHash\(tab, sub\[tab\]\), url = location\.pathname \+ location\.search \+ h;/, 'query string (utm) kept, hash replaced')
  assert.match(SF, /if \(t === 'bracelets' && s && sfIsGradSub\(s\)\) \{ t = 'gradient'; s = sfGradSub\(s\); \}/)
  assert.match(SF, /var cur = t === 'bracelets' && tab === 'gradient' \? \(sub\.gradient && sub\.gradient !== 'all' \? 'colour-' \+ sub\.gradient : 'colour'\) : sub\[t\];/)
  assert.match(SF, /var sb = tab === 'gradient' \? \$\('#klBSubs \[aria-selected="true"\]'\)/, 'the named chip is scrolled into view')
  assert.match(SF, /window\.addEventListener\('popstate', function \(\) \{ if \(!CFG\.families\) return; var ph = sfParseHash\(location\.hash\);/)
})

test('no separate chip: the chip bar has no gradient button; Bracelets is always shown and stands for the collection view', () => {
  const html = lay.sfBar(navDoc, ['bracelets', 'necklaces', 'gifts', 'gradient'], null, '').innerHTML
  assert.doesNotMatch(html, /kltab-gradient|data-tab="gradient"/)
  assert.deepEqual([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]), ['bracelets', 'necklaces', 'gifts', 'hair', 'rings'])
  for (const h of ['gradient', 'gradient-cobra', 'bracelets-beaded', 'bracelets-gradient', 'bracelets-colour', 'bracelets-colour-cobra']) {
    assert.equal(lay.sfDefTab(['necklaces', 'gradient'], h), 'gradient', h)
    assert.match(lay.sfBar(navDoc, ['necklaces', 'gradient'], null, h).innerHTML, /id="kltab-bracelets" data-tab="bracelets" aria-controls="klFam" aria-selected="true" tabindex="0">Bracelets /, h)
  }
  assert.deepEqual(core.sfVisibleTabs([], () => 'hidden', 0), ['bracelets', 'gradient'])
  assert.equal(lay.sfDefTab([], ''), 'bracelets', 'landing = Bracelets (All), which holds the collection cards')
  assert.equal(core.SF_TABS[core.SF_TABS.length - 1], 'gradient'); assert.deepEqual(lay.SFL_TABS, core.SF_TABS)
  assert.equal(core.sfPoolKey({ pools: { gradient: {}, 800: {} } }, true, 800), 'gradient', 'pool key = the server\'s, untouched')
})

test('chip label and card line: exactly the same words; no visible "Gradient"; "Beaded" only as the card meta', () => {
  const lbl = core.SF_SUBS.bracelets.filter((x) => /^colour/.test(x.k)).map((x) => x.label)
  assert.deepEqual(lbl, [CW, 'Classic', 'Cobra'])
  assert.match(HTML, new RegExp('<div class="sub kl-ged">' + CW + '</div>\\r?\\n\\s*<div class="sub"><span class="d" style="background:\\$\\{d\\.swatch\\}"></span>Beaded bracelet</div>'))
  assert.equal(HTML.match(/<div class="sub kl-ged">([^<]*)<\/div>/)[1], lbl[0], 'card line === chip label, byte for byte')
  assert.match(HTML, /\.cbody \.sub\.kl-ged\{display:none\}/)
  assert.match(CSS, /html\.kl-v2 \.cbody \.sub\.kl-ged\{display:block;[^}]*text-transform:none;/, 'shown with the chip\'s capitalisation (the card meta css upper-cases)')
  assert.match(CSS, /html\.kl-v2 #klGSubs\{display:none !important\}/, 'one Bracelets row: the in-panel style row is not shown')
  for (const s of core.SF_SUBS.bracelets) assert.ok(s.label.length <= 19, s.label)
  // every label the families view can show (chips, titles, styles, pre-paint rows) is free of both words
  const labels = [...Object.values(core.SF_SUBS).flat().map((x) => x.label), ...Object.values(core.SF_TITLE), ...Object.values(core.SF_CHIP),
    ...Object.values(lay.SFL_CHIP), ...lay.SFL_GSUBS.map((x) => x[1])]
  for (const l of labels) assert.doesNotMatch(l, /gradient|beaded/i, l)
  // every string literal in storefront.js + the page's layout block and card template: 'Gradient' only inside code
  // identifiers / ids / hashes / selectors (all lower case: '#bracelets-gradient...', 'gradient', '#klsub-...'), never as
  // a word a shopper reads; 'Beaded' only as the 'Beaded bracelet' card meta (the Gifts copy of a Gradient pick uses it too)
  const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  const CARD = HTML.match(/function card\(d,i\)\{[\s\S]*?\n\}/)[0]
  for (const [name, src] of [['storefront.js', SF], ['KL-SF-LAYOUT', LAYOUT], ['card()', CARD]]) {
    const strs = [...strip(src).matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0])
    for (const s of strs) {
      const vis = s.replace(/<[^>]*>/g, ' ').replace(/\$\{[^}]*\}/g, ' ')
      for (const w of vis.match(/[A-Za-z][\w-]*/g) || []) {
        if (/gradient/i.test(w)) assert.ok(w === w.toLowerCase() && !/\s/.test(w), `${name}: visible-looking "${w}" in ${s.slice(0, 80)}`)
      }
      // 'beaded' alone (lower case) = the old hash key kept as a redirect, not text
      if (/beaded/i.test(vis) && !/^'[a-z-]+'$/.test(s)) for (const m of vis.match(/beaded\s*[a-z]*/gi)) assert.equal(m, 'Beaded bracelet', `${name}: ${s.slice(0, 80)}`)
    }
  }
  assert.match(SF, /line: 'Beaded bracelet', swatch: d\.swatch,/, 'a Gradient gift pick reads like its card')
  assert.doesNotMatch(HTML, /<img id="heroImg"[^>]*alt="[^"]*beaded/i, 'hero alt: no Beaded')
})

test('Bracelets sub-chips: Colour, worn softly counts exactly the pieces on sale (Classic + Cobra); All = family + them', () => {
  assert.deepEqual(core.SF_SUBS.bracelets.map((x) => x.k), ['stretch', 'charm', 'bangle', 'double', 'sparkle', 'colour', 'colour-classic', 'colour-cobra'])
  const fam = CARDS.filter((c) => c.tab === 'bracelets').map((c) => ({ line: c.line, ok: true }))
  const grad = DATA.filter((d) => ['Lux Bracelet', 'Lux Cobra Bracelet'].includes(d.type)).map((d) => ({ line: d.type, ok: ON_SALE.includes(d.barcode), sub: gsub(d.type) }))
  for (const c of fam) assert.ok(!/^colour/.test(core.sfSubOf('bracelets', c.line) || ''), c.line)
  const v = Object.fromEntries(core.sfVisibleSubs('bracelets', fam.concat(grad)).map((x) => [x.k, x.n]))
  assert.equal(v.colour, 8); assert.equal(v['colour-classic'], 2); assert.equal(v['colour-cobra'], 6)
  assert.equal(v.all, fam.length + 8)
  const rows = fam.map((c, i) => ({ bc: 'F' + i, tab: 'bracelets', line: c.line, ok: true }))
    .concat(DATA.map((d) => ({ bc: d.barcode, tab: 'bracelets', line: d.type, sub: gsub(d.type), ok: ON_SALE.includes(d.barcode) })))
  const all = core.sfTabPick('bracelets', 'all', rows)
  for (const bc of ON_SALE) assert.ok(all.includes(bc), bc)
  assert.deepEqual(core.sfTabPick('bracelets', 'stretch', rows).filter((bc) => ON_SALE.includes(bc)), [])
  assert.match(SF, /return t === 'bracelets' \? fam\.concat\(gradItems\(\)\.map\(function \(x\) \{ return \{ line: x\.line, ok: x\.ok, sub: gradSubs\(x\.line\) \}; \}\)\) : fam;/)
  assert.match(SF, /function gradSubs\(type\) \{ var k = sfSubOf\('gradient', type\); return k \? \['colour', 'colour-' \+ k\] : \['colour'\]; \}/)
})

test('Bracelets > All = ONE grid (the page\'s own Gradient grid node moved in); the collection view = the Gradient panel as before', () => {
  assert.match(SF, /'<div id="klBGrid"><div class="grid" id="klFamGrid"><\/div><\/div>'/)
  assert.match(SF, /if \(gall && grid\.parentNode !== bw\) bw\.appendChild\(grid\); else if \(!gall && grid\.parentNode !== pal\) pal\.appendChild\(grid\);/)
  assert.match(SF, /pal\.hidden = !isG; \$\('\.swatchbar'\)\.hidden = !isG;/)
  assert.match(CSS, /html\.kl-v2\[data-kl-gall\] #klBGrid > \.grid\{display:contents\}/)
  assert.match(SF, /var swb = \$\('\.swatchbar'\), at = swb && swb\.parentNode === pal\.parentNode \? swb : pal;\s+pal\.parentNode\.insertBefore\(sec, at\);/)
  assert.match(SF, /else if \(Array\.isArray\(list\) && tab !== 'gradient'\) list = DATA;/)
  assert.match(SF, /if \(t\.matches\('#klFamGrid \[data-kl-add\]'\)\)/)
  assert.match(HTML, /<div class="grid" id="grid"><\/div>/)
})

test('sticky bar per tab unchanged: the collection view keeps the page bar (bundle builder); Bracelets keeps "Shop Bracelets"', () => {
  assert.equal(core.sfSticky('gradient', 800, 399, null, null), null)
  assert.equal(core.sfSticky('bracelets', 500, 399, null, null).btn, 'Shop Bracelets')
})
