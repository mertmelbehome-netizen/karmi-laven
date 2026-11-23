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
    assert.match(h, /^#[a-z]+-[a-z]+$/)
    assert.deepEqual(core.sfParseHash(h), { tab: t, sub: s.k }, 'round trip ' + h)
  }
})

test('sub-chips: only sub-categories with >= 1 sellable piece; fewer than 2 = no row; All first with the total', () => {
  const items = [{ line: 'Stretch Bracelet', ok: true }, { line: 'Stretch Bracelet', ok: true }, { line: 'Bangle', ok: true },
    { line: 'Stretch Double Bracelet', ok: false }, { line: 'Sparkle Line', ok: false }]
  const v = core.sfVisibleSubs('bracelets', items)
  assert.deepEqual(v.map((x) => x.k), ['all', 'stretch', 'bangle'], 'Stretch Double + Sparkle Line hidden (nothing sellable)')
  assert.deepEqual(v.map((x) => x.n), [3, 2, 1])
  assert.deepEqual(core.sfVisibleSubs('bracelets', [{ line: 'Bangle', ok: true }, { line: 'Stretch Bracelet', ok: false }]), [], 'one sub on sale = no row')
  assert.deepEqual(core.sfVisibleSubs('necklaces', [{ line: 'Bead Necklace', ok: true }]), [])
  // order as the owner listed it
  assert.deepEqual(core.SF_SUBS.bracelets.map((x) => x.label), ['Stretch', 'Stretch Charm', 'Bangle', 'Stretch Double', 'Sparkle Line'])
})

test('visible labels never say Lux / crystal / diamond / stone; the pre-paint Gradient row = SF_SUBS', () => {
  for (const t of Object.keys(core.SF_SUBS)) for (const s of core.SF_SUBS[t]) assert.doesNotMatch(s.label, BAD, s.label)
  for (const t of Object.keys(core.SF_SUBS)) assert.doesNotMatch(core.sfSubButtons(t, 'x').replace(/<[^>]*>/g, ' '), BAD)
  assert.deepEqual(lay.SFL_GSUBS.map((x) => x[1]), ['All'].concat(core.SF_SUBS.gradient.map((x) => x.label)))
  assert.deepEqual(lay.SFL_GSUBS.map((x) => x[0]), ['all'].concat(core.SF_SUBS.gradient.map((x) => x.k)))
  for (const x of lay.SFL_GSUBS) assert.doesNotMatch(x[1], BAD)
})

test('sub-chip markup: role=tab inside a tablist, ids per tab+sub, All selected by default, 44 px targets in css', () => {
  const h = core.sfSubButtons('bracelets', 'klFamGrid')
  assert.equal((h.match(/role="tab"/g) || []).length, 1 + core.SF_SUBS.bracelets.length)
  assert.match(h, /id="klsub-bracelets-all"[^>]*aria-selected="true" tabindex="0"/)
  assert.match(h, /id="klsub-bracelets-bangle"[^>]*aria-controls="klFamGrid" aria-selected="false" tabindex="-1"/)
  assert.match(SF, /id="klBSubs" role="tablist" aria-label="Bracelet styles"/)
  assert.match(HTML, /row\.setAttribute\('role', 'tablist'\); row\.setAttribute\('aria-label', 'Gradient styles'\)/)
  const CSS = read('../css/storefront.css')
  assert.match(CSS, /\.kl-sub\{[^}]*min-height:44px/)
  // the bracelet row is in the panel, never a sticky row; the Gradient row sits in the colour chip row (no new row)
  assert.doesNotMatch(CSS, /#klBSubs\{[^}]*sticky/)
  assert.match(HTML, /sbi\.insertBefore\(row, ch \? ch\.nextSibling : sbi\.firstChild\)/)
})

test('deep link + back/forward: start and popstate read #tab-sub; arrows stay inside their own row', () => {
  assert.match(SF, /var ph = sfParseHash\(location\.hash\);[^\n]*\n\s*setTab\(ph \? ph\.tab : 'gradient', false, ph \? ph\.sub : 'all'\);/)
  assert.match(SF, /addEventListener\('popstate', function \(\) \{ if \(!CFG\.families\) return; var ph = sfParseHash\(location\.hash\);/)
  assert.match(SF, /\$\$\('\[role=tab\]', e\.target\.closest\('\[role=tablist\]'\) \|\| document\)/)
  // pre-paint chip bar selects Bracelets for #bracelets-bangle
  assert.match(HTML, /sel = String\(sel \|\| ''\)\.split\('-'\)\[0\];/)
})
