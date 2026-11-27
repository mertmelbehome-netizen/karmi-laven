// Necklace groups (Komuta 27 Nov, owner: 'Necklaces 2 kategoriye böl stone, NL, NC ekle'). The Necklaces row = All +
// Drop Necklaces | Bead Chokers | Stone Necklaces (an empty group hidden, K-01; fewer than 2 groups on sale = no row);
// Necklaces > All groups its cards under small headings (.kl-gh, none above the first cards on phones, V-01); one row at
// 375 / 390 px, wraps on desktop. Group names live in ONE constant (js/storefront.js SF_SUBS.necklaces).
// Pure functions run as-is from js/storefront.js (KL-SF-CORE); the DOM / css wiring is pinned on its source lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_SUBS, SF_BLOCKS, SF_GROUPED, SF_TITLE, sfSubOf, sfInSub, sfParseHash, sfHash, sfVisibleSubs, sfSubButtons, sfBlockRows, sfTabPick };`)()
const CARDS = JSON.parse(read('../data/cards.json')).cards
const NECK = CARDS.filter((c) => c.tab === 'necklaces')
const N = core.SF_SUBS.necklaces
const it = (line, ok = true) => ({ line, ok })

test('one constant: Drop Necklaces | Bead Chokers | Stone Necklaces, neutral keys, a rename = one label', () => {
  assert.deepEqual(N.map((x) => x.k), ['drop', 'choker', 'stone'])
  assert.deepEqual(N.map((x) => x.label), ['Drop Necklaces', 'Bead Chokers', 'Stone Necklaces'])
  assert.deepEqual(N.map((x) => x.short), ['Drop', 'Chokers', 'Stone'])
  assert.equal(core.SF_GROUPED.necklaces, true)
  assert.ok(!core.SF_BLOCKS.necklaces, 'groups are SF_SUBS (the Rings row pattern), no second block system')
  for (const l of N.flatMap((x) => [x.label, x.short])) {
    assert.equal(SF.split("'" + l + "'").length - 1, 1, l + ' written once (SF_SUBS.necklaces)')
    assert.ok(!HTML.includes("'" + l + "'"), l + ' not repeated in index.html')
  }
  // customer wording: no Lux / crystal / diamond / Gradient / Steel; 'Stone' only as the Komuta group name
  for (const l of N.flatMap((x) => [x.label, x.short])) assert.doesNotMatch(l.replace(/^Stone( Necklaces)?$/, ''), /\blux\b|crystal|diamond|gradient|steel|\bstone\b/i, l)
})

test('map: every live necklace card sits in a group by its line; the Necklace Lux Stone family = Stone; Bead Necklace = Drop', () => {
  const want = { 6180: 'stone', 6170: 'stone', 6159: 'stone', 7058: 'drop', 7056: 'drop', 6095: 'drop', 6091: 'drop' }
  for (const [bc, k] of Object.entries(want)) {
    const c = NECK.find((x) => x.barcode === bc); if (!c) continue   // a card that left the feed is no longer pinned
    assert.equal(core.sfSubOf('necklaces', c.line), k, bc + ' ' + c.line)
  }
  for (const c of NECK) assert.ok(core.sfSubOf('necklaces', c.line), c.barcode + ' ' + c.line + ' lands in a group (nothing only under All)')
  for (const c of NECK.filter((x) => x.family === 'Necklace Lux Stone')) assert.equal(core.sfSubOf('necklaces', c.line), 'stone', c.barcode)
  // chokers: no live product yet; the line name is not known, so any line with the word choker(s) lands there, before Stone
  for (const l of ['Bead Choker', 'Choker Necklace', 'Chip Bead Choker', 'Bead Chokers']) assert.equal(core.sfSubOf('necklaces', l), 'choker', l)
  for (const l of ['Necklace', 'Pendant Necklace', 'Bead Necklace Set', '']) assert.equal(core.sfSubOf('necklaces', l), null, l)
  assert.equal(core.sfSubOf('bracelets', 'Bead Necklace'), null, 'a necklace line never lands in a bracelet line')
})

test('heading rule: one shared motif = the motif name, else the general name (27 Nov: daisy + starfish -> Drop Necklaces)', () => {
  const MOTIF = /\b(daisy|starfish|heart|butterfly|moon|star|flower|shell)\b/i
  for (const g of N) {
    const cs = NECK.filter((c) => core.sfSubOf('necklaces', c.line) === g.k)
    if (!cs.length) continue
    const ms = cs.map((c) => (c.name.match(MOTIF) || [''])[0].toLowerCase())
    const one = ms[0] && ms.every((m) => m === ms[0])
    if (one) assert.match(g.label, new RegExp('^' + ms[0] + ' ', 'i'), g.k + ': every piece is ' + ms[0] + ', the heading says so')
    else assert.doesNotMatch(g.label, MOTIF, g.k + ': mixed motifs (' + [...new Set(ms)].join(', ') + ') -> the general name')
  }
})

test('hashes: #necklaces = All; #necklaces-drop / -choker / -stone round-trip; unknown -> All; other tabs unchanged', () => {
  assert.deepEqual(core.sfParseHash('#necklaces'), { tab: 'necklaces', sub: 'all' })
  for (const k of ['drop', 'choker', 'stone']) {
    assert.equal(core.sfHash('necklaces', k), '#necklaces-' + k)
    assert.deepEqual(core.sfParseHash('#necklaces-' + k), { tab: 'necklaces', sub: k })
  }
  assert.equal(core.sfHash('necklaces', 'all'), '#necklaces')
  assert.deepEqual(core.sfParseHash('#necklaces-nope'), { tab: 'necklaces', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#NECKLACES-Drop'), { tab: 'necklaces', sub: 'drop' })
  assert.equal(core.sfHash('necklaces', 'bangle'), '#necklaces', 'a bracelet key never makes a necklace URL')
  assert.deepEqual(core.sfParseHash('#bracelets-stretch-all'), { tab: 'bracelets', sub: 'stretch-all' })
  assert.deepEqual(core.sfParseHash('#rings-steel-chunky'), { tab: 'rings', sub: 'steel-chunky' })
  // the start / back-forward path keeps the sub (setTab writes sub[t] only for tabs listed in the sub state)
  assert.match(SF, /var sub = \{ gradient: 'all', bracelets: 'all', rings: 'all', necklaces: 'all' \}/)
})

test('counts: live cards on sale -> All 7 | Drop 4 | Stone 3; Chokers (nothing on sale) hidden', () => {
  const v = core.sfVisibleSubs('necklaces', NECK.map((c) => it(c.line)))
  const n = (k) => NECK.filter((c) => core.sfSubOf('necklaces', c.line) === k).length
  assert.deepEqual(v.map((x) => x.k + ':' + x.n), ['all:' + NECK.length].concat(['drop', 'stone'].filter((k) => n(k)).map((k) => k + ':' + n(k))))
  if (NECK.length === 7) assert.deepEqual(v.map((x) => x.k + ':' + x.n), ['all:7', 'drop:4', 'stone:3'])
  assert.equal(v.reduce((a, x) => a + (x.k === 'all' ? 0 : x.n), 0), v[0].n, 'every piece on sale sits in one group')
  // the hero / sticky 'from' price follows the open group
  const rows = NECK.map((c) => ({ bc: c.barcode, tab: 'necklaces', line: c.line, ok: true }))
  assert.deepEqual(core.sfTabPick('necklaces', 'drop', rows).sort(), NECK.filter((c) => /^bead necklace$/i.test(c.line)).map((c) => c.barcode).sort())
  assert.equal(core.sfTabPick('necklaces', 'all', rows).length, NECK.length)
})

test('an empty group is hidden (K-01); fewer than 2 groups on sale = no row', () => {
  assert.deepEqual(core.sfVisibleSubs('necklaces', [it('Bead Necklace'), it('Bead Choker'), it('Charm Necklace', false)]).map((x) => x.k + ':' + x.n), ['all:2', 'drop:1', 'choker:1'])
  assert.deepEqual(core.sfVisibleSubs('necklaces', [it('Bead Necklace'), it('Bead Necklace'), it('Charm Necklace', false)]), [], 'one group on sale = no row')
  assert.deepEqual(core.sfVisibleSubs('necklaces', [it('Bead Necklace'), it('Necklace')]), [], 'a piece in no group does not make a 2nd chip')
  assert.deepEqual(core.sfVisibleSubs('necklaces', []), [])
  // renderTabs: the row is the Rings pattern (renderSubs hides a row with no subs; a hidden sub falls back to All); off outside Necklaces
  assert.match(SF, /var nsr = \$\('#klNSubs'\); renderSubs\('necklaces', nsr\); if \(nsr && tab !== 'necklaces'\) nsr\.hidden = true;/)
  assert.match(SF, /row\.hidden = !\(vb \|\| vs\)\.length;/)
  assert.match(SF, /if \(keys\.indexOf\(sub\[t\]\) < 0\) sub\[t\] = 'all';/)
})

test('grid: Necklaces > All groups cards under .kl-gh headings (first one hidden on phones); an open group = no heading', () => {
  const x = (line, id) => ({ c: { line, id }, s: 'sellable' })
  const list = [x('Charm Necklace', 1), x('Bead Necklace', 2), x('Chip Bead Necklace', 3), x('Bead Necklace', 4)]
  const r = core.sfBlockRows('necklaces', 'all', list)
  assert.deepEqual(r.map((y) => y.h ? 'h:' + y.h + (y.first ? '*' : '') : y.x.c.id), ['h:Drop Necklaces*', 2, 4, 'h:Stone Necklaces', 1, 3])
  assert.deepEqual(core.sfBlockRows('necklaces', 'all', [x('Bead Necklace', 1), x('Bead Necklace', 2)]).map((y) => y.h || y.x.c.id), [1, 2], 'one group = no heading')
  assert.deepEqual(core.sfBlockRows('necklaces', 'drop', [x('Bead Necklace', 1)]).map((y) => y.h || y.x.c.id), [1], 'an open group = no heading')
  // a piece in no group: last, under the tab title (never under another group's heading)
  assert.deepEqual(core.sfBlockRows('necklaces', 'all', [x('Pendant Necklace', 9), x('Bead Necklace', 1), x('Bead Choker', 5)]).map((y) => y.h ? 'h:' + y.h : y.x.c.id),
    ['h:Drop Necklaces', 1, 'h:Bead Chokers', 5, 'h:Necklaces', 9])
  // other tabs' All unchanged (Bracelets > All = one flat grid, Rings flat)
  assert.deepEqual(core.sfBlockRows('bracelets', 'all', [x('Bangle', 1), x('Stretch Bracelet', 2)]).map((y) => y.h || y.x.c.id), [1, 2])
  assert.deepEqual(core.sfBlockRows('rings', 'all', [x('Charm Ring', 1), x('Chip Ring', 2)]).map((y) => y.h || y.x.c.id), [1, 2])
  assert.match(SF, /g\.innerHTML = sfBlockRows\(tab, sk, list\)\.map\(function \(r\) \{ return r\.h \? '<h3 class="kl-gh' \+ \(r\.first \? ' kl-gh0' : ''\) \+ '">'/)
  const phone = CSS.match(/@media\(max-width:620px\)\{([\s\S]*?)\n\}/)[1]
  assert.match(phone, /\.kl-fam \.grid > \.kl-gh\.kl-gh0\{display:none\}/)
  // panel title: the group name alone ('Drop Necklaces', not 'Necklaces · Drop Necklaces'); Bracelets keep 'Bracelets · Stretch'
  assert.match(SF, /\$\('#klFamTitle'\)\.textContent = sl && SF_GROUPED\[tab\] \? sl\.label : SF_TITLE\[tab\] \+ \(sl \? ' · ' \+ sl\.label : ''\);/)
})

test('markup: Necklace styles tablist, role=tab, full name on desktop + short name on phones; Rings row unchanged', () => {
  const h = core.sfSubButtons('necklaces', 'klFamGrid')
  assert.equal((h.match(/role="tab"/g) || []).length, 1 + N.length)
  assert.match(h, /id="klsub-necklaces-all"[^>]*data-sub="all"[^>]*aria-selected="true" tabindex="0">All <span class="n"><\/span><\/button>/)
  assert.match(h, /id="klsub-necklaces-drop" data-subtab="necklaces" data-sub="drop" aria-controls="klFamGrid" aria-selected="false" tabindex="-1"><span class="kl-bt"><span class="kl-bl">Drop Necklaces<\/span><span class="kl-bs">Drop<\/span> <span class="n"><\/span><\/span><\/button>/)
  assert.doesNotMatch(core.sfSubButtons('rings', 'x'), /kl-bt|kl-bs/, 'rings: one label, markup as before')
  assert.match(SF, /id="klNSubs" role="tablist" aria-label="Necklace styles" hidden>' \+ sfSubButtons\('necklaces', 'klFamGrid'\)/)
  assert.match(CSS, /\.kl-sub \.kl-bs\{display:none\}/, 'desktop: the full name')
})

test('phone (<= 620 px): ONE row, no sideways scroll, every short name fits its button at 375 and 390 px; desktop wraps', () => {
  assert.match(CSS, /html\.kl-v2 #klNSubs\{flex-wrap:wrap; overflow:visible;/, 'desktop: wraps, never scrolls')
  const phones = [...CSS.matchAll(/@media\(max-width:620px\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
  const row = phones.match(/html\.kl-v2 #klNSubs\{([^}]*)\}/)[1]
  const btn = phones.match(/html\.kl-v2 #klNSubs \.kl-sub\{([^}]*)\}/)[1]
  assert.match(row, /flex-wrap:nowrap/); assert.doesNotMatch(row, /overflow-x:auto|overflow:auto|overflow:scroll/)
  assert.match(btn, /flex:1 1 0;/); assert.match(btn, /min-width:0;/); assert.match(btn, /white-space:normal;/)
  assert.match(CSS, /@media\(max-width:560px\)\{\r?\n {2}html\.kl-v2 #klNSubs\{margin:0 -16px 8px; padding:0 16px\}/, 'phone gutter 16 px (row width = screen - 32)')
  assert.match(CSS, /\.kl-sub \.kl-bl\{display:none\}/); assert.match(CSS, /\.kl-sub \.kl-bs\{display:inline\}/)
  assert.doesNotMatch(CSS, /#klNSubs\{[^}]*sticky/)
  // the width sum, worst case = All + every group on sale; text box = (screen - 32 - gaps) / buttons - 2 x padding - 2 x border
  const px = Number(btn.match(/font-size:(\d+)px/)[1]), pad = Number(btn.match(/padding:0 (\d+)px/)[1]), gap = Number(row.match(/gap:(\d+)px/)[1])
  const lh = Number(btn.match(/line-height:([\d.]+)/)[1]), k = 1 + N.length
  const EM = 0.6   // per glyph, above Jost's ~0.5 em average (bold selected state + wide glyphs)
  const w = (s) => s.length * EM * px
  const lines = (words, box) => {
    let n = 1, cur = ''
    for (const wd of words) {
      if (w(wd) > box) return null
      const t = cur ? cur + ' ' + wd : wd
      if (w(t) <= box) cur = t; else { n++; cur = wd }
    }
    return n
  }
  for (const screen of [375, 390]) {
    const box = (screen - 32 - (k - 1) * gap) / k - 2 * pad - 2
    for (const s of ['All'].concat(N.map((x) => x.short))) {
      const n = lines((s + ' 199').split(' '), box)   // a 3-digit count, worst case
      assert.ok(n !== null, `${screen}: '${s}' has a word wider than ${box.toFixed(1)} px`)
      assert.ok(n * px * lh <= 44, `${screen}: '${s}' needs ${n} lines, more than the 44 px button`)
    }
  }
  assert.ok(px >= 12, 'site minimum 12 px')
  assert.ok(k <= 4, 'at most 4 buttons in the phone row')
})
