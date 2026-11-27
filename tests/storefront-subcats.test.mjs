// Bracelet + Gradient sub-categories (owner 23 Nov: each sub-category its own sub-tab with its own URL).
// The pure functions run as-is from js/storefront.js (KL-SF-CORE block) and index.html (KL-SF-LAYOUT block).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, SF_SUBS, sfSubOf, sfParseHash, sfHash, sfVisibleSubs, sfSubButtons };`)()
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const lay = new Function(`${LAYOUT}; return { SFL_GSUBS };`)()
const CARDS = JSON.parse(read('../data/cards.json')).cards
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const LADDER = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\])/)[1].replace(/'/g, '"'))
const BAD = /\blux\b|crystal|diamond|\bstone\b/i
// K-069 ring style labels given by the lead (look words, no material claim); the only 'stone' exception (K&D to confirm)
const RING_LOOK = new Set(['Stone Chip', 'Raw Stone Look'])
const bad = (t, label) => !(t === 'rings' && RING_LOOK.has(label)) && BAD.test(label)

test('sub-category from the product line: every bracelet card maps; 0624 (family Stretch Double) is a Stretch Bracelet', () => {
  const want = { 'Stretch Bracelet': 'stretch', 'Cube Bead Stretch Bracelet': 'stretch', 'Stretch Charm Bracelet': 'charm', Bangle: 'bangle', 'Stretch Double Bracelet': 'double', 'Sparkle Line': 'sparkle' }
  for (const c of CARDS.filter((x) => x.tab === 'bracelets')) assert.equal(core.sfSubOf('bracelets', c.line), want[c.line], c.barcode + ' ' + c.line)
  assert.equal(core.sfSubOf('bracelets', CARDS.find((c) => c.barcode === '0624').line), 'stretch')
  assert.equal(core.sfSubOf('bracelets', 'Charm Necklace'), null)
  assert.equal(core.sfSubOf('necklaces', 'Bead Necklace'), null, 'no sub-row outside Bracelets / Gradient')
})

test('Gradient Edit: the two DB types split cleanly into Gradient / Gradient Cobra; every Gradient piece maps', () => {
  const types = [...new Set(DATA.map((d) => d.type))]
  assert.deepEqual(types.sort(), [...LADDER].sort())
  for (const d of DATA) assert.equal(core.sfSubOf('gradient', d.type), /cobra/i.test(d.type) ? 'cobra' : 'classic', d.barcode)
  const n = (k) => DATA.filter((d) => core.sfSubOf('gradient', d.type) === k).length
  assert.ok(n('classic') > 0 && n('cobra') > 0)
  assert.equal(n('classic') + n('cobra'), DATA.length)
})

test('hash routing: #tab-sub (ASCII, hyphen); All is the bare tab hash; unknown sub -> All; unknown tab -> none', () => {
  assert.deepEqual(core.sfParseHash('#bracelets-bangle'), { tab: 'bracelets', sub: 'bangle' })
  assert.deepEqual(core.sfParseHash('#bracelets-charm'), { tab: 'bracelets', sub: 'charm' })
  assert.deepEqual(core.sfParseHash('#bracelets'), { tab: 'bracelets', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#gradient-cobra'), { tab: 'gradient', sub: 'cobra' })
  assert.deepEqual(core.sfParseHash('#bracelets-nope'), { tab: 'bracelets', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#necklaces'), { tab: 'necklaces', sub: 'all' })
  assert.equal(core.sfParseHash('#palette'), null)
  assert.equal(core.sfParseHash(''), null)
  assert.equal(core.sfHash('bracelets', 'bangle'), '#bracelets-bangle')
  assert.equal(core.sfHash('bracelets', 'all'), '#bracelets')
  assert.equal(core.sfHash('necklaces', 'bangle'), '#necklaces')
  for (const t of Object.keys(core.SF_SUBS)) for (const s of core.SF_SUBS[t]) {
    const h = core.sfHash(t, s.k)
    assert.match(h, /^#[a-z]+-[a-z]+(-[a-z]+)?$/)
    // Bracelets > Colour, worn softly (-Classic / -Cobra) is the Gradient Edit view (26 Nov 2026): its URL opens tab 'gradient'
    const g = t === 'bracelets' && s.k.indexOf('colour') === 0 ? { tab: 'gradient', sub: s.k === 'colour' ? 'all' : s.k.slice(7) } : null
    const want = g || (t === 'gradient' ? { tab: 'gradient', sub: s.k } : { tab: t, sub: s.k })
    assert.deepEqual(core.sfParseHash(h), want, 'round trip ' + h)
  }
  // the Gradient Edit view's own URL + the old links (#gradient, #gradient-<sub>, #bracelets-beaded) keep landing on the same cards
  assert.equal(core.sfHash('gradient', 'all'), '#bracelets-colour')
  assert.equal(core.sfHash('gradient', 'cobra'), '#bracelets-colour-cobra')
  assert.deepEqual(core.sfParseHash('#bracelets-beaded'), { tab: 'gradient', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#gradient'), { tab: 'gradient', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#gradient-classic'), { tab: 'gradient', sub: 'classic' })
  assert.deepEqual(core.sfParseHash('#gradient-x'), { tab: 'gradient', sub: 'all' })
})

test('sub-chips: only sub-categories with >= 1 sellable piece; fewer than 2 = no row; All first with the total', () => {
  const items = [{ line: 'Stretch Bracelet', ok: true }, { line: 'Stretch Bracelet', ok: true }, { line: 'Bangle', ok: true },
    { line: 'Stretch Double Bracelet', ok: false }, { line: 'Sparkle Line', ok: false }]
  const v = core.sfVisibleSubs('bracelets', items)
  assert.deepEqual(v.map((x) => x.k), ['all', 'stretch', 'bangle'], 'Stretch Double + Sparkle Line hidden (nothing sellable)')
  assert.deepEqual(v.map((x) => x.n), [3, 2, 1])
  assert.deepEqual(core.sfVisibleSubs('bracelets', [{ line: 'Bangle', ok: true }, { line: 'Stretch Bracelet', ok: false }]), [], 'one sub on sale = no row')
  assert.deepEqual(core.sfVisibleSubs('necklaces', [{ line: 'Bead Necklace', ok: true }]), [])
  // order as the owner listed it; the collection last as 'Colour, worn softly' + its two styles (Komuta 26 Nov 2026, D-002)
  assert.deepEqual(core.SF_SUBS.bracelets.map((x) => x.label), ['Stretch', 'Stretch Charm', 'Bangle', 'Stretch Double', 'Sparkle Line', 'Colour, worn softly', 'Classic', 'Cobra'])
  // the Gradient chips are never reached by a product line (no family bracelet can land there), only by the Gradient items' own subs
  for (const l of ['Stretch Bracelet', 'Lux Bracelet', 'Lux Cobra Bracelet', 'Charm Bracelet', 'Gradient', 'Beaded', 'Colour', '']) assert.ok(!/^colour/.test(core.sfSubOf('bracelets', l) || ''), l)
  const gs = ['colour', 'colour-cobra']
  const g = core.sfVisibleSubs('bracelets', items.concat([{ line: 'x', ok: true, sub: gs }, { line: 'x', ok: true, sub: gs }, { line: 'x', ok: false, sub: gs }]))
  assert.deepEqual(g.map((x) => x.k + ':' + x.n), ['all:5', 'stretch:2', 'bangle:1', 'colour:2', 'colour-cobra:2'])
})

test('visible labels never say Lux / crystal / diamond / stone; the pre-paint Gradient row = SF_SUBS', () => {
  for (const t of Object.keys(core.SF_SUBS)) for (const s of core.SF_SUBS[t]) assert.ok(!bad(t, s.label), s.label)
  for (const t of Object.keys(core.SF_SUBS)) assert.doesNotMatch(core.sfSubButtons(t, 'x').replace(/<[^>]*>/g, ' ').replace(/Raw Stone Look|Stone Chip/g, t === 'rings' ? '' : '$&'), BAD)
  for (const s of core.SF_SUBS.rings) assert.doesNotMatch(s.label, /stainless|zircon|crystal|gemstone|natural|genuine|real/i, s.label)
  assert.deepEqual(lay.SFL_GSUBS.map((x) => x[1]), ['All'].concat(core.SF_SUBS.gradient.map((x) => x.label)))
  assert.deepEqual(lay.SFL_GSUBS.map((x) => x[0]), ['all'].concat(core.SF_SUBS.gradient.map((x) => x.k)))
  for (const x of lay.SFL_GSUBS) assert.doesNotMatch(x[1], BAD)
})

test('sub-chip markup: role=tab inside a tablist, ids per tab+sub, All selected by default, 44 px targets in css', () => {
  // 27 Nov: the Bracelets row is built from SF_BLOCKS (tests/bracelet-blocks.test.mjs); sfSubButtons builds the Rings row
  const h = core.sfSubButtons('rings', 'klFamGrid')
  assert.equal((h.match(/role="tab"/g) || []).length, 1 + core.SF_SUBS.rings.length)
  assert.match(h, /id="klsub-rings-all"[^>]*aria-selected="true" tabindex="0"/)
  assert.match(h, /id="klsub-rings-charm"[^>]*aria-controls="klFamGrid" aria-selected="false" tabindex="-1"/)
  assert.match(SF, /id="klBSubs" role="tablist" aria-label="Bracelet styles"/)
  assert.match(SF, /id="klRSubs" role="tablist" aria-label="Ring styles" hidden>' \+ sfSubButtons\('rings', 'klFamGrid'\)/)
  assert.match(HTML, /row\.setAttribute\('role', 'tablist'\); row\.setAttribute\('aria-label', 'Styles'\)/)
  const CSS = read('../css/storefront.css')
  assert.match(CSS, /\.kl-sub\{[^}]*min-height:44px/)
  // the bracelet row is in the panel, never a sticky row; the Gradient row sits in the colour chip row (no new row)
  assert.doesNotMatch(CSS, /#klBSubs\{[^}]*sticky/)
  assert.match(HTML, /sbi\.insertBefore\(row, ch \? ch\.nextSibling : sbi\.firstChild\)/)
})

test('deep link + back/forward: start and popstate read #tab-sub; arrows stay inside their own row', () => {
  assert.match(SF, /var ph = sfParseHash\(location\.hash\);[^\n]*\n\s*setTab\(ph \? ph\.tab : landingTab\(\), false, ph \? ph\.sub : 'all'\);/)
  assert.match(SF, /addEventListener\('popstate', function \(\) \{ if \(!CFG\.families\) return; var ph = sfParseHash\(location\.hash\);/)
  assert.match(SF, /\$\$\('\[role=tab\]', e\.target\.closest\('\[role=tablist\]'\) \|\| document\)/)
  // pre-paint chip bar selects Bracelets for #bracelets-bangle
  assert.match(HTML, /h = h\.split\('-'\)\[0\];/)
  const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
  const def = new Function(`${LAYOUT}; return sfDefTab;`)()
  assert.equal(def(['bracelets', 'gradient'], 'bracelets-bangle'), 'bracelets')
  // owner 26 Nov 2026: no hash = Bracelets (All) when shown, else the Gradient Edit; a hidden / unknown tab = the landing tab
  assert.equal(def(['bracelets', 'necklaces', 'gradient'], ''), 'bracelets')
  assert.equal(def(['necklaces', 'gradient'], ''), 'bracelets', '26 Nov 2026: Bracelets always shown (it holds the Gradient Edit)')
  assert.equal(def(['bracelets', 'gradient'], 'hair'), 'bracelets')
  assert.equal(def(['bracelets', 'gradient'], 'gradient-cobra'), 'gradient')
})
