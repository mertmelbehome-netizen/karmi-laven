// basket-1 (shopper tests 26 Nov + K&D): adding never opens the bag (K&D 4, OPENING GATE), the tapped card says 'Added ✓' and
// nothing scrolls (U3), one add label + >= 44 px targets (U4), the bag's item list keeps room (K&D 5), and with 7-9 items the
// sticky bar's main line is 'Add N more → total £X' (K&D 8), X from the same pricing the bag uses (= api/checkout.js).
// Helpers (fnSrc / page / server) follow tests/bag-group-hint.test.mjs. Barcodes: A £5 6008, B £8 1074, C £13 81004.
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
  const glue = ['m1Foot', 'm1LineText', 'itemWord', 'totalQty', 'subtotal', 'updateBag', 'addToCart', 'markAdded', 'hideAddBar', 'showAddBar', 'viewBagFromAddBar', 'addedFeedback', 'addedLabel']
    .map((n) => fnSrc(HTML, n)).join('\n')
  const stubs = `let cart=[], addBarT=null, colours=[];
const atLimit=()=>false, addToCartSilent=(bc)=>{ const f=cart.find(c=>c.bc===bc); if(f) f.qty++; else cart.push({bc,qty:1}); },
 save=()=>{}, renderCart=()=>{}, openCart=()=>{ calls.open++; }, track=()=>{}, flTrack=()=>{}, kl=()=>{}, syncLimits=undefined;
const setTimeout=(f,ms)=>{ calls.timers.push({f,ms}); return calls.timers.length; }, clearTimeout=()=>{};`
  const p = new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', 'document', 'NA_TXT', 'calls',
    `${stubs}\n${b.pricing}\n${b.delivery}\n${b.m1}\n${glue}\n; return { setCart: (c) => { cart = c }, getCart: () => cart, applyLadderShipping, addToCart, updateBag, m1Summary, viewBagFromAddBar };`)(BY, LADDER_TYPES, PRICE, window, doc, 'n/a', calls)
  p.applyLadderShipping(VIEW)
  return { p, doc, calls }
}
const mkBtn = (bc, text) => mkEl({ textContent: text, dataset: { bc }, attrs: { 'data-kl-add': '' } })

// ---------- K&D 4: no drawer on add; toast text + aria-live; the drawer opens from the bag ----------
test('K&D 4: addToCart no longer opens the drawer (source) and calls the add bar', () => {
  assert.doesNotMatch(fnSrc(HTML, 'addToCart'), /openCart\(/)
  assert.match(fnSrc(HTML, 'addToCart'), /addedFeedback\(bc\)/)
})
test('K&D 4: adding does not open the drawer; the bar reads "Added · Bag (N)" with a View button; it hides after ~2.5 s', () => {
  const { p, doc, calls } = page()
  p.setCart([]); p.addToCart(A); p.addToCart(B)
  assert.equal(calls.open, 0, 'drawer must stay closed')
  const bar = doc.getElementById('addBar')
  assert.ok(bar.cls.has('show'))
  assert.match(bar.innerHTML, /Added · Bag \(2\)/)
  assert.match(bar.innerHTML, /<button[^>]*class="ab-view"[^>]*>View<\/button>/)
  const hide = calls.timers.filter((t) => t.ms === 2500)
  assert.equal(hide.length, 2, 'a 2.5 s dismiss timer per add (re-armed)')
  hide[hide.length - 1].f()
  assert.ok(!bar.cls.has('show'))
})
test('K&D 4: the drawer opens only from the bag button / sticky "View bag" / the bar\'s View', () => {
  const { p, doc, calls } = page()
  p.addToCart(A)
  assert.equal(calls.open, 0)
  assert.match(doc.getElementById('addBar').innerHTML, /onclick="viewBagFromAddBar\(\)"/)
  assert.match(HTML, /<button class="bagbtn" onclick="openCart\(\)">/)
  assert.match(HTML, /id="stickyCart" onclick="openCart\(\)"/)
  p.viewBagFromAddBar()
  assert.equal(calls.open, 1)
  assert.ok(!doc.getElementById('addBar').cls.has('show'))
})
test('K&D 4: the bar is an aria-live polite status region that is always in the page', () => {
  assert.match(HTML, /<div class="addbar" id="addBar" role="status" aria-live="polite" aria-atomic="true"><\/div>/)
})
test('K&D 4: the bar sits above the sticky bar, lets taps through (only View takes them), and has a reduced-motion rule', () => {
  const rule = HTML.match(/\.addbar\{([^}]*)\}/)[1]
  assert.match(rule, /bottom:calc\(var\(--bar-h,84px\) \+ 8px\)/, 'clears the measured sticky bar (375x812 and 390x844)')
  assert.match(rule, /pointer-events:none/)
  assert.match(rule, /z-index:56/)
  assert.match(HTML, /\.addbar \.ab-view\{[^}]*pointer-events:auto[^}]*min-height:44px/)
  assert.match(HTML, /@media \(prefers-reduced-motion: reduce\)\{\.addbar\{transition:none; transform:none\}\}/)
  assert.match(HTML, /\.addbar \.ab\{[^}]*min-height:44px/)
  assert.match(HTML, /\.stickybar\{position:fixed; left:0; right:0; bottom:0; z-index:55/)
})

// ---------- U3: no scroll; 'Added ✓' on the tapped card for ~1.5 s ----------
test("U3: add from a list does not scroll the page; the card button says 'Added ✓' for 1.5 s, then restores its text", () => {
  const { p, doc, calls } = page()
  const b1 = mkBtn(A, 'Add to bag — £5'), b2 = mkBtn(B, 'Add to bag — £8'); doc.buttons = [b1, b2]
  p.addToCart(A)
  assert.equal(calls.scroll, 0, 'no scrollTo / scrollBy on add')
  assert.equal(b1.textContent, 'Added ✓'); assert.ok(b1.cls.has('is-added'))
  assert.equal(b2.textContent, 'Add to bag — £8', 'other cards are untouched')
  const t = calls.timers.find((x) => x.ms === 1500); assert.ok(t)
  t.f()
  assert.equal(b1.textContent, 'Add to bag — £5'); assert.ok(!b1.cls.has('is-added'))
})
test('U3: the add path has no scroll / focus call, and the family grid keeps the Added text through its in-place refresh', () => {
  for (const n of ['addToCart', 'markAdded', 'showAddBar', 'addedFeedback']) assert.doesNotMatch(fnSrc(HTML, n).replace(/\/\/.*$/gm, '').replace(/showAboveBand/g, ''), /scroll|focus\(/i, n)   // addToCart's at-limit branch may use showAboveBand (unchanged)
  assert.match(SFJS, /data-kl-added'\) === '1'\) \{ b\.setAttribute\('data-kl-was'/)
  assert.match(HTML, /\.cbody \.add\.is-added/)
})

// ---------- U4: one label, >= 44 px ----------
test('U4: every add button reads "Add to bag" (cards, modal, bag nudge); no "＋ Add" / "+ ADD" left; one uppercase style', () => {
  assert.ok(!HTML.includes('＋ Add') && !SFJS.includes('＋ Add'))
  assert.equal((HTML.match(/class="nudge-add"/g) || []).length, 3, 'nudgeBtn() + its two generic fallbacks in the footer (no named product)')
  assert.match(HTML, /return 'Add to bag'; const nm=/, 'label falls back to Add to bag only when no product can be named')
  assert.match(HTML, /'Add 1 more '\+nm : 'Quick add: '\+nm/, '27 Nov: Add 1 more only when it completes the 10; otherwise Quick add')
  assert.match(HTML, /id="mAdd"[^>]*>Add to bag</)
  assert.match(SFJS, /'Add to bag — '/)
  for (const sel of ['\\.cbody \\.add', '\\.modal \\.madd', '\\.nudge-add']) assert.match(HTML, new RegExp(sel + '\\{[^}]*text-transform:uppercase'), sel)
})
test('U4: card, modal and nudge add buttons are >= 44 px tall', () => {
  assert.match(A11Y, /\.sw, \.btn, \.cbody \.add, \.madd,[^{]*\{ min-height:44px \}/)
  assert.match(A11Y, /\.nudge-add\{[^}]*min-height:44px/)
  assert.match(SFCSS, /html\.kl-v2 \.cbody \.add\{min-height:44px\}/)
})

// ---------- K&D 5: the bag's list keeps room ----------
test('K&D 5: the bag item list has a min-height and the footer gives room back (>= 3 text lines of items at 375x812)', () => {
  const list = HTML.match(/\.cart \.cart-items\{([^}]*)\}/)[1], foot = HTML.match(/\.cart \.cart-foot\{([^}]*)\}/)[1]
  assert.match(list, /min-height:min\(260px,36dvh\) !important/)
  assert.match(list, /flex:1 0 min\(260px,36vh\)/, 'flex-shrink 0: the list is never squeezed by the footer')
  assert.match(foot, /flex:0 1 auto/)
  assert.match(foot, /max-height:calc\(100dvh - 84px - min\(260px,36dvh\)\)/)
  const h = 812, listMin = Math.min(260, 0.36 * h)
  assert.ok(listMin >= 3 * 24, 'room for three text lines of an item row (name, price line, quantity row)')
})

// ---------- K&D 8: 7-9 items -> 'Add N more → total £X' ----------
const mkDb = () => async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null
  const ok = (b) => ({ ok: true, status: 200, json: async () => b })
  if (url.includes('/product_barcodes?')) return ok(decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',').map((b) => ({ barcode: b, product_id: 'p' + b })))
  if (url.includes('/stock_levels?')) return ok(url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((x) => ({ product_id: x, stockroom_count: 50 })))
  if (url.includes('/online_orders?')) return ok([])
  if (url.includes('/rpc/fn_karmi_checkout_reserve')) return ok({ ok: true, ref: 'r', short_session: true, recovery_ok: false,
    lines: body.p_items.map((i) => ({ bc: i.bc, product_id: 'p', online_group: DBGROUP[i.bc], price_pence: null, name: NAME[i.bc] })) })
  return ok(1)
}
async function server(items) {
  const stripe = { created: [], checkout: { sessions: { create: async (x) => { stripe.created.push(x); return { id: 'cs', url: 'u' } } } } }
  const h = createHandler({ stripe, ladders: LADDERS, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: mkDb(), now: () => new Date('2026-11-26T12:00:00Z') })
  let status
  const res = { status(c) { status = c; return this }, json() { return this }, end() { return this } }
  await h({ method: 'POST', headers: {}, body: { items }, query: {} }, res)
  assert.equal(status, 200)
  const s = stripe.created[0]
  const lines = s.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0)
  const ship = s.shipping_options[0].shipping_rate_data.fixed_amount.amount
  return { items: lines, ship, total: lines + ship }
}
const gbp = (pence) => '£' + (pence / 100).toFixed(2)
// [lines, padBc]: the engine fills the missing items at the cheapest 10+ price in the bag (pad group)
const BARS = {
  '7 x A (£5 group)': [[[A, 7]], A],
  '8 x B (Gradient)': [[[B, 8]], B],
  '9 mixed (3A 3B 3C), cheapest 10+ price = A': [[[A, 3], [B, 3], [C, 3]], A],
  '8 mixed (3B 5C), cheapest 10+ price = B': [[[B, 3], [C, 5]], B],
  '9 x C (£13 group)': [[[C, 9]], C],
  '9 x A (£45: free delivery now, not after the unlock)': [[[A, 9]], A],
  '7 x B (Gradient)': [[[B, 7]], B],
  '7 x C (£13 group)': [[[C, 7]], C],
}
for (const [name, [lines, pad]] of Object.entries(BARS)) {
  test('K&D 8 bar ' + name + ': main line "Add N more → total £X", X = api/checkout.js at 10 items', async () => {
    const { p, doc } = page()
    p.setCart(lines.map(([bc, qty]) => ({ bc, qty })))
    p.updateBag()
    const units = lines.reduce((a, [, q]) => a + q, 0), N = 10 - units
    const full = lines.map(([bc, qty]) => ({ bc, qty: bc === pad ? qty + N : qty }))
    const sv = await server(full)
    const info = doc.getElementById('stickyInfo')
    assert.ok(units >= 7 && units <= 9 && N >= 1 && N <= 3)
    const main = info.innerHTML.match(/^<b>(.*?)<\/b>/)[1]
    assert.equal(main, 'Add ' + N + ' more → ' + gbp(sv.items) + (sv.ship > 0 ? ' + ' + gbp(sv.ship) + ' delivery' : ' with free delivery'))   // amounts = api/checkout.js at 10 items
    assert.ok(!/total/.test(main))
    if (sv.ship > 0) assert.ok(!/free/i.test(main), 'no free claim when the unlocked bag pays delivery')
    const s = p.m1Summary(p.getCart())
    assert.match(info.innerHTML, new RegExp('<span class="dl">Bag ' + gbp(s.charged_pence + s.shipping_pence) + '( inc\. £\d+\.\d\d delivery)?</span>$'), "the bag's own running total stays visible")
    assert.ok(!/free UK delivery ✓/.test(info.innerHTML), "the current bag's delivery status is not shown in near mode")
    assert.equal(Number(info.dataset.klTotalP), s.charged_pence + s.shipping_pence, 'the measured bag total is unchanged')
  })
}
test('K&D 8: outside 7-9 items the bar keeps "Bag £total" (6 items, 10 items)', () => {
  for (const q of [6, 10]) {
    const { p, doc } = page()
    p.setCart([{ bc: A, qty: q }]); p.updateBag()
    assert.match(doc.getElementById('stickyInfo').innerHTML, /^Bag <b>£\d+\.\d\d<\/b>/, q + ' items')
  }
})
test('K&D 8: 9 x £5 = £45 ships free now but the 10-item bag (£15) pays £3.99: the line says so, with no "free"', async () => {
  const { p, doc } = page()
  p.setCart([{ bc: A, qty: 9 }]); p.updateBag()
  const sv = await server([{ bc: A, qty: 10 }])
  assert.deepEqual([sv.items, sv.ship], [1500, 399])
  const info = doc.getElementById('stickyInfo').innerHTML
  assert.equal(info, '<b>Add 1 more → £15.00 + £3.99 delivery</b><span class="dl">Bag £45.00</span>')
})
test('K&D 8: the bar number comes from the engine (unlock_total_pence) - no second price calculation in updateBag', () => {
  const src = fnSrc(HTML, 'updateBag')
  assert.match(src, /us\.unlock_total_pence/)
  assert.doesNotMatch(src, /tier_each/)
})

// ---------- New-drop alerts pop-up never opens mid-shop ----------
function popup({ cart, drawerOpen = false, lastAddAt = 0, shown = '0' }) {
  const i = HTML.indexOf('/* EMAIL POPUP'), src = HTML.slice(i, HTML.indexOf('</script>', i))
  const els = {}, g = (id) => els[id] || (els[id] = mkEl())
  if (drawerOpen) g('cart').cls.add('open')
  const store = { klpop_shown: shown }, timers = []
  const win = { klLastAddAt: lastAddAt, matchMedia: () => ({ matches: false }) }
  new Function('document', 'window', 'localStorage', 'cart', 'setTimeout', 'clearTimeout',
    src.replace(/^\/\*[^\n]*\*\/\n/, ''))(
    { getElementById: g, addEventListener() {}, documentElement: { scrollHeight: 0 }, visibilityState: 'visible' }, win,
    { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) } }, cart, (f) => { timers.push(f); return 1 }, () => {})
  return { open: () => win.openEmailPopup(), opened: () => g('klpop').cls.has('open'), store }
}
test('pop-up: opens as before on an empty-bag first visit (and records the 7-day memory)', () => {
  const pp = popup({ cart: [] }); pp.open()
  assert.ok(pp.opened()); assert.notEqual(pp.store.klpop_shown, '0')
})
test('pop-up: never opens with items in the bag, just after an add, or with the bag drawer open; the memory is untouched', () => {
  for (const o of [{ cart: [{ bc: A, qty: 1 }] }, { cart: [], lastAddAt: Date.now() - 3000 }, { cart: [], drawerOpen: true }]) {
    const pp = popup(o); pp.open()
    assert.ok(!pp.opened(), JSON.stringify(o)); assert.equal(pp.store.klpop_shown, '0')
  }
  assert.match(HTML, /function show\(\)\{ if\(shopping\(\)\) return; if\(busy\(\)\)/, 'a timer that fires mid-shop is dropped, not re-queued')
})

// ---------- sold-out cards: no placeholder / gap; heading hides when every card is gone ----------
test('sold-out cards are display:none (no 0x0 placeholder holding a grid cell); the heading hides when all are sold out', () => {
  assert.match(HTML, /\.card\.sold-out\{display:none !important\}/)
  assert.doesNotMatch(HTML, /\.card\.sold-out\{[^}]*(visibility:hidden|width:0|height:0|opacity:0)/)
  assert.match(HTML, /ch\.hidden=Array\.prototype\.every\.call\(gc,function\(c\)\{ return c\.classList\.contains\('sold-out'\); \}\)/)
  assert.match(HTML, /\.col-head\[hidden\]\{display:none\}/)
})
