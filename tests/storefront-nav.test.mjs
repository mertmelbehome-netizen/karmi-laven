// Families view, category findability fix (23 Nov, morning_review/15_nav_findability):
//   F1 chips right under the logo/Bag row, before the hero; F2 one sticky row <= 56 px, the colour bar sticks under it
//   (desktop) or not at all (<= 840 px); F3 hero = H1 + one short line, the price/delivery line, Christmas notice, Melbe
//   line, trust strip and company/VAT line MOVED (not deleted) to one block after the grids; F4 short chip labels;
//   F7 dead eyebrow hidden. CMA209: every priced card and the bag keep "£1.49 UK delivery · free with any 10+ items".
// The layout code (js/storefront.js KL-SF-LAYOUT block) and js/christmas.js run as-is against a small DOM built from
// the real index.html markup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CSS = read('../css/storefront.css')
const XMAS = read('../js/christmas.js')
const LAYOUT = SF.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
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
  const src = HTML.slice(from, to)
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
  const shown = hc.children.filter((e) => e.tagName !== '#TEXT' && !e.hidden && !e.classes.includes('spectrum'))
  assert.deepEqual(shown.map((e) => e.tagName), ['H1', 'P'])
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
  assert.deepEqual(core.SF_CHIP, { gradient: 'Gradient', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair' })
  assert.equal(core.SF_TITLE.gradient, 'The Gradient Edit')
  assert.match(SF, /role="tab" type="button" id="kltab-' \+ t \+ '"[^\n]*aria-selected[^\n]*SF_CHIP\[t\]/)
  assert.match(SF, /\['ArrowRight', 'ArrowLeft', 'Home', 'End'\]/)
})

test('CMA209: every priced card (Gradient + family) and the bag keep the delivery fee with the 10+ free condition', () => {
  // Gradient card template: the delivery line sits right under the price
  assert.match(HTML, /<div class="pr">\$\{m1On\(\)\?m1PriceHtml\(d\.barcode\):pt\}<\/div>\s*<div class="fee" data-kl="cardship">\$\{cardShipText\(\)\}<\/div>/)
  assert.match(HTML, /function cardShipText\(\)\{[^\n]*'\+ '\+gbpP\(SHIP\.feeP\)\+' UK delivery'\+\(SHIP\.freeQty\?' · free with any '\+SHIP\.freeQty\+'\+ items':''\)/)
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
