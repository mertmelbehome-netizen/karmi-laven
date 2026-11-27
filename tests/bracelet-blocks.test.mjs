// Bracelet blocks (Komuta 27 Nov, owner: 'kategori butonları kötü; bileklikleri gerekiyorsa üst başlıkta ayır'; option A
// + C on desktop). The Bracelets row = All + 3 blocks (Stretch | Colour | Bangle & Sparkle), one line at 375 / 390 px;
// a block's cards grouped by line under small headings (none above the first cards on phones, V-01); desktop shows the
// open block's lines in a 2nd row. Labels and block -> lines live in ONE constant (js/storefront.js SF_BLOCKS).
// Pure functions run as-is from js/storefront.js (KL-SF-CORE); the DOM / css wiring is pinned on its source lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_SUBS, SF_BLOCKS, sfBlock, sfBlockOf, sfSubOf, sfInSub, sfParseHash, sfHash, sfVisibleSubs, sfVisibleBlocks, sfBlockButtons, sfLineButtons, sfBlockRows, sfTabPick };`)()
const CARDS = JSON.parse(read('../data/cards.json')).cards
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const ON_SALE = ['1266', '1267', '1268', '1269', '1271', '1272', '1302', '1310']   // live 26 Nov (as tests/gradient-in-bracelets)
const gsub = (t) => ['colour', 'colour-' + core.sfSubOf('gradient', t)]   // = storefront gradSubs
const B = core.SF_BLOCKS.bracelets
const famIt = CARDS.filter((c) => c.tab === 'bracelets').map((c) => ({ line: c.line, ok: true }))
const gradIt = DATA.filter((d) => ['Lux Bracelet', 'Lux Cobra Bracelet'].includes(d.type)).map((d) => ({ line: d.type, ok: ON_SALE.includes(d.barcode), sub: gsub(d.type) }))

test('one constant: All | Stretch | Colour | Bangle & Sparkle; every bracelet line in exactly one block', () => {
  assert.deepEqual(B.map((b) => b.k), ['stretch-all', 'colour', 'bangle-sparkle'])
  assert.deepEqual(B.map((b) => b.short), ['Stretch', 'Colour', 'Bangle & Sparkle'])
  assert.deepEqual(B.map((b) => b.label), ['Stretch', 'Colour, worn softly', 'Bangle & Sparkle'])
  assert.deepEqual(B.map((b) => b.subs), [['stretch', 'charm', 'double'], ['colour-classic', 'colour-cobra'], ['bangle', 'sparkle']])
  const lineKeys = core.SF_SUBS.bracelets.map((x) => x.k)
  for (const k of lineKeys) {
    const n = B.filter((b) => b.k === k || b.subs.includes(k)).length
    assert.equal(n, 1, k + ' sits in one block')
  }
  for (const b of B) for (const s of b.subs) assert.ok(lineKeys.includes(s), s + ' is a SF_SUBS line')
  // no block key collides with a line key except 'colour' (= the Gradient Edit view, its hash unchanged)
  for (const b of B) assert.ok(!lineKeys.includes(b.k) || b.k === 'colour', b.k)
  // every bracelet card's line lands in a block (nothing only under All)
  for (const c of CARDS.filter((x) => x.tab === 'bracelets')) assert.ok(core.sfBlockOf('bracelets', core.sfSubOf('bracelets', c.line)), c.barcode + ' ' + c.line)
  // a rename = one place: each block label is written once in storefront.js (no copy elsewhere in the file / page)
  for (const l of new Set(B.flatMap((b) => [b.label, b.short]))) {
    // 'Stretch' is also the Stretch line label (SF_SUBS); 'Colour, worn softly' is the collection's brand line (footer,
    // card meta, the Colour line label): both are other constants, not copies of the chip
    if (l === 'Stretch' || l === 'Colour, worn softly') continue
    const n = SF.split("'" + l + "'").length - 1
    assert.equal(n, l === 'Bangle & Sparkle' ? 2 : 1, l + ' (label + short in the SF_BLOCKS row only)')
    assert.ok(!HTML.includes("'" + l + "'"), l + ' not repeated in index.html')
  }
  // D-002 + the K-08 wording rules; no Steel / Necklaces split in this PR
  for (const b of B) for (const l of [b.label, b.short]) assert.doesNotMatch(l, /gradient|beaded|lux|crystal|diamond|\bstone\b|steel/i, l)
  assert.ok(!core.SF_BLOCKS.necklaces && !core.SF_BLOCKS.rings, 'blocks: Bracelets only')
})

test('hashes: new block links round-trip; old line links keep their meaning; colour = the Gradient Edit view', () => {
  assert.deepEqual(core.sfParseHash('#bracelets-stretch-all'), { tab: 'bracelets', sub: 'stretch-all' })
  assert.deepEqual(core.sfParseHash('#bracelets-bangle-sparkle'), { tab: 'bracelets', sub: 'bangle-sparkle' })
  assert.equal(core.sfHash('bracelets', 'stretch-all'), '#bracelets-stretch-all')
  assert.equal(core.sfHash('bracelets', 'bangle-sparkle'), '#bracelets-bangle-sparkle')
  for (const b of B.filter((x) => x.k !== 'colour')) assert.deepEqual(core.sfParseHash(core.sfHash('bracelets', b.k)), { tab: 'bracelets', sub: b.k })
  // old: '#bracelets-stretch' = the Stretch Bracelet line ONLY (not the block); its block chip shows selected
  assert.deepEqual(core.sfParseHash('#bracelets-stretch'), { tab: 'bracelets', sub: 'stretch' })
  assert.equal(core.sfBlockOf('bracelets', 'stretch').k, 'stretch-all')
  assert.equal(core.sfInSub('bracelets', { line: 'Stretch Charm Bracelet' }, 'stretch'), false)
  assert.equal(core.sfInSub('bracelets', { line: 'Stretch Charm Bracelet' }, 'stretch-all'), true)
  for (const [h, sub, blk] of [['#bracelets-charm', 'charm', 'stretch-all'], ['#bracelets-double', 'double', 'stretch-all'],
    ['#bracelets-bangle', 'bangle', 'bangle-sparkle'], ['#bracelets-sparkle', 'sparkle', 'bangle-sparkle']]) {
    assert.deepEqual(core.sfParseHash(h), { tab: 'bracelets', sub }, h)
    assert.equal(core.sfHash('bracelets', sub), h, h + ' written back unchanged')
    assert.equal(core.sfBlockOf('bracelets', sub).k, blk, h)
  }
  for (const [h, sub] of [['#bracelets-colour', 'all'], ['#bracelets-colour-cobra', 'cobra'], ['#bracelets-colour-classic', 'classic'],
    ['#gradient', 'all'], ['#gradient-cobra', 'cobra'], ['#bracelets-beaded', 'all']]) assert.deepEqual(core.sfParseHash(h), { tab: 'gradient', sub }, h)
  assert.deepEqual(core.sfParseHash('#bracelets'), { tab: 'bracelets', sub: 'all' })
  assert.deepEqual(core.sfParseHash('#bracelets-stretch-nope'), { tab: 'bracelets', sub: 'all' })
  // the Colour block chip goes through setTab's Gradient guard (sfIsGradSub('colour')), so the #grid / gall logic is unchanged
  assert.match(SF, /if \(t === 'bracelets' && s && sfIsGradSub\(s\)\) \{ t = 'gradient'; s = sfGradSub\(s\); \}/)
  assert.match(SF, /gall = tab === 'bracelets' && sub\.bracelets === 'all'/)
})

test('block counts = the union of their lines; All = every piece on sale; the from-price pick follows the block', () => {
  const items = famIt.concat(gradIt)
  const v = core.sfVisibleBlocks('bracelets', items), by = Object.fromEntries(v.map((x) => [x.k, x]))
  const line = Object.fromEntries(core.sfVisibleSubs('bracelets', items).map((x) => [x.k, x.n]))
  assert.deepEqual(v.map((x) => x.k), ['all', 'stretch-all', 'colour', 'bangle-sparkle'])
  assert.equal(by['stretch-all'].n, (line.stretch || 0) + (line.charm || 0) + (line.double || 0))
  assert.equal(by['bangle-sparkle'].n, (line.bangle || 0) + (line.sparkle || 0))
  assert.equal(by.colour.n, 8); assert.deepEqual(by.colour.subs.map((s) => s.k + ':' + s.n), ['colour-classic:2', 'colour-cobra:6'])
  assert.equal(by.all.n, famIt.length + 8)
  assert.equal(by['stretch-all'].n + by.colour.n + by['bangle-sparkle'].n, by.all.n, 'every piece on sale sits in one block')
  assert.deepEqual(by['bangle-sparkle'].subs.map((s) => s.label), ['Bangle', 'Sparkle Line'])
  // sfTabPick (hero / sticky 'from' price): a block = the union of its lines' picks
  const rows = CARDS.filter((c) => c.tab === 'bracelets').map((c) => ({ bc: c.barcode, tab: 'bracelets', line: c.line, ok: true }))
    .concat(DATA.map((d) => ({ bc: d.barcode, tab: 'bracelets', line: d.type, sub: gsub(d.type), ok: ON_SALE.includes(d.barcode) })))
  for (const b of B) {
    const u = b.subs.flatMap((s) => core.sfTabPick('bracelets', s, rows))
    assert.deepEqual(core.sfTabPick('bracelets', b.k, rows).sort(), [...new Set(u)].sort(), b.k)
  }
  assert.deepEqual(core.sfTabPick('bracelets', 'stretch-all', rows).filter((bc) => ON_SALE.includes(bc)), [], 'no Gradient piece in Stretch')
})

test('a block with nothing on sale is hidden (K-01), its empty lines too; fewer than 2 blocks = no row', () => {
  const it = (line, ok = true) => ({ line, ok })
  const v = core.sfVisibleBlocks('bracelets', [it('Stretch Bracelet'), it('Bangle'), it('Sparkle Line', false), it('Stretch Double Bracelet', false)])
  assert.deepEqual(v.map((x) => x.k + ':' + x.n), ['all:2', 'stretch-all:1', 'bangle-sparkle:1'], 'Colour hidden (nothing on sale)')
  assert.deepEqual(v[1].subs.map((s) => s.k), ['stretch'], 'Stretch Charm / Double hidden inside the block')
  assert.deepEqual(core.sfVisibleBlocks('bracelets', [it('Bangle'), it('Sparkle Line'), it('Stretch Bracelet', false)]), [], 'one block on sale = no row')
  assert.deepEqual(core.sfVisibleBlocks('bracelets', []), [])
  assert.deepEqual(core.sfVisibleBlocks('rings', [it('Charm Ring')]), [], 'no blocks outside Bracelets')
  // renderSubs: the Bracelets row is the block row; a sub not shown falls back to All; the line row needs >= 2 lines
  assert.match(SF, /var vb = SF_BLOCKS\[t\] \? sfVisibleBlocks\(t, items\) : null;/)
  assert.match(SF, /if \(keys\.indexOf\(sub\[t\]\) < 0\) sub\[t\] = 'all';/)
  assert.match(SF, /var show = !row\.hidden && !!bx && bx\.subs\.length >= 2;/)
})

test('grid: a block groups its cards by line under small .kl-gh headings, never one above the first cards on phones', () => {
  const x = (line, id) => ({ c: { line, id }, s: 'sellable' })
  const list = [x('Stretch Charm Bracelet', 1), x('Stretch Bracelet', 2), x('Cube Bead Stretch Bracelet', 3), x('Stretch Charm Bracelet', 4)]
  const r = core.sfBlockRows('bracelets', 'stretch-all', list)
  assert.deepEqual(r.map((y) => y.h ? 'h:' + y.h + (y.first ? '*' : '') : y.x.c.id), ['h:Stretch*', 2, 3, 'h:Stretch Charm', 1, 4])
  const bs = core.sfBlockRows('bracelets', 'bangle-sparkle', [x('Sparkle Line', 1), x('Bangle', 2)])
  assert.deepEqual(bs.map((y) => y.h || y.x.c.id), ['Bangle', 2, 'Sparkle Line', 1], 'block order: Bangle, then Sparkle Line')
  assert.deepEqual(core.sfBlockRows('bracelets', 'stretch-all', [x('Stretch Bracelet', 1)]).map((y) => y.h || y.x.c.id), [1], 'one group = no heading')
  assert.deepEqual(core.sfBlockRows('bracelets', 'bangle', [x('Bangle', 1)]).map((y) => y.h || y.x.c.id), [1], 'a line = no heading')
  assert.deepEqual(core.sfBlockRows('bracelets', 'all', list).map((y) => y.x.c.id), [1, 2, 3, 4], 'All: as before')
  assert.match(SF, /g\.innerHTML = sfBlockRows\(tab, sk, list\)\.map\(function \(r\) \{ return r\.h \? '<h3 class="kl-gh' \+ \(r\.first \? ' kl-gh0' : ''\) \+ '">'/)
  assert.match(SF, /sk === 'all' \|\| sfInSub\(tab, \{ line: c\.line \}, sk\)/)
  const phone = CSS.match(/@media\(max-width:620px\)\{([\s\S]*?)\n\}/)[1]
  assert.match(phone, /\.kl-fam \.grid > \.kl-gh\.kl-gh0\{display:none\}/)
  assert.match(CSS, /\.kl-fam \.grid > \.kl-gh\{grid-column:1\/-1;/, 'the Gifts heading style, reused')
})

test('markup: block row + desktop line row, role=tab, short label on phones, the Bracelet styles tablist kept', () => {
  const h = core.sfBlockButtons('bracelets', 'klFamGrid')
  assert.equal((h.match(/role="tab"/g) || []).length, 1 + B.length)
  assert.match(h, /id="klblk-bracelets-all"[^>]*data-sub="all"[^>]*aria-selected="true" tabindex="0"/)
  assert.match(h, /id="klblk-bracelets-stretch-all"[^>]*data-sub="stretch-all" aria-controls="klFamGrid" aria-selected="false" tabindex="-1"/)
  assert.match(h, /<span class="kl-bl">Colour, worn softly<\/span><span class="kl-bs">Colour<\/span>/)
  assert.match(h, /<span class="kl-bt">Bangle &amp; Sparkle <span class="n"><\/span><\/span>/)
  const l = core.sfLineButtons('bracelets', 'klFamGrid')
  assert.equal((l.match(/role="tab"/g) || []).length, B.reduce((a, b) => a + 1 + b.subs.length, 0))
  assert.match(l, /id="klline-bracelets-stretch-all"[^>]*data-sub="stretch-all" data-block="stretch-all"[^>]*hidden>All /)
  assert.match(l, /id="klsub-bracelets-charm"[^>]*data-sub="charm" data-block="stretch-all"/)
  assert.match(l, /id="klsub-bracelets-colour-cobra"[^>]*data-sub="colour-cobra" data-block="colour"/)
  assert.match(SF, /id="klBSubs" role="tablist" aria-label="Bracelet styles" hidden>' \+ sfBlockButtons\('bracelets', 'klFamGrid'\)/)
  assert.match(SF, /id="klBLines" data-lines="bracelets" role="tablist" aria-label="Bracelet types" hidden>' \+ sfLineButtons\('bracelets', 'klFamGrid'\)/)
  assert.match(SF, /var bsr = \$\('#klBSubs'\), blr = \$\('#klBLines'\); if \(bsr\) bsr\.hidden = true; if \(blr\) blr\.hidden = true;/, 'both rows off outside Bracelets')
})

test('phone (<= 620 px): ONE row, no sideways scroll, every label fits its button at 375 and 390 px; desktop wraps', () => {
  const phone = CSS.match(/@media\(max-width:620px\)\{([\s\S]*?)\n\}/)[1]
  const btn = phone.match(/html\.kl-v2 #klBSubs \.kl-sub\{([^}]*)\}/)[1]
  assert.match(btn, /flex:1 1 0;/); assert.match(btn, /min-width:0;/); assert.match(btn, /white-space:normal;/)
  assert.match(phone, /html\.kl-v2 #klBSubs\{flex-wrap:nowrap; overflow:visible; gap:4px\}/)
  assert.match(phone, /html\.kl-v2 #klBLines\{display:none !important\}/, 'no 2nd row on phones (V-01)')
  assert.match(phone, /\.kl-sub \.kl-bl\{display:none\}/); assert.match(phone, /\.kl-sub \.kl-bs\{display:inline\}/)
  assert.match(CSS, /html\.kl-v2 #klBSubs, html\.kl-v2 #klBLines\{flex-wrap:wrap; overflow:visible\}/, 'desktop: wraps, never scrolls')
  assert.match(CSS, /html\.kl-v2 #klBSubs, html\.kl-v2 #klRSubs\{margin:0 -16px 8px; padding:0 16px\}/, 'phone gutter 16 px (row width = screen - 32)')
  assert.match(CSS, /\.kl-sub\{[^}]*min-height:44px/)
  // the width sum: 4 equal buttons; text box = (screen - 32 - 3 gaps) / 4 - 2x4 padding - 2x1 border
  const px = Number(btn.match(/font-size:(\d+)px/)[1]), pad = Number(btn.match(/padding:0 (\d+)px/)[1]), gap = Number(phone.match(/#klBSubs\{[^}]*gap:(\d+)px/)[1])
  const lh = Number(btn.match(/line-height:([\d.]+)/)[1])
  const EM = 0.6   // per glyph, above Jost's real ~0.5 em average (safety margin for bold selected state + wider glyphs)
  const w = (s) => s.length * EM * px
  const lines = (words, box) => {   // greedy wrap; null = a word wider than the box (it would be cut)
    let n = 1, cur = ''
    for (const wd of words) {
      if (w(wd) > box) return null
      const t = cur ? cur + ' ' + wd : wd
      if (w(t) <= box) cur = t; else { n++; cur = wd }
    }
    return n
  }
  for (const screen of [375, 390]) {
    const box = (screen - 32 - 3 * gap) / 4 - 2 * pad - 2
    for (const b of [{ short: 'All' }].concat(B)) {
      const n = lines((b.short + ' 199').split(' '), box)   // a 3-digit count, worst case
      assert.ok(n !== null, `${screen}: '${b.short}' has a word wider than ${box.toFixed(1)} px`)
      assert.ok(n * px * lh <= 44, `${screen}: '${b.short}' needs ${n} lines, more than the 44 px button`)
    }
  }
  assert.ok(px >= 12, 'site minimum 12 px')
})
