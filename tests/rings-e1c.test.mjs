// K&D E1b/E1c (K-069, reviewer note karmi #76) + K-070/K-071 (Mert, 24 Nov 2026): rings never count toward the 10+ price
// (counts_to_tier:false) but DO count toward free delivery (counts_to_free_shipping:true). With rings ON (an enabled flat
// group) EVERY visible 10+ PRICE claim ("10+ items" / "10 or more items" / "any mix") says "non-ring items" (klRingsNote())
// and every FREE-DELIVERY claim says "free with any 10+ items (rings included)" (klRingsShipNote()). With rings OFF
// (production today) every text is byte-for-byte what master showed (sha pin).
// The harness renders the page's own code as-is: pricing + delivery + M1 blocks, the bag footer (m1Foot), the bag line
// (m1LineText), meta / JSON-LD (m1ApplyMeta) and the hero price block (klHeroPriceApply -> sfHeroPriceApply) on a stub DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { LADDERS, loadLadders, publicLadders } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { blocks, pageData } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const RAW = JSON.parse(read('../ladders.json'))
const RINGS = JSON.parse(read('../data/cards.json')).cards.filter((c) => c.tab === 'rings')
// K-070 item-count wording ('free with any 10+ items (rings included)') is kept under the 24 Nov 2026 delivery block (£1.49,
// free with 10+ items; still supported). The LIVE delivery (owner 25 Nov 2026: £3.99, free from £30.00 paid, no item count)
// with rings ON is checked by the ON_LIVE test below.
const QTY24 = (r) => { r.shipping = { free_threshold_pence: null, below_threshold_fee_pence: 149, free_at_qty: { enabled: true, qty: 10 }, derive_threshold: null }; return r }
const ON = (() => { const r = QTY24(structuredClone(RAW)); r.flat_groups.R.enabled = true; return publicLadders(loadLadders(r).table) })()
const OFF = publicLadders(LADDERS)
const OFF24 = publicLadders(loadLadders(QTY24(structuredClone(RAW))).table)
const ON_LIVE = (() => { const r = structuredClone(RAW); r.flat_groups.R.enabled = true; return publicLadders(loadLadders(r).table) })()
const [G1] = Object.keys(GRADIENT)
const RING = RINGS[0].barcode

// a top-level function's source by brace matching (quoted strings skipped)
function fnSrc(src, name) {
  const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name)
  let j = src.indexOf('{', i), d = 0, q = null
  for (; j < src.length; j++) {
    const ch = src[j]
    if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') q = ch
    else if (ch === '{') d++
    else if (ch === '}' && --d === 0) break
  }
  return src.slice(i, j + 1)
}

// stub DOM: elements keep textContent / innerHTML / hidden; metas + JSON-LD from the static HTML
function el(attrs = {}) {
  const kids = {}
  return { textContent: '', innerHTML: '', hidden: false, style: {}, disabled: false, attrs,
    setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] }, hasAttribute(k) { return k in this.attrs },
    querySelector(s) { return kids[s] || (kids[s] = el()) }, classList: { contains: () => false, toggle() {} } }
}
function stubDoc() {
  const byId = {}
  const metas = [...HTML.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)">/g)]
    .filter((m) => ['description', 'og:description', 'twitter:description', 'og:title', 'twitter:title'].includes(m[2]))
    .map((m) => el({ [m[1]]: m[2], content: m[3].replace(/&amp;/g, '&') }))
  const lds = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { const e = el(); e.textContent = m[1]; return e })
  return { byId, metas, lds,
    getElementById(id) { return byId[id] || (byId[id] = el({ id })) },
    querySelectorAll(s) { return s.startsWith('meta[') ? metas : s.startsWith('script[') ? lds : [] } }
}

const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const SFL = new Function(`${LAYOUT}; return { sfHeroPrice, sfHeroPriceApply };`)()

function page(view) {
  const DATA = pageData(HTML), BY = {}
  for (const d of DATA) BY[d.barcode] = d
  for (const c of [...RINGS, { barcode: 'RA', line: 'Stretch Bracelet' }, { barcode: 'RB', line: 'Stretch Charm Bracelet' }, { barcode: 'RC', line: 'Bangle' }]) BY[c.barcode] = { barcode: c.barcode, type: c.line, color_en: c.name || c.line }
  const groups = { RA: 'A', RB: 'B', RC: 'C', ...Object.fromEntries(RINGS.map((c) => [c.barcode, 'R'])) }
  const PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])
  const LADDER_TYPES = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const doc = stubDoc()
  const window = { klPrice: () => null, klGroup: (bc) => groups[bc] || null, klLadders: view, klSfL: SFL, __klGroupsKnown: true, klGroupList: () => ['A', 'B', 'C'] }
  const b = blocks(HTML)
  const glue = ['m1Foot', 'm1LineText', 'm1ApplyMeta', 'itemWord', 'klHeroPriceApply'].map((n) => fnSrc(HTML, n)).join('\n')
  const names = ['applyLadderShipping', 'm1Lines', 'm1PriceText', 'm1PriceHtml', 'm1Texts', 'm1TierHint', 'cardShipText', 'shipSentence', 'm1Foot', 'm1LineText', 'm1ApplyMeta', 'klHeroPriceApply']
  const p = new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', 'document', 'NA_TXT',
    `let cart=[];\n${b.pricing}\n${b.delivery}\n${b.m1}\n${glue}\n; return { setCart: (c) => { cart = c }, ${names.join(', ')} };`)(BY, LADDER_TYPES, PRICE, window, doc, 'n/a')
  if (view) p.applyLadderShipping(view)
  return { p, doc }
}

const BAGS = [[], [{ bc: 'RB', qty: 1 }], [{ bc: 'RA', qty: 6 }], [{ bc: 'RB', qty: 9 }], [{ bc: G1, qty: 9 }], [{ bc: G1, qty: 10 }],
  [{ bc: 'RC', qty: 4 }, { bc: 'RA', qty: 3 }], [{ bc: 'RB', qty: 10 }, { bc: 'RC', qty: 2 }],
  [{ bc: RING, qty: 3 }], [{ bc: RING, qty: 5 }], [{ bc: 'RB', qty: 9 }, { bc: RING, qty: 3 }], [{ bc: 'RA', qty: 6 }, { bc: RING, qty: 5 }],
  [{ bc: 'RB', qty: 10 }, { bc: RING, qty: 5 }], [{ bc: G1, qty: 8 }, { bc: RING, qty: 6 }]]
const FOOT = ['cartSub', 'cartShipVal', 'cartTotal', 'cartShip', 'cartM1', 'cartPre', 'cartM1Near']

/** Every text the page code produces for one table, in a fixed order. */
function record(view) {
  const { p, doc } = page(view), out = {}
  const T = p.m1Texts()
  out.texts = { ...T, count: [1, 8, 15].map(T.count) }
  out.ship = [p.shipSentence(), p.cardShipText()]
  out.hint = Array.from({ length: 13 }, (_, n) => p.m1TierHint(n))
  out.price = ['RA', 'RB', 'RC', G1].map((bc) => [p.m1PriceText(bc), p.m1PriceHtml(bc)])
  out.bags = BAGS.map((bag) => {
    p.setCart(bag.map((c) => ({ ...c })))
    if (bag.length) p.m1Foot()
    return { lines: p.m1Lines(bag), line: bag.map((c) => p.m1LineText(c.bc)),
      foot: bag.length ? FOOT.map((id) => { const e = doc.getElementById(id); return [e.textContent, e.innerHTML, e.hidden] }) : [] }
  })
  p.m1ApplyMeta(T)
  out.meta = doc.metas.map((m) => m.attrs.content).concat(doc.lds.map((s) => s.textContent))
  p.klHeroPriceApply()
  const hp = doc.getElementById('klHeroPrice')
  out.hero = [hp.hidden, hp.querySelector('.kl-hp-l1').innerHTML, hp.querySelector('.kl-hp-single').textContent]
  return out
}
const flat = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(flat) : o && typeof o === 'object' ? Object.values(o).flatMap(flat) : [])
const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex')
// re-pinned 24 Nov 2026 twice (no-shade-count copy: herop text changed on purpose; K&D #92 removed the colour range)
// re-pinned 24 Nov 2026 a third time ON PURPOSE (feat/deal-price-first, owner via Komuta: the 10+ price leads, the single
// price second): only the price texts changed (texts.hero/meta/cta/each/count, hint 0-9, price[], meta/og/twitter/JSON-LD);
// bag lines, progress, foot and hero block byte-identical to origin/master 2bc5018 (diffed record(OFF) before re-pinning)
// sha256 of record(OFF) / record(null) taken on origin/master 9ed2989 (#77 meta, before this change): rings OFF = not one byte different
// re-pinned 25 Nov 2026 ON PURPOSE (owner: £3.99 UK delivery, free on orders of £30 or more on the basket paid, no item-count free delivery):
// diffed record(OFF) against origin/master e46d673 with the same ladders.json: only delivery texts moved (ship sentence,
// tier hints 10-12, ad, cta/each/faqa delivery part, meta/JSON-LD sentence, bag spend nudge "Add £x for free delivery",
// unlock totals "+ £3.99 delivery", cartShipVal note); prices, carts, hero block unchanged
// re-pinned 26 Nov 2026 ON PURPOSE (feat/site-basics-1: rules v2 R2' one wording, owner/Komuta D-002 slogan): diffed
// record(OFF) against origin/master b23e75b: only 'free over £30' -> 'free on orders of £30 or more' (every delivery text),
// mdesc 'stack it into the gradient.' -> 'stack a few shades.' and og/twitter title ('The Gradient Edit £2.40 ...' ->
// 'Colour, worn softly · from £1.50 each when you buy any 10+ items'); prices, carts, bag lines, hero block unchanged
// re-pinned again 26 Nov 2026 ON PURPOSE (K&D #101 no was/now in the bag): diffed record(OFF) against 25a0531: only the 10+
// applied line moved ('Instant 70% off applied: £2.40 each instead of £8' -> '10+ price applied: £2.40 each (70% off)')
// re-pinned 26 Nov 2026 ON PURPOSE (U5 bag hint uses the line's own group price, K&D/O&W wording): diffed record(OFF) against origin/master 3890629:
// only the cartM1 hint moved ('Now £8 each · 70% off ... (£2.40 each)' -> '£{own single} each for 1–9 items · 70% off ... (£{own 10+} each)', per group in the bag); everything else byte-identical
// re-pinned 26 Nov 2026 ON PURPOSE (basket-1 U4: one add label): diffed record(OFF) with the old label put back: the ONLY change is the bag nudge button
// text '＋ Add' -> 'Add to bag' (cart band); every price, bag line, total and hint byte-identical
const PIN_OFF = 'f0bacc5987b014e6142d85ee9035db8cdbe30e32ee98e32d635aae5849d25582'
const PIN_FALLBACK = 'f0bacc5987b014e6142d85ee9035db8cdbe30e32ee98e32d635aae5849d25582'   // M1_FALLBACK = publicLadders(ladders.json)

test('rings OFF (ladders.json today + first paint): every page text byte-for-byte = master (sha pin)', () => {
  assert.equal(RAW.flat_groups.R.enabled, false)
  assert.equal(sha(record(OFF)), PIN_OFF)
  assert.equal(sha(record(null)), PIN_FALLBACK)
  assert.doesNotMatch(flat(record(OFF)).join('\n'), /non-ring|rings not included|not counting rings/)
})

test('rings ON with the LIVE delivery (owner 25 Nov 2026): no item-count delivery claim; every 10+ price claim says "non-ring"', () => {
  const r = record(ON_LIVE), all = flat(r).map((s) => s.replace(/<[^>]*>/g, ''))
  assert.deepEqual(r.ship, ['£3.99 UK delivery, free on orders of £30 or more', '+ £3.99 UK delivery, free on orders of £30 or more'])
  for (const s of all) {
    assert.doesNotMatch(s, /free with any|rings included|£1\.49/, s)
    for (const m of s.matchAll(/\b10(\+| or more)(?! prices?\b)(.{0,24})/g)) assert.match(m[2], /^ non-ring items?\b/, m[0] + ' in ' + s)
  }
})

// a count claim: "10+" (not the price's name "10+ price"), "10 or more", "any mix"
const CLAIM = /\b10\+(?! prices?\b)|\b10 or more\b|\bany mix\b|\bUnder 10\b/
test('rings ON: every 10+ / 10 or more / any mix claim says "non-ring items" (price) or "items (rings included)" (delivery)', () => {
  const r = record(ON), all = flat(r).map((s) => s.replace(/<[^>]*>/g, ''))
  let n = 0
  for (const s of all) {
    if (!CLAIM.test(s)) continue
    n++
    assert.match(s, /non-ring item|items? \(rings included\)/, 'claim without the rings note: ' + s)
    for (const m of s.matchAll(/\b10(\+| or more|(?<=Under 10))(?! prices?\b)(.{0,24})/g)) {
      const pre = s.slice(Math.max(0, m.index - 20), m.index)
      // a free-delivery claim counts rings (K-070): "free with any 10+ items (rings included)" / "Under 10 items (rings included), UK delivery"
      if (/(free|delivery) with any $|Under $/.test(pre)) assert.match(m[2], /^ items? \(rings included\)/, 'delivery note right after the count: ' + m[0] + ' in ' + s)
      else assert.match(m[2], /^ non-ring items?\b/, 'note right after the count: ' + m[0] + ' in ' + s)
    }
    assert.doesNotMatch(s, /free with any 10\+ non-ring/, 'rings count toward free delivery: ' + s)
  }
  assert.ok(n >= 20, 'scanned claims: ' + n)
  // the places the reviewer listed, explicitly
  const T = r.texts
  // deal-first re-pin (owner 24 Nov 2026): the 10+ price leads; the single price says '1–9 non-ring items' (same count as the 10+ claim)
  assert.equal(T.cta.replace(/<[^>]*>/g, ''), 'Mix any shades · £2.40 each when you buy any 10+ non-ring items (70% off) · £8 each for 1–9 non-ring items · £1.49 UK delivery · free with any 10+ items (rings included)')
  assert.equal(T.faqq, 'How does 70% off when you buy any 10+ non-ring items work?')
  assert.match(T.faqa, /Put <b>any 10 or more non-ring items<\/b> in your bag \(any mix\)/)
  assert.match(T.faqa, /Under 10 items \(rings included\), UK delivery is £1\.49\./)
  assert.equal(T.count[1], '8 shades · £2.40 each when you buy any 10+ non-ring items (70% off) · £8 each for 1–9 non-ring items')
  assert.equal(r.price[0][0], '£1.50 each when you buy any 10+ non-ring items (70% off) · £5 each for 1–9 non-ring items')
  assert.equal(r.ship[0], '£1.49 UK delivery · free with any 10+ items (rings included)')   // announce bar, hero, FAQ, footer (data-kl="ship")
  assert.equal(r.ship[1], '+ £1.49 UK delivery · free with any 10+ items (rings included)')
  assert.match(r.hero[1], /<span class="kl-hp-cond">for any 10\+ non-ring items<\/span>/)
  const nine = r.bags[3].foot   // 9 B, no ring in the bag: the bag still says rings don't count
  assert.equal(nine[1][1], '<span class="note">£1.49 UK delivery · free with any 10+ items (rings included)</span>')
  assert.equal(nine[4][0], '£8 each for 1–9 items · 70% off every non-ring item when your bag has 10+ non-ring items (£2.40 each)')
  assert.match(r.bags[10].lines.progress, /^Add 1 more non-ring item for 70% off every non-ring item/)
  assert.match(r.bags[11].lines.progress, /^Add 4 more non-ring items /)
  assert.match(r.meta[0], /£3\.90 each when you buy any 10\+ non-ring items \(70% off every item, any mix\); £5, £8 or £13 each for 1–9 non-ring items\. .* £3\.99 UK delivery, free on orders of £30 or more\.$/)   // static meta sentence (owner 25 Nov 2026)
  // 5 rings + 3 items: counted rings, delivery line of its own; 9 B + 3 rings = 12 items: delivery free
  assert.equal(r.bags[10].foot[1][1], '<span class="free">FREE ✓</span>')
})

test('ON vs OFF: the only differences are the "non-ring" / "(rings included)" notes (no other wording moved), the % rule kept, no save/strike', () => {
  // by path: ring lines ('Add 2 more rings to check out', L.rings) exist only ON and are compared nowhere else
  const paths = (o, p = '', out = {}) => { if (typeof o === 'string') out[p] = o; else if (o && typeof o === 'object') for (const k of Object.keys(o)) paths(o[k], p + '/' + k, out); return out }
  const pOn = paths(record(ON)), pOff = paths(record(OFF24))
  // hero ON: 'for any 10+ non-ring items' (one line at 375px); progress: 'Add N more non-ring item(s)' (OFF 'Add N more');
  // every other claim: ' non-ring' before ' item(s)'
  const strip = (s) => s.replace(/for any (\d+\+) non-ring items/g, 'when you buy any $1 items').replace(/(Add \d+ more) non-ring items?/g, '$1').replace(/(Buy \d+\+) non-ring items,/g, '$1,').replace(/ non-ring(?= items?\b)/g, '').replace(/ items \(rings included\)/g, ' items')
  let diff = 0
  for (const [k, s] of Object.entries(pOff)) {
    if (/^\/bags\/(\d+)\//.test(k) && BAGS[+k.split('/')[2]].some((c) => c.bc === RING)) continue   // a ring in the bag: priced only ON (rings-ui.test.mjs)
    assert.ok(k in pOn, k)
    if (pOn[k] !== s) diff++
    assert.equal(strip(pOn[k]), s, k)
  }
  assert.ok(diff >= 20, 'changed texts: ' + diff)
  const on = Object.values(pOn)
  assert.doesNotMatch(on.join('\n'), /\bsave\b|<s>|<del>|line-through|was £|rings not included|not counting rings/i)
  for (const s of on) for (const m of s.matchAll(/(\d+)% off/g)) assert.equal(m[1], '70')
})

test('static HTML: every 10+ claim outside scripts sits in a node the page rewrites (data-kl / data-kl-m1 / hero / bag / sticky / meta)', () => {
  const body = HTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  for (const line of body.split('\n')) {
    if (!CLAIM.test(line.replace(/<[^>]*>/g, ''))) continue
    assert.match(line, /data-kl="(ship|cardship|fee1)"|data-kl-m1="|id="klHeroPrice"|id="cartShip"|<meta (name|property)="(description|og:description|twitter:description)"/, line.trim().slice(0, 160))
  }
  // JSON-LD: product description + shipping description rewritten by m1ApplyMeta (scanned above)
  assert.match(fnSrc(HTML, 'm1ApplyMeta'), /klRingsNote\(\)/)
  assert.match(SF, /window\.cardShipText\(\)/, 'family tabs sticky bar uses cardShipText')
})
