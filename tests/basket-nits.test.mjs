// basket-nits (K&D non-blocking nits from the #105 walk): toast size, delivery claim guard, single nudge line, below-10 notice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, publicLadders } from '../api/_pricing.js'
import { createHandler } from '../api/checkout.js'
import { blocks, pageData } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HTML = read('../index.html'), A11Y = read('../css/a11y.css'), SFCSS = read('../css/storefront.css'), SFJS = read('../js/storefront.js')
const VIEW = publicLadders(LADDERS)
const A = '6008', A2 = '6002', B = '1074', C = '81004', C2 = '81006'
const DBGROUP = { [A]: 'A', [A2]: 'A', [C]: 'C', [C2]: 'C' }
const NAME = { [A]: 'Stretch Bracelet — Blush Daisy', [A2]: 'Stretch Bracelet — Sky', [C]: 'Sparkle Line — Gold-tone Swan', [C2]: 'Sparkle Line — Silver Star' }
const ALL = ['A', 'B', 'C']

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
const mkEl = (o = {}) => {
  const e = { textContent: '', _html: '', style: {}, dataset: {}, attrs: {}, cls: new Set(), disabled: false, ...o,
    setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return this.attrs[k] ?? null }, removeAttribute(k) { delete this.attrs[k] },
    classList: { add: (c) => e.cls.add(c), remove: (c) => e.cls.delete(c), contains: (c) => e.cls.has(c), toggle: (c, on) => { (on === undefined ? !e.cls.has(c) : on) ? e.cls.add(c) : e.cls.delete(c) } } }
  Object.defineProperty(e, 'innerHTML', { get() { return e._html }, set(v) { e._html = v; e.textContent = String(v).replace(/<[^>]*>/g, '') } })
  return e
}

// ---------- the page, evaluated as-is: pricing + M1 + the add / bar functions -------------
function page() {
  const BY = {}
  for (const d of pageData(HTML)) BY[d.barcode] = d
  for (const bc of [A, A2, C, C2]) BY[bc] = { barcode: bc, type: bc[0] === '6' ? 'Stretch Bracelet' : 'Sparkle Line', color_en: NAME[bc] }
  const byId = {}, doc = {
    getElementById: (id) => byId[id] || (byId[id] = mkEl()),
    querySelectorAll: (sel) => { const m = sel.match(/data-bc="([^"]+)"/); return m ? (doc.buttons || []).filter((b) => b.dataset.bc === m[1]) : [] },
    body: mkEl(), documentElement: mkEl(),
  }
  const PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])
  const LADDER_TYPES = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const calls = { open: 0, scroll: 0, timers: [] }
  const window = { klPrice: () => null, klGroup: (bc) => DBGROUP[bc] || null, klLadders: VIEW, klGroupList: () => ALL,
    scrollTo() { calls.scroll++ }, scrollBy() { calls.scroll++ }, innerHeight: 812 }
  const b = blocks(HTML)
  const glue = ['m1Foot', 'm1LineText', 'itemWord', 'totalQty', 'subtotal', 'updateBag', 'addToCart', 'tierOn', 'belowTenNote', 'changeQty', 'removeItem', 'toast', 'markAdded', 'hideAddBar', 'showAddBar', 'viewBagFromAddBar', 'addedFeedback', 'addedLabel']
    .map((n) => fnSrc(HTML, n)).join('\n')
  const stubs = `let cart=[], addBarT=null, toastT=null, colours=[], capQty=(bc,q)=>q;
const atLimit=()=>false, addToCartSilent=(bc)=>{ const f=cart.find(c=>c.bc===bc); if(f) f.qty++; else cart.push({bc,qty:1}); },
 save=()=>{}, renderCart=()=>{}, openCart=()=>{ calls.open++; }, track=()=>{}, flTrack=()=>{}, kl=()=>{}, syncLimits=undefined;
const setTimeout=(f,ms)=>{ calls.timers.push({f,ms}); return calls.timers.length; }, clearTimeout=()=>{};`
  const p = new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', 'document', 'NA_TXT', 'calls',
    `${stubs}\n${b.pricing}\n${b.delivery}\n${b.m1}\n${glue}\n; return { m1Foot, patchSummary: (f) => { const o = m1Summary; m1Summary = (l) => f(o(l)) }, changeQty, removeItem, setCart: (c) => { cart = c }, getCart: () => cart, applyLadderShipping, addToCart, updateBag, m1Summary, viewBagFromAddBar };`)(BY, LADDER_TYPES, PRICE, window, doc, 'n/a', calls)
  p.applyLadderShipping(VIEW)
  return { p, doc, calls }
}

const NEAR_NULL = (s) => ({ ...s, unlock_shipping_pence: null })

// ---------- (1) toast: compact pill, right-aligned, above the sticky bar ----------
test('nit 1: the Added toast is a compact right-aligned pill above the sticky bar, aria-live and reduced-motion kept', () => {
  const rule = HTML.match(/\.addbar\{([^}]*)\}/)[1]
  assert.match(rule, /left:auto/); assert.match(rule, /right:12px/); assert.match(rule, /justify-content:flex-end/)
  const mw = Number(rule.match(/max-width:(\d+)px/)[1]); assert.ok(mw <= 200, 'no wider than 200 px: <= ~53% of a 375 px screen, not full width')
  assert.match(rule, /bottom:calc\(var\(--bar-h,84px\) \+ 8px\)/)
  assert.doesNotMatch(rule, /left:12px/)
  assert.match(HTML, /\.addbar \.ab\{[^}]*font-size:12px/)
  assert.match(HTML, /\.addbar \.ab-view\{[^}]*min-height:44px/)
  assert.match(HTML, /<div class="addbar" id="addBar" role="status" aria-live="polite" aria-atomic="true"><\/div>/)
  assert.match(HTML, /@media \(prefers-reduced-motion: reduce\)\{\.addbar\{transition:none; transform:none\}\}/)
})

// ---------- (2) delivery claim only when unlock_shipping_pence === 0 ----------
const stickyOf = (patch) => { const { p, doc } = page(); if (patch) p.patchSummary(patch); p.setCart([{ bc: A, qty: 8 }]); p.updateBag(); return doc.getElementById('stickyInfo').innerHTML }
test('nit 2: unlock_shipping_pence null -> "Add N more -> £X" with no delivery claim', () => {
  const h = stickyOf(NEAR_NULL); assert.match(h, /^<b>Add 2 more → £[\d.]+<\/b>/); assert.doesNotMatch(h.match(/^<b>(.*?)<\/b>/)[1], /delivery/)
})
test('nit 2: undefined behaves like null; 0 -> "with free delivery"; >0 -> "+ £x delivery"', () => {
  const u = stickyOf((s) => { const c = { ...s }; delete c.unlock_shipping_pence; return c })
  assert.doesNotMatch(u.match(/^<b>(.*?)<\/b>/)[1], /delivery/)
  assert.match(stickyOf((s) => ({ ...s, unlock_shipping_pence: 0 })), /^<b>Add 2 more → £[\d.]+ with free delivery<\/b>/)
  assert.match(stickyOf((s) => ({ ...s, unlock_shipping_pence: 399 })), /^<b>Add 2 more → £[\d.]+ \+ £3\.99 delivery<\/b>/)
})

// ---------- (3) one 'Add N more' line at 9 items: the one above Secure Checkout (CTSI 20) ----------
test('nit 3: at 9 items the bag drawer says "Add 1 more" once, above Secure Checkout; the band keeps only the Add button', () => {
  const { p, doc } = page(); p.setCart([{ bc: A, qty: 9 }]); p.updateBag()
  p.m1Foot()
  const count = (h) => (h.match(/Add 1 more/g) || []).length
  const band = doc.getElementById('cartShip').innerHTML, near = doc.getElementById('cartM1Near')
  assert.equal(count(band), 0)
  assert.match(band, /class="nudge-add"/)
  assert.equal(count(near.innerHTML + near.textContent), 1)
  assert.equal(near.hidden, false)
})

// ---------- (4) 10+ -> below 10 notice ----------
const toastOf = (doc) => doc.getElementById('toast')
test('nit 4: removing one item 10 -> 9 shows "Bag now has 9 items: the 10+ price no longer applies" in an aria-live toast', () => {
  assert.match(HTML, /<div class="toast" id="toast" role="status" aria-live="polite"><\/div>/)
  for (const act of [(p) => p.changeQty(0, -1), (p) => { p.setCart([{ bc: A, qty: 9 }, { bc: B, qty: 1 }]); p.removeItem(1) }]) {
    const { p, doc } = page(); p.setCart([{ bc: A, qty: 10 }]); act(p)
    assert.equal(toastOf(doc).textContent, 'Bag now has 9 items: the 10+ price no longer applies')
    assert.ok(toastOf(doc).cls.has('show'))
  }
})
test('nit 4: 9 -> 8 and 12 -> 11 and emptying the bag show no notice', () => {
  const a = page(); a.p.setCart([{ bc: A, qty: 9 }]); a.p.changeQty(0, -1); assert.equal(toastOf(a.doc).textContent, '')
  const b = page(); b.p.setCart([{ bc: A, qty: 12 }]); b.p.changeQty(0, -1); assert.equal(toastOf(b.doc).textContent, '')
  const c = page(); c.p.setCart([{ bc: A, qty: 10 }]); c.p.removeItem(0); assert.equal(toastOf(c.doc).textContent, '')
})
