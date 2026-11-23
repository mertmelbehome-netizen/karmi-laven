// Families view, category findability fix (23 Nov, morning_review/15_nav_findability):
//   F1 chips right under the logo/Bag row, before the hero; F2 one sticky row <= 56 px, the colour bar sticks under it
//   (desktop) or not at all (<= 840 px); F3 hero = H1 + one short line, the price/delivery line, Christmas notice, Melbe
//   line, trust strip and company/VAT line MOVED (not deleted) to one block after the grids; F4 short chip labels;
//   F7 dead eyebrow hidden. CMA209: every priced card and the bag keep "£1.49 UK delivery · free with any 10+ items".
// The layout code (js/storefront.js KL-SF-LAYOUT block) and js/christmas.js run as-is against a small DOM built from
// the real index.html markup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const XMAS = read('../js/christmas.js')
// since the CLS fix (18_cls_prepaint) the layout block lives inline in index.html and runs before the first paint
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const sfLayout = new Function(`${LAYOUT}; return sfLayout;`)()
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TITLE, SF_CHIP, sfFamCard };`)()
const DELIVERY = /£1\.49 UK delivery · free with any 10\+ items/

// ---------- a tiny DOM (enough for querySelector with tag/.class/#id compounds and descendant combinators) ----------
class El {
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.children = []; this.parentNode = null; this.text = ''; this.hidden = 'hidden' in attrs }
  get id() { return this.attrs.id || '' } set id(v) { this.attrs.id = v }
  get className() { return this.attrs.class || '' } set className(v) { this.attrs.class = v }
  get classes() { return this.className.split(/\s+/).filter(Boolean) }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join('') } set textContent(v) { this.text = String(v); this.children = [] }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null }
  setAttribute(k, v) { this.attrs[k] = String(v) } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  hasAttribute(k) { return k in this.attrs } removeAttribute(k) { delete this.attrs[k] }
  _detach() { if (this.parentNode) { const s = this.parentNode.children; s.splice(s.indexOf(this), 1); this.parentNode = null } }
  appendChild(e) { e._detach(); e.parentNode = this; this.children.push(e); return e }
  insertBefore(e, ref) { if (!ref) return this.appendChild(e); e._detach(); e.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, e); return e }
  removeChild(e) { e._detach(); return e }
  *walk() { for (const c of this.children) { yield c; yield* c.walk() } }
  querySelectorAll(sel) { return [...this.walk()].filter((e) => matches(e, sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  closest(sel) { for (let e = this; e; e = e.parentNode) if (e.tagName && matches(e, sel)) return e; return null }
}
function compound(e, part) {
  const m = part.match(/^([a-z0-9]*)((?:[.#][\w-]+)*)$/i); if (!m) throw new Error('selector ' + part)
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false
  for (const t of m[2].match(/[.#][\w-]+/g) || []) { if (t[0] === '#' ? e.id !== t.slice(1) : !e.classes.includes(t.slice(1))) return false }
  return true
}
function matches(e, sel) {
  return sel.split(',').some((one) => {
    const parts = one.trim().split(/\s+/); if (!compound(e, parts[parts.length - 1])) return false
    let i = parts.length - 2
    for (let a = e.parentNode; a && i >= 0; a = a.parentNode) if (a.tagName && compound(a, parts[i])) i--
    return i < 0
  })
}
const VOID = new Set(['img', 'br', 'input', 'meta', 'link', 'hr', 'source'])
/** index.html body from the announcement bar to the first section after the grids, as a DOM */
function pageDoc() {
  const from = HTML.indexOf('<div class="announce">'), to = HTML.indexOf('<section class="story">')
  const src = HTML.slice(from, to).replace(/<script>[\s\S]*?<\/script>/g, '')   // inline pre-paint scripts are not markup
  const body = new El('body'), html = new El('html'), head = new El('head'); html.appendChild(head); html.appendChild(body)
  let cur = body
  for (const m of src.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi)) {
    if (m[5]) { cur.appendChild(Object.assign(new El('#text'), { text: m[5].replace(/&amp;/g, '&') })); continue }
    const tag = m[2].toLowerCase()
    if (m[1]) { while (cur !== body && cur.tagName !== tag.toUpperCase()) cur = cur.parentNode; if (cur !== body) cur = cur.parentNode; continue }
    const attrs = {}; for (const a of m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? ''
    const e = new El(tag, attrs); cur.appendChild(e)
    if (!m[4] && !VOID.has(tag)) cur = e
  }
  // what storefront.js buildShell adds before sfLayout runs: the family panel after the Gradient panel
  const fam = new El('section', { id: 'klFam', class: 'wrap collection kl-fam' }); const pal = body.querySelector('#palette'); body.insertBefore(fam, pal.nextSibling)
  const doc = {
    documentElement: html, head, body,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
    getElementById: (id) => html.querySelector('#' + id), createElement: (t) => new El(t),
  }
  return doc
}
const order = (doc) => doc.body.children.filter((e) => e.tagName !== '#TEXT').map((e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classes[0] ? '.' + e.classes[0] : '')))
const tabbar = () => new El('nav', { class: 'kl-tabbar', 'aria-label': 'Shop by category' })
const xmasApi = (doc) => { const W = { document: doc }; new Function('window', XMAS)(W); return W }
const XC = { last_order_date: '2099-12-18' }

test('F1: the chip bar comes right after the logo/Bag row and BEFORE the hero', () => {
  const doc = pageDoc()
  const before = order(doc)
  assert.ok(before.indexOf('header.hero') < before.indexOf('div.swatchbar'))
  sfLayout(doc, tabbar())
  const o = order(doc)
  assert.deepEqual(o.slice(0, 4), ['div.announce', 'nav', 'nav.kl-tabbar', 'header.hero'])
})

test('F3: hero keeps H1 + one short line (<= 15 words); eyebrow and buttons hidden; nothing is deleted', () => {
  const doc = pageDoc(); sfLayout(doc, tabbar())
  const hc = doc.querySelector('.hero-copy')
  const all = hc.children.filter((e) => e.tagName !== '#TEXT' && !e.hidden && !e.classes.includes('spectrum'))
  // + the hero price block right under the line (25_hero_price; its own rules: tests/hero-price.test.mjs)
  assert.deepEqual(all.map((e) => e.tagName + (e.classes.includes('kl-hp') ? '.kl-hp' : '')), ['H1', 'P', 'DIV.kl-hp'])
  const shown = all.filter((e) => !e.classes.includes('kl-hp'))
  const words = shown.map((e) => e.textContent).join(' ').split(/\s+/).filter(Boolean)
  assert.ok(words.length <= 15, words.join(' '))
  assert.ok(doc.querySelector('.hero-copy .k').hidden, 'dead eyebrow hidden (F7)')
  assert.equal(doc.querySelector('.hero-copy p').getAttribute('data-kl-m1'), null, 'M1 must not put the Gradient-only line back')
  for (const w of ['crystal', 'lux', 'diamond', 'stone', 'designed', 'hand-strung', 'premium', 'best', 'finest', '%']) assert.ok(!words.join(' ').toLowerCase().includes(w), w)
})

test('F3: price + delivery line, Christmas notice, Melbe line, trust strip and company/VAT line sit in one block AFTER the grids', () => {
  const doc = pageDoc()
  const W = xmasApi(doc); W.klXmasApply(XC)                       // notice added first (the usual order: /api/stock, then storefront.js)
  assert.ok(doc.querySelector('.hero #klXmasHero'), 'notice starts next to the hero delivery line')
  sfLayout(doc, tabbar())
  const o = order(doc)
  assert.ok(o.indexOf('#klInfo') > o.indexOf('#palette') && o.indexOf('#klInfo') > o.indexOf('#klFam'), o.join(' > '))
  const info = doc.querySelector('#klInfo')
  for (const s of ['.launch', '.launchfee', '#klXmasHero', '.stars', '.trustband', '.tb-legal']) assert.ok(info.querySelector(s), s + ' moved into #klInfo')
  assert.ok(!doc.querySelector('.hero .launchfee') && !doc.querySelector('.hero .trustband'))
  assert.match(info.querySelector('.launchfee').textContent, DELIVERY, 'delivery line keeps the fee next to "free"')
  assert.match(info.querySelector('.tb-legal').textContent, /Company No\. 15549022 · VAT GB513559785/)
  assert.match(info.querySelector('#klXmasHero').textContent, /^Christmas: last online order /)
  // a later /api/stock refresh re-applies the notice: it lands next to the moved delivery line, once
  W.klXmasApply(XC)
  assert.equal(doc.querySelectorAll('#klXmasHero').length, 1)
  assert.ok(doc.querySelector('#klInfo #klXmasHero'))
})

test('Christmas notice applied AFTER the layout move still appears (anchor fallback), and the flag-OFF page is unchanged', () => {
  const doc = pageDoc(); sfLayout(doc, tabbar())
  xmasApi(doc).klXmasApply(XC)
  assert.ok(doc.querySelector('#klInfo #klXmasHero'))
  const off = pageDoc(); xmasApi(off).klXmasApply(XC)            // no sfLayout = families OFF: today's place
  const n = off.querySelector('#klXmasHero'); assert.ok(n.closest('.hero'))
  assert.ok(n.parentNode.children[n.parentNode.children.indexOf(n) - 1].classes.includes('launchfee'))
})

test('F2: chip bar sticky top:0 and <= 56 px; colour bar sticks under it (desktop) or scrolls (<= 840 px)', () => {
  const rule = (sel) => { const m = CSS.match(new RegExp(sel.replace(/[.[\]=]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1] }
  const bar = rule('.kl-tabbar')
  assert.match(bar, /position:sticky; top:0/)
  assert.match(bar, /padding:0/, 'the global nav{padding:26px 0 22px} (the old 98 px bar) is reset')
  const chip = +rule('.kl-tabs [role=tab]').match(/min-height:(\d+)px/)[1]
  const pad = +rule('.kl-tabs').match(/padding:(\d+)px/)[1]
  assert.ok(chip >= 44, 'touch target >= 44 px')
  assert.ok(chip + 2 * pad + 2 <= 56, `bar height ${chip + 2 * pad + 2}`)
  assert.match(CSS, /html\.kl-v2 \.swatchbar\{top:var\(--kl-tb-h,54px\)\}/)
  assert.match(CSS, /@media\(max-width:840px\)\{[^@]*html\.kl-v2 \.swatchbar\{position:relative; top:auto\}/)
  assert.match(SF, /setProperty\('--kl-tb-h', bar\.offsetHeight/)
  assert.match(rule('.kl-tabs [role=tab][aria-selected=true]'), /background:var\(--ink\)/, 'F6 filled active chip')
})

test('F4/F6: short chip labels, panel titles and tab roles unchanged', () => {
  assert.deepEqual(core.SF_CHIP, { gradient: 'Gradient', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair', gifts: 'Gifts', rings: 'Rings' })
  assert.equal(core.SF_TITLE.gradient, 'The Gradient Edit')
  assert.match(LAYOUT, /role="tab" type="button" id="kltab-' \+ t \+ '"[^\n]*aria-selected[^\n]*SFL_CHIP\[t\]/)
  assert.deepEqual(new Function(`${LAYOUT}; return SFL_CHIP;`)(), core.SF_CHIP, 'pre-paint chip labels = storefront.js labels')
  assert.match(SF, /\['ArrowRight', 'ArrowLeft', 'Home', 'End'\]/)
})

test('CMA209: every priced card (Gradient + family) and the bag keep the delivery fee with the 10+ free condition', () => {
  // Gradient card template: the delivery line sits right under the price
  assert.match(HTML, /<div class="pr">\$\{m1On\(\)\?m1PriceHtml\(d\.barcode\):pt\}<\/div>\s*<div class="fee" data-kl="cardship">\$\{cardShipText\(\)\}<\/div>/)
  assert.match(HTML, /function cardShipText\(\)\{[^\n]*'\+ '\+gbpP\(SHIP\.feeP\)\+' UK delivery'\+\(SHIP\.freeQty\?' · free with any '\+SHIP\.freeQty\+'\+'\+klRingsNote\(\)\+' items':''\)/)
  // family card: price + delivery line together, for sellable and single states
  const c = { barcode: '1', name: 'Rose', line: 'Bead Necklace', swatch: '#fff', photo: '/x.jpg' }
  const ship = '+ £1.49 UK delivery · free with any 10+ items'
  for (const st of ['sellable', 'single']) {
    const h = core.sfFamCard(c, st, { line: { p: 500, html: '£5.00' }, badge: null, ship })
    assert.match(h, /<div class="pr">£5\.00<\/div><div class="fee" data-kl="cardship">\+ £1\.49 UK delivery · free with any 10\+ items<\/div>/, st)
  }
  // bag drawer default line
  assert.match(HTML, /id="cartShip"[^>]*>£1\.49 UK delivery · free with any 10\+ items</)
  // the layout move never takes the delivery line off the page, and "free" never shows without the fee
  const doc = pageDoc(); sfLayout(doc, tabbar())
  const lines = [...doc.body.walk()].filter((e) => ['ship', 'cardship'].includes(e.attrs['data-kl']))
  assert.ok(lines.length >= 3, 'announce bar, moved hero line, Gradient strip')
  for (const e of lines) assert.match(e.textContent, DELIVERY)
  for (const e of [...doc.body.walk()].filter((x) => x.tagName === '#TEXT' && /\bfree\b/i.test(x.text))) assert.match(e.parentNode.textContent, /£1\.49/, e.text)
})

test('CMA209: every fee1 delivery span (card each-line, sticky bar, family sticky) names the 10+ free condition', async () => {
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const spans = [...html.matchAll(/data-kl="fee1">([^<]*)</g)].map((m) => m[1])
  assert.ok(spans.length >= 2)
  for (const s of spans.filter((x) => !x.startsWith("'+"))) assert.match(s, /£1\.49 UK delivery · free with any 10\+ items/, s)   // static spans; JS-built ones use cardShipText() (asserted below)
  assert.match(html, /const fee=cardShipText\(\);/)
  assert.match(html, /\[data-kl="fee1"\]'\)\.forEach\(e=>\{e\.textContent=cardShipText\(\);/)
  const sf = readFileSync(new URL('../js/storefront.js', import.meta.url), 'utf8')
  assert.match(sf, /data-kl="fee1">' \+ \(typeof window !== 'undefined' && typeof window\.cardShipText === 'function' \? window\.cardShipText\(\)/)
})

test('hero line names only the categories on sale (no "hair pieces" while the Hair tab is hidden)', () => {
  const sfHeroLine = new Function(`${LAYOUT}; return sfHeroLine;`)()
  assert.equal(sfHeroLine(['gradient', 'bracelets', 'necklaces']), 'Bracelets and necklaces. Build your own stack.')
  assert.equal(sfHeroLine(['gradient', 'bracelets', 'necklaces', 'hair']), 'Bracelets, necklaces and hair pieces. Build your own stack.')
  assert.equal(sfHeroLine(['gradient']), 'Bracelets. Build your own stack.')
  assert.match(SF, /hp\.textContent = sfHeroLine\(vis\)/)
})
test('desktop: hero photo capped well under 60vh (first product cards on the first screen)', () => {
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  assert.match(css, /@media\(min-width:841px\)\{[\s\S]*?html\.kl-v2 \.hero-img img\{aspect-ratio:auto; height:min\(28vh,240px\)\}/)
})

test('bundle builder static fallback: no pools-era ladder price left in the source (M1)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /id="bTot">–<\/span>/)
  assert.match(html, /id="bEach">Add items to build your bundle<\/div>/)
  assert.doesNotMatch(html, /£7\.50<\/span>|≈ £2\.50 each|3 bracelets<\/div>/)
})

test('phone: first screen shows the chips + at least one full card (hero photo off, H1/panel titles visually hidden, not removed)', () => {
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  const m = css.match(/@media\(max-width:560px\)\{([\s\S]*?)\r?\n\}/)
  assert.ok(m)
  assert.match(m[1], /html\.kl-v2 \.hero-img\{display:none\}/)
  assert.match(m[1], /html\.kl-v2 \.hero h1, html\.kl-v2 #palette \.col-head h2, html\.kl-v2 #klFam \.col-head h2\{position:absolute; width:1px; height:1px;/)
  assert.doesNotMatch(m[1], /\.hero h1\{display:none|col-head h2\{display:none/, 'titles stay for screen readers')
})

test('phone: card ship label is one short line (no 3-line block over the photo)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  assert.match(html, /matchMedia\('\(max-width:560px\)'\)\.matches\) return 'Ships in 1–2 business days';/)
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.imgwrap \.stk:not\(:empty\)\{[^}]*white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:calc\(100% - 16px\)\}/)
})

test('N3: meta / og / JSON-LD name only categories on sale; hair wording added back only when hair is sellable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const head = [...html.matchAll(/<meta (?:name|property)="[^"]+" content="([^"]*)"/g)].map((m) => m[1]).join(' | ')
    + [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(' ')
  assert.doesNotMatch(head, /hair/i, 'static head has no hair wording while hair is withdrawn')
  const sfMetaCats = new Function(`${LAYOUT}; return sfMetaCats;`)()
  const mk = () => { const metas = [{ c: 'Karmi Laven bracelets and necklaces — £5' }, { c: 'Karmi Laven — Bracelets & Necklaces · from £5 each' }]
    const ld = { textContent: JSON.stringify({ name: 'Karmi Laven Bracelets & Necklaces', description: 'Bracelets and necklaces, £5' }) }
    return { metas, ld, doc: { querySelectorAll: (s) => s.startsWith('meta') ? metas.map((m) => ({ getAttribute: () => m.c, setAttribute: (k, v) => { m.c = v } })) : [ld] } } }
  const a = mk(); sfMetaCats(a.doc, true)
  assert.equal(a.metas[0].c, 'Karmi Laven bracelets, necklaces and hair pieces — £5')
  assert.equal(a.metas[1].c, 'Karmi Laven — Bracelets, Necklaces & Hair · from £5 each')
  assert.equal(JSON.parse(a.ld.textContent).name, 'Karmi Laven Bracelets, Necklaces & Hair')
  sfMetaCats(a.doc, false)
  assert.equal(a.metas[1].c, 'Karmi Laven — Bracelets & Necklaces · from £5 each')
  assert.match(SF, /sfMetaCats\(document, vis\.indexOf\('hair'\) >= 0\);/)
})
test('N1: phone cookie banner is compact (does not cover the first card price + delivery line)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /@media\(max-width:600px\)\{\r?\n  \/\* compact on phones[\s\S]*?#cookie-banner\{ flex-direction:row; flex-wrap:wrap; align-items:center; padding:8px 12px;/)
})

test('375x812 + 390x844: first card ends above the sticky bar (compact announce + logo row on phones)', () => {
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  assert.match(css, /html\.kl-v2 body > nav:not\(\.kl-tabbar\)\{padding:10px 0 8px\}/)
  assert.match(css, /html\.kl-v2 \.announce\{padding:7px 10px; font-size:10\.5px; letter-spacing:\.1em; line-height:1\.4\}/)
})

test('no false scarcity: "Only N left" comes from LIVE stock only (API down -> none; live q>6 -> cleared)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const src = html.match(/function stockTxt\(d\)\{[\s\S]*?\n\}/)[0]
  const STORENAMES = { WAT: 'Watford' }
  const stockTxt = new Function('STORENAMES', 'matchMedia', `${src}; return stockTxt;`)(STORENAMES, undefined)
  assert.equal(stockTxt({ total: 3, stock: { WAT: 3 } }), '', 'baked DATA total 3 (0381 June snapshot) must not say Only 3 left')
  assert.equal(stockTxt({ total: 0 }), '')
  assert.doesNotMatch(src, /'Only '/)
  assert.match(html, /if\(stk\)\{ stk\.textContent = \(typeof q==='number' && q>0 && q<=LOWMAX\) \? \('Only '\+q\+' left'\) : ''; \}/)
  assert.doesNotMatch(html, /stk\.textContent\|\|''/)
})

test('strict scarcity: a failed refresh or an answer older than one refresh period clears every "Only N left"', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const fn = html.match(/async function fetchLiveStock\(extra\)\{[\s\S]*?\n  \}\r?\n/)[0]
  assert.match(fn, /if\(!res\.ok\)\{ clearScarcity\(\); return false; \}/)
  assert.match(fn, /if\(!data \|\| !data\.ok \|\| !data\.stock\)\{ clearScarcity\(\);/)
  assert.match(fn, /LIVE_TS=Date\.now\(\);/)
  assert.match(fn, /console\.warn\('\[karmi-stock\][^\n]*\r?\n\s*clearScarcity\(\);/)
  assert.match(html, /setInterval\(function\(\)\{ if\(LIVE_TS && Date\.now\(\)-LIVE_TS>scarcityMaxAgeMs\(\)\) clearScarcity\(\); \}, 5000\);/)
  // clearScarcity empties only the scarcity text
  const src = html.match(/function clearScarcity\(\)\{[^\n]*\}/)[0]
  const els = [{ textContent: 'Only 3 left' }, { textContent: 'Ships in 1–2 business days' }, { textContent: '' }]
  new Function('document', `${src}; clearScarcity();`)({ querySelectorAll: () => els })
  assert.deepEqual(els.map((e) => e.textContent), ['', 'Ships in 1–2 business days', ''])
})

// ---------- CLS fix (morning_review/18_cls_prepaint): the families layout exists BEFORE the first paint ----------
test('pre-paint: <head> sets html.kl-v2 (default ON, remembered answer) and links storefront.css statically', () => {
  const head = HTML.slice(0, HTML.indexOf('</head>'))
  assert.match(head, /<link href="\/css\/storefront\.css\?v=pr4" rel="stylesheet">/)
  const pre = head.match(/\/\*KL-SF-PRE-START\*\/([\s\S]*?)\/\*KL-SF-PRE-END\*\//)[1]
  const run = (stored) => {
    const cls = new Set(), window = {}
    const localStorage = { getItem: () => stored }
    new Function('window', 'document', 'localStorage', pre)(window, { documentElement: { classList: { add: (c) => cls.add(c) } } }, localStorage)
    return { v2: cls.has('kl-v2'), pre: window.__klSfPre === true }
  }
  assert.deepEqual(run(null), { v2: true, pre: true }, 'first visit: families layout (production runs families ON)')
  assert.deepEqual(run('1'), { v2: true, pre: true })
  assert.deepEqual(run('0'), { v2: false, pre: false }, 'last answer was OFF: the old page from the start')
  // the boot switch remembers the answer and undoes the pre-paint layout when OFF; a failed first load undoes it too
  const boot = HTML.match(/\/\*KL-SF-BOOT-START\*\/([\s\S]*?)\/\*KL-SF-BOOT-END\*\//)[1]
  assert.match(boot, /localStorage\.setItem\('kl_sf_fam', fam\?'1':'0'\)/)
  assert.match(boot, /if\(!fam&&typeof window\.klSfUndo==='function'\) window\.klSfUndo\(\);/)
  assert.match(boot, /window\.klSfUndo=function\(\)\{\r?\n  if\(window\.__klSfBooted\|\|!window\.__klSfPre\) return;/)
  assert.match(HTML, /function firstLoad\(\)\{ fetchLiveStock\(\)\.then\(function\(ok\)\{ if\(!ok\) sfFail\(\); klStockSettle\(\); \}, function\(\)\{ sfFail\(\); klStockSettle\(\); \}\); \}/)
})

test('return-visit CLS: the Gradient grid paints the remembered sold-out set; a different live set rebuilds the grid', () => {
  // the last answer's sold-out Gradient barcodes are remembered right after applyAll (every successful answer)
  assert.match(HTML, /hook\(\); applyAll\(\);\r?\n      try\{ localStorage\.setItem\('kl_sold', JSON\.stringify\(\{ t: Date\.now\(\), s: \(window\.DATA\|\|\[\]\)\.map\(function\(d\)\{return String\(d\.barcode\);\}\)\.filter\(function\(bc\)\{ return ladder\(bc\) && isSold\(bc\); \}\) \}\)\); \}catch\(e\)\{\}/)
  // every render before the first answer applies the memory, never after it
  assert.match(HTML, /function render\(list\)\{\r?\n  list=klPhotoFirst\(list\);\r?\n  grid\.innerHTML=''; list\.forEach\(\(d,i\)=>grid\.appendChild\(card\(d,i\)\)\); if\(typeof syncLimits==='function'\) syncLimits\(\);\r?\n  klPreSold\(\);/)
  const pre = HTML.match(/const KL_SOLD_MEM=[\s\S]*?\r?\nfunction klPreSold\(\)\{[\s\S]*?\r?\n\}\r?\n/)[0]
  assert.match(pre, /Date\.now\(\)-Number\(m\.t\)<7\*864e5/, 'memory older than 7 days is ignored')
  assert.match(pre, /if\(window\.__klStockSettled\|\|\(window\.klStockReady&&window\.klStockReady\(\)\)\) return;/)
  const settle = HTML.match(/function klStockSettle\(\)\{[\s\S]*?\r?\n  \}\r?\n/)[0]
  assert.match(settle, /if\(!loaded\)\{ document\.querySelectorAll\('\[data-kl-pre\]'\)\.forEach\(function\(e\)\{ e\.classList\.remove\('sold-out'\); \}\); \}/, 'fail open: no live data = every shade shown, as before')
  assert.match(settle, /c\.hasAttribute\('data-kl-pre'\)!==\(ladder\(bcOf\(c\)\)&&isSold\(bcOf\(c\)\)\)/, 'rebuild only when the live set differs from the painted one')
  assert.match(settle, /window\.render\(typeof active!=='undefined'&&active\?D\.filter\(function\(d\)\{return d\.color_en===active;\}\):D\)/, 'the rebuild keeps the colour filter')
  assert.match(HTML, /setTimeout\(klStockSettle, 8000\);/)
  assert.match(HTML, /function firstLoad\(\)\{ fetchLiveStock\(\)\.then\(function\(ok\)\{ if\(!ok\) sfFail\(\); klStockSettle\(\); \}, function\(\)\{ sfFail\(\); klStockSettle\(\); \}\); \}/)
  // behaviour: run klPreSold on a tiny grid
  const mk = (bc) => { const c = { cls: new Set(), attrs: {}, classList: null }; c.classList = { add: (x) => c.cls.add(x) }; c.setAttribute = (k, v) => { c.attrs[k] = v }; return { dataset: { bc }, closest: () => c, card: c } }
  const runPre = (stored, settled) => {
    const btns = ['1074', '1266'].map(mk)
    const grid = { querySelectorAll: () => btns }, swatchbar = { querySelectorAll: () => [] }
    new Function('window', 'localStorage', 'grid', 'swatchbar', 'DATA', pre + '; klPreSold();')({ __klStockSettled: settled }, { getItem: () => stored }, grid, swatchbar, [])
    return btns.filter((b) => b.card.cls.has('sold-out') && b.card.attrs['data-kl-pre'] === '').map((b) => b.dataset.bc)
  }
  assert.deepEqual(runPre(null, false), [], 'first visit: everything painted (the first answer rebuilds the grid)')
  assert.deepEqual(runPre(JSON.stringify({ t: Date.now(), s: ['1074'] }), false), ['1074'], 'return visit: last answer painted at once')
  assert.deepEqual(runPre(JSON.stringify({ t: Date.now() - 8 * 864e5, s: ['1074'] }), false), [], 'stale memory ignored')
  assert.deepEqual(runPre(JSON.stringify({ t: Date.now(), s: ['1074'] }), true), [], 'after the first answer the live data decides')
})

test('pre-paint: the layout runs right after the hero and is finished right after the Gradient panel (no later move)', () => {
  assert.match(HTML, /<\/header>\r?\n<script>[\s\S]*?\/\*KL-SF-LAYOUT-START\*\//)
  assert.match(HTML, /<\/main>\r?\n<script>[^\n]*\r?\ntry\{ if\(window\.__klSfPre&&window\.klSfL\)\{ klSfL\.sfLayout\(document, null, klSfL\.vis\); klSfL\.sfBundleChip\(document\); klSfL\.sfGradSubs\(document\); \} \}catch\(e\)\{\}<\/script>/)
  // part 1 sees only the page up to the hero; part 2 the whole first screen: same result as one call
  const doc = pageDoc()
  const pal = doc.querySelector('#palette'), fam = doc.querySelector('#klFam'), tw = doc.querySelector('.trustband').parentNode, sb = doc.querySelector('.swatchbar')
  const later = [tw, sb, pal, fam]; later.forEach((e) => e._detach())                    // not parsed yet
  sfLayout(doc, tabbar(), ['gradient', 'bracelets', 'necklaces'])
  assert.equal(doc.querySelector('#klInfo'), null, '#klInfo waits (detached) until the grid exists')
  assert.ok(doc.__klInfo.querySelector('.launchfee') && !doc.querySelector('.hero .launchfee'))
  later.forEach((e) => doc.body.appendChild(e))                                          // parsed
  sfLayout(doc, null, ['gradient', 'bracelets', 'necklaces'])
  const o = order(doc)
  assert.deepEqual(o.slice(0, 4), ['div.announce', 'nav', 'nav.kl-tabbar', 'header.hero'])
  assert.ok(o.indexOf('#klInfo') > o.indexOf('#klFam'), o.join(' > '))
  for (const s of ['.launch', '.launchfee', '.stars', '.trustband', '.tb-legal']) assert.ok(doc.querySelector('#klInfo').querySelector(s), s)
  assert.equal(doc.querySelector('.hero-copy p').textContent, 'Bracelets and necklaces. Build your own stack.')
  sfLayout(doc, tabbar())                                                                 // storefront.js re-run: idempotent
  assert.deepEqual(order(doc), o, 'a second call (even with a new bar) changes nothing: one chip bar, one #klInfo')
  assert.equal(doc.querySelectorAll('#klInfo').length, 1)
  assert.equal(doc.querySelector('.hero-copy p').textContent, 'Bracelets and necklaces. Build your own stack.', 'the line is set once (renderTabs owns it later)')
})

test('families OFF after a pre-paint layout: sfUnlayout gives back today\'s page exactly (order, texts, M1 key, notice)', () => {
  const sfUnlayout = new Function(`${LAYOUT}; return sfUnlayout;`)()
  const snap = (doc) => JSON.stringify([...doc.body.walk()].filter((e) => e.tagName !== '#TEXT')
    .map((e) => [e.tagName, e.id, e.className, !!e.hidden, e.attrs['data-kl-m1'] || '', e.parentNode.tagName, e.textContent.replace(/\s+/g, ' ').trim()]))
  const ref = pageDoc(); ref.querySelector('#klFam')._detach(); const W0 = xmasApi(ref); W0.klXmasApply(XC)
  const doc = pageDoc(); doc.querySelector('#klFam')._detach()
  const p0 = doc.querySelector('.hero-copy p').textContent
  sfLayout(doc, tabbar(), ['gradient', 'bracelets', 'necklaces'])
  xmasApi(doc).klXmasApply(XC)                                                           // notice lands in #klInfo meanwhile
  assert.ok(doc.querySelector('#klInfo #klXmasHero'))
  sfUnlayout(doc)
  assert.equal(doc.querySelector('.kl-tabbar'), null); assert.equal(doc.querySelector('#klInfo'), null)
  assert.equal(doc.querySelector('.hero-copy p').textContent, p0)
  assert.equal(doc.querySelector('.hero-copy p').getAttribute('data-kl-m1'), 'herop', 'M1 can set the hero line again')
  assert.equal(doc.querySelector('.hero-copy p').getAttribute('data-kl-p0'), null)
  assert.equal(snap(doc), snap(ref))
})

test('pre-paint css: nodes waiting to move out of the hero are never painted there first', () => {
  assert.match(CSS, /html\.kl-v2 \.hero \.launch, html\.kl-v2 \.hero \.launchfee, html\.kl-v2 \.hero \.kl-xmas-hero, html\.kl-v2 \.hero-copy \.stars,\r?\nhtml\.kl-v2 \.hero \.cta, html\.kl-v2 \.hero-copy \.k, html\.kl-v2 body > \.kl-trust\{display:none\}/)
  assert.match(HTML, /<div class="wrap kl-trust">\r?\n  <div class="trustband">/)
  // storefront.js binds the pre-built bar instead of building a second one, and keeps the pre-built bundle chip
  assert.match(SF, /var nav = \$\('nav\.kl-tabbar'\) \|\| KL\.sfBar\(document, \['gradient'\], null, 'gradient'\);/)
  assert.match(SF, /KL\.sfBundleChip\(document\);/)
  assert.match(SF, /localStorage\.setItem\('kl_sf_tabs', JSON\.stringify\(\{ v: vis, n: seen,/)
})

test('unfaithful Gradient renders withdrawn: 1266 1267 1269 1271 1272 1302 1310 show a colour tile, never the render', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  for (const bc of ['1266', '1267', '1269', '1271', '1272', '1302', '1310']) {
    assert.match(html, new RegExp(`\{"barcode": "${bc}"[^}]*"img": "/img/tone/${bc}\.svg"`), bc)
    assert.ok(!existsSync(new URL(`../img/gradient/${bc}.jpg`, import.meta.url)), 'render file removed ' + bc)
  }
  assert.match(html, /colour tile, not a photo/)
})

test('render audit 2 (23 Nov): hero = 1268 (2-referee PASS; 1074 unverifiable), 1470 render withdrawn (flower charm differs)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<img id="heroImg" src="\/img\/gradient\/1268\.jpg"/)
  assert.match(html, /const hero=DATA\.find\(d=>d\.barcode==='1268'\)\|\|DATA\[0\];/)
  const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards
  const c = cards.find((x) => x.barcode === '1470')
  assert.equal(c.photo, null); assert.equal(c.photo_qc, false)
  assert.ok(!existsSync(new URL('../img/fam/1470.jpg', import.meta.url)))
})

test('G9 exception: 1470 stays sellable as a colour tile; modal + bag thumbnail alt follow the product (K&D #64 N2/N3)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards
  const c = cards.find((x) => x.barcode === '1470')
  assert.equal(c.tile_sellable, true)
  assert.match(SF, /photoOk: !!\(c\.photo && c\.photo_qc\) \|\| \(c\.tab !== 'rings' && c\.tile_sellable === true\),/)   // rings: photo first (K-069)
  assert.match(SF, /aria-label="' \+ sfEsc\(c\.name\) \+ ' colour tile, not a photo"/)
  assert.doesNotMatch(html, /<img id="mImg" alt="product">[\s\S]*?mi\.alt=undefined/)
  assert.match(html, /mi\.alt=imgAlt\(d\);/)
  assert.match(html, /<img src="\$\{d\.img\}" alt="\$\{imgAlt\(d\)\}">/)
  const imgAlt = new Function(html.match(/function imgAlt\(d\)\{[^\n]*\}/)[0] + '; return imgAlt;')()
  assert.equal(imgAlt({ img: '/img/tone/1267.svg', color_en: 'Baby Pink' }), 'Baby Pink colour tile, not a photo')
  assert.equal(imgAlt({ img: '', color_en: 'Pink Blossom', family: true }), 'Pink Blossom colour tile, not a photo')
  assert.equal(imgAlt({ img: '/img/gradient/1268.jpg', color_en: 'Ice Blue' }), 'Ice Blue bracelet, worn')
})

test('famState still passes live sellable qty (guards against a comment swallowing the sellable: key)', () => {
  const fn = SF.match(/function famState\(c\) \{[\s\S]*?\n  \}/)[0]
  assert.match(fn, /\r?\n\s+sellable: window\.klAvail \? window\.klAvail\(c\.barcode\) : 0,/)
})

test('line labels match the real product (Komuta 23 Nov): 6159 Chip Bead Necklace (no charm), 0624 Stretch Bracelet (single strand)', () => {
  const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards
  const by = Object.fromEntries(cards.map((c) => [c.barcode, c]))
  assert.equal(by['6159'].line, 'Chip Bead Necklace')
  assert.equal(by['0624'].line, 'Cube Bead Stretch Bracelet')
  assert.equal(by['6180'].line, 'Charm Necklace'); assert.equal(by['6170'].line, 'Charm Necklace')
  // K-069 ring style names given by the lead (31_rings_ui_spec): 'Stone Chip' / 'Raw Stone Look' describe a look, not a
  // material; this exact pair is the only exception (K&D to confirm before the Rings tab goes live)
  const RING_LOOK = /^(Stone Chip|Raw Stone Look) Ring$/
  for (const c of cards) if (!(c.tab === 'rings' && RING_LOOK.test(c.line))) assert.doesNotMatch(c.line, /stone|onyx|quartz|crystal/i, c.barcode)
})

test('og-image.jpg exists (was 404) and is a 1200x630 JPEG; alt has no product or material claim', () => {
  const buf = readFileSync(new URL('../og-image.jpg', import.meta.url))
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8)
  let i = 2, w = 0, h = 0
  while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue } const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xc3) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break } i += 2 + len }
  assert.deepEqual([w, h], [1200, 630])
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const alt = html.match(/<meta property="og:image:alt" content="([^"]*)">/)[1]
  assert.doesNotMatch(alt, /crystal|glass|stone|hair/i)
})

test('one line label = one family (so one online price group): no shared name across groups (K&D #65 post-hoc, 0624)', () => {
  const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards
  const fam = {}
  for (const c of cards) (fam[c.line] = fam[c.line] || new Set()).add(c.family)
  for (const [line, s] of Object.entries(fam)) assert.equal(s.size, 1, `${line}: ${[...s].join(', ')}`)
})

test('photo first: real photos / passed renders before colour tiles on every tab, stable otherwise (Komuta 23 Nov)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const fn = new Function(html.match(/function klPhotoFirst\(list\)\{[^\n]*\}/)[0] + '; return klPhotoFirst;')()
  const L = [{ b: 1, img: '/img/tone/1.svg' }, { b: 2, img: '/img/gradient/2.jpg' }, { b: 3, img: '/img/tone/3.svg' }, { b: 4, img: '/img/gradient/4.jpg' }]
  assert.deepEqual(fn(L).map((d) => d.b), [2, 4, 1, 3])
  assert.match(html, /function render\(list\)\{\r?\n  list=klPhotoFirst\(list\);/)
  assert.match(SF, /SF_ORDER\[a\.s\] - SF_ORDER\[b\.s\] \|\| \(a\.c\.photo \? 0 : 1\) - \(b\.c\.photo \? 0 : 1\) \|\| a\.i - b\.i/)
})

test('meta description: dispatch time and delivery time are not merged into one "Shipped in 2–5 days" claim (Marketing 23 Nov)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const d = html.match(/<meta name="description" content="([^"]*)">/)[1]
  assert.doesNotMatch(d, /Shipped in 2–5 days/)
  assert.match(d, /Ships within 1–2 business days; UK delivery usually 2–5 business days after dispatch\./)
})
