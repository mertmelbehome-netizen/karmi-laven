// Storefront PR-2: category tabs + family cards + bag progress line, all behind a flag that is OFF by default.
//   1. Flag OFF = today's page: api/_storefront.js defaults, /api/stock serves storefront.families=false, the page's boot
//      switch loads nothing, ladders.json still has the progress line off.
//   2. The pure storefront logic (js/storefront.js KL-SF-CORE block, evaluated as-is): pool keys, from-badge, card states,
//      progress line, visible tabs, all numbers from the served table (never hard-coded); no %/save/was language.
//   3. Page = server on family pools: the page cartTotal with a served table that HAS family pools (fixture A) equals
//      api/_pricing.js priceUnits on the same table; with the live table (no family pools) it is n × single.
//   4. Data/perf guards: cards.json identity rules, no base64 images in index.html, every image file exists, no
//      import.meta in api/*.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { DEFAULTS, storefrontConfig } from '../api/_storefront.js'
import stockHandler from '../api/stock.js'
import { loadLadders, publicLadders, priceUnits, LADDERS } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { buildCards, FORBIDDEN } from '../scripts/gen-cards.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { SF_TABS, sfMoney, sfPoolKey, sfPoolTotal, sfFromBadge, sfState, sfProgress, sfVisibleTabs, sfEsc };`)()
const LIVE = publicLadders()
const A = publicLadders(loadLadders(JSON.parse(read('./fixtures/ladders.A.json'))).table)
const CARDS = JSON.parse(read('../data/cards.json'))
const BAD = /(save|%|was\s*£|£\s*0(\.00)?\b|best price|cheapest|hurry|only today|launch price)/i

// ---------- 1. flag OFF by default ----------

test('storefront flags default OFF; env switch accepts only explicit values', () => {
  assert.equal(DEFAULTS.families, false)
  assert.equal(storefrontConfig({}).families, false)
  for (const v of ['on', 'ON', '1', 'true', 'yes']) assert.equal(storefrontConfig({ KARMI_STOREFRONT_FAMILIES: v }).families, true, v)
  for (const v of ['off', '0', 'false', 'no', '', 'maybe', 'onn']) assert.equal(storefrontConfig({ KARMI_STOREFRONT_FAMILIES: v }).families, false, v)
  assert.equal(storefrontConfig({ KARMI_STOREFRONT_SOLD_OUT: 'hide' }).sold_out, 'hide')
  assert.equal(storefrontConfig({ KARMI_STOREFRONT_SOLD_OUT: 'x' }).sold_out, DEFAULTS.sold_out)
})

test('/api/stock serves storefront.families = false by default (additive field, existing fields unchanged)', async () => {
  const save = { ...process.env }
  delete process.env.OPS_SUPABASE_URL; delete process.env.OPS_SUPABASE_SERVICE_KEY; delete process.env.KARMI_STOREFRONT_FAMILIES
  try {
    let body
    const res = { setHeader() {}, status(c) { this.code = c; return this }, json(b) { body = b; return this } }
    await stockHandler({ query: {} }, res)
    assert.equal(res.code, 200)
    assert.deepEqual(Object.keys(body), ['ok', 'store', 'stock', 'error', 'ladders', 'storefront'])
    assert.equal(body.storefront.families, false)
    assert.ok(body.ladders && body.ladders.ui.progress_line === false, 'live table: progress line off')
  } finally { Object.assign(process.env, save) }
})

/** the page's boot switch (index.html KL-SF-BOOT block) against a stub DOM */
function boot(data, href = 'https://www.karmilaven.com/') {
  const added = []
  const el = (tag) => ({ tag })
  const document = { createElement: el, head: { appendChild: (e) => added.push(e) }, body: { appendChild: (e) => added.push(e) } }
  const window = {}
  const u = new URL(href)
  const location = { hostname: u.hostname, search: u.search }
  const block = HTML.match(/\/\*KL-SF-BOOT-START\*\/([\s\S]*?)\/\*KL-SF-BOOT-END\*\//)[1]
  new Function('window', 'document', 'location', block)(window, document, location)
  window.klStorefrontBoot(data)
  return { added: added.map((e) => e.src || e.href), cfg: window.klSF }
}

test('flag OFF: the boot switch loads nothing (no extra request, page as before)', () => {
  assert.deepEqual(boot({ ok: true, storefront: { families: false }, ladders: LIVE }).added, [])
  assert.deepEqual(boot({ ok: false, ladders: LIVE }).added, [], 'no storefront field (old server / error) = off')
  assert.deepEqual(boot(null).added, [])
  assert.deepEqual(boot({ storefront: { families: 'true' } }).added, [], 'only the boolean true switches it on')
  assert.deepEqual(boot({ storefront: { families: false } }, 'https://www.karmilaven.com/?sf=families').added, [], 'no dev override on the live domain')
})

test('flag ON: storefront css + js load; ?sf=families works only on localhost / *.vercel.app previews', () => {
  const on = boot({ storefront: { families: true, sold_out: 'last', refresh_s: 60 }, ladders: LIVE })
  assert.deepEqual(on.added, ['/css/storefront.css?v=pr2', '/js/storefront.js?v=pr2'])
  assert.equal(on.cfg.families, true); assert.equal(on.cfg.progress, false)
  assert.equal(boot({}, 'https://karmi-laven-git-feat-x.vercel.app/?sf=families').cfg.families, true)
  assert.equal(boot({}, 'http://127.0.0.1:8790/?sf=families').cfg.families, true)
  const prog = boot({ storefront: { families: false }, ladders: A })
  assert.deepEqual(prog.added, ['/js/storefront.js?v=pr2'], 'progress line alone: js only, no new styles')
  assert.equal(prog.cfg.progress, true)
})

test('index.html loads the storefront files ONLY through the boot switch', () => {
  const outside = HTML.replace(/\/\*KL-SF-BOOT-START\*\/[\s\S]*?\/\*KL-SF-BOOT-END\*\//, '')
  assert.ok(!/['"]\/(js\/storefront\.js|css\/storefront\.css|data\/cards\.json)/.test(outside))
})

// ---------- 2. storefront logic (numbers from the table only) ----------

test('pool keys mirror the server: gradient by barcode, others by single price only when the table has that pool', () => {
  assert.equal(core.sfPoolKey(LIVE, true, 299), 'gradient')
  assert.equal(core.sfPoolKey(LIVE, false, 599), null, 'live table: no family multi-buy')
  assert.equal(core.sfPoolKey(A, false, 599), '599')
  assert.equal(core.sfPoolKey(A, false, 649), null, 'a moved WAT price leaves the pool (single price)')
  assert.equal(core.sfPoolKey(null, true, 299), null)
})

test('from-badge: lowest exact per-piece price below single, smallest N <= 10; none without a pool', () => {
  assert.deepEqual(core.sfFromBadge(LIVE, 'gradient'), { n: 5, each: 240 }, 'live Gradient: from £2.40 each when you buy 5')
  assert.deepEqual(core.sfFromBadge(A, '400'), { n: 10, each: 160 })
  assert.deepEqual(core.sfFromBadge(A, '599'), { n: 6, each: 299 })
  assert.equal(core.sfFromBadge(LIVE, null), null)
  // the badge number is always one the checkout charges: N × each = the served total
  for (const [T, k] of [[LIVE, 'gradient'], [A, '400'], [A, '599'], [A, '799'], [A, '999']]) {
    const b = core.sfFromBadge(T, k); assert.equal(b.n * b.each, T.pools[k].totals[b.n], `${k}`)
  }
})

test('card states (vitrin 01 §5): hidden / photo tile / sellable / single / cap / sold out', () => {
  const s = (o) => core.sfState({ priceP: 599, photoOk: true, sellable: 3, stock: 3, badge: true, ...o })
  assert.equal(s({}), 'sellable')
  assert.equal(s({ badge: false }), 'single', 'no ladder: single price, no badge (K-12)')
  assert.equal(s({ priceP: null }), 'hidden', 'no price at all: card hidden (K-12)')
  assert.equal(s({ priceP: 0 }), 'hidden')
  assert.equal(s({ photoOk: false }), 'photo', 'no QC photo: colour tile, never sellable (K-03), even with stock')
  assert.equal(s({ sellable: 0, stock: 4 }), 'cap', 'stock but nothing left under the caps: Limit reached (K-07)')
  assert.equal(s({ sellable: 0, stock: 0 }), 'soldout')
})

test('progress line from the table (K-05): next step, best step, single-price pools; no %/save/was/£0', () => {
  const g = (q) => core.sfProgress(LIVE, 'gradient', q, 'The Gradient Edit', 299)
  assert.equal(g(1), 'The Gradient Edit: add 1 more, 2 for £5.50 (£2.75 each).')
  assert.equal(g(2), 'The Gradient Edit: add 1 more, 3 for £7.50 (£2.50 each).')
  assert.equal(g(3), 'The Gradient Edit: add 2 more, 5 for £12.00 (£2.40 each).')
  assert.equal(g(5), 'The Gradient Edit: 5 for £12.00 (£2.40 each), the lowest step.')
  assert.equal(g(12), 'The Gradient Edit: 12 for £29.50.', 'no per-piece claim when it does not divide exactly')
  assert.equal(core.sfProgress(LIVE, null, 2, 'Stretch Charm Bracelet', 599), 'Stretch Charm Bracelet: £5.99 each, single price.')
  // fixture A £4 pool: 3 = 4 = 5 = £12 and 7..10 = £16 (monotonic rule): the line names the real step, not 4 or 7
  assert.equal(core.sfProgress(A, '400', 3, 'Any £4.00 piece', 400), 'Any £4.00 piece: add 2 more, 5 for £12.00 (£2.40 each).')
  assert.equal(core.sfProgress(A, '400', 5, 'Any £4.00 piece', 400), 'Any £4.00 piece: add 5 more, 10 for £16.00 (£1.60 each).')
  assert.equal(core.sfProgress(A, '599', 2, 'x', 599), 'x: add 1 more, 3 for £11.98.')
  for (const [T, k, sp] of [[LIVE, 'gradient', 299], [A, '400', 400], [A, '599', 599], [A, '799', 799], [A, '999', 999]]) {
    for (let q = 1; q <= 12; q++) {
      const t = core.sfProgress(T, k, q, 'L', sp)
      assert.ok(!BAD.test(t), t)
      for (const m of t.matchAll(/(\d+) for £(\d+\.\d\d)/g)) assert.equal(Math.round(Number(m[2]) * 100), T.pools[k].totals[Number(m[1])], `${k} ${t}`)
    }
  }
  assert.equal(core.sfProgress(LIVE, 'gradient', 0, 'x', 299), '')
})

test('tabs: Gradient Edit always first; a family tab shows only with >= 1 sellable card (K-01)', () => {
  assert.deepEqual(core.SF_TABS, ['gradient', 'bracelets', 'necklaces', 'hair'])
  const cards = [{ tab: 'bracelets', st: 'photo' }, { tab: 'necklaces', st: 'single' }, { tab: 'hair', st: 'cap' }, { tab: 'hair', st: 'soldout' }]
  assert.deepEqual(core.sfVisibleTabs(cards, (c) => c.st), ['gradient', 'necklaces'])
  assert.deepEqual(core.sfVisibleTabs([], (c) => c.st), ['gradient'])
})

test('storefront texts: escaped, and no forbidden or fake-urgency wording in the file', () => {
  assert.equal(core.sfEsc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  const code = SF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  const strings = [...code.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]).filter((s) => /[a-z]{3}/i.test(s))
  for (const s of strings) assert.ok(!/(save\b|% off|was £|hurry|only today|launch price|best price)/i.test(s), s)
})

// ---------- 3. page = server when the table has family pools ----------

function page(livePrices, ladders) {
  const i = HTML.indexOf('const DATA=') + 11; let d = 0, j = i
  for (; j < HTML.length; j++) { if (HTML[j] === '[') d++; else if (HTML[j] === ']' && --d === 0) break }
  const DATA = JSON.parse(HTML.slice(i, j + 1))
  const BY = {}; for (const r of DATA) BY[r.barcode] = r
  const LT = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const BLOCK = HTML.match(/\/\*KL-PRICING-START\*\/([\s\S]*?)\/\*KL-PRICING-END\*\//)[1]
  const window = { klPrice: (bc) => (bc in livePrices ? livePrices[bc] : null), klLadders: ladders }
  return new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', `${BLOCK}; return { cartTotal };`)(BY, LT, 2.99, window)
}

test('page cartTotal = server priceUnits on a table WITH family pools (fixture A), mixed carts', () => {
  const T = loadLadders(JSON.parse(read('./fixtures/ladders.A.json'))).table
  const prices = { H1: 4, H2: 4, S1: 5.99, S2: 5.99, N1: 9.99, X1: 6.49 }
  const p = page(prices, A)
  const g = Object.keys(GRADIENT)[0]
  for (let gq = 0; gq <= 6; gq++) for (let h = 0; h <= 11; h++) for (let s = 0; s <= 7; s += 1) for (const x of [0, 2]) {
    if (!gq && !h && !s && !x) continue
    const lines = [gq && { bc: g, qty: gq }, h && { bc: 'H1', qty: Math.ceil(h / 2) }, h > 1 && { bc: 'H2', qty: Math.floor(h / 2) },
      s && { bc: 'S1', qty: s }, x && { bc: 'X1', qty: x }].filter(Boolean)
    const units = [...Array(gq).fill(0).map(() => ({ ladder: true })), ...Array(h).fill(0).map(() => ({ ladder: false, unitP: 400 })),
      ...Array(s).fill(0).map(() => ({ ladder: false, unitP: 599 })), ...Array(x).fill(0).map(() => ({ ladder: false, unitP: 649 }))]
    assert.equal(Math.round(p.cartTotal(lines) * 100), priceUnits(units, T), `g${gq} h${h} s${s} x${x}`)
  }
})

test('live table (no family pools): page cartTotal = n × single per product, = server', () => {
  const p = page({ S1: 5.99, N1: 9.99 }, LIVE)
  for (let n = 1; n <= 12; n++) {
    assert.equal(Math.round(p.cartTotal([{ bc: 'S1', qty: n }, { bc: 'N1', qty: 1 }]) * 100), n * 599 + 999)
    assert.equal(priceUnits([...Array(n).fill(0).map(() => ({ ladder: false, unitP: 599 })), { ladder: false, unitP: 999 }], LADDERS), n * 599 + 999)
  }
})

// ---------- 4. data + performance + Vercel guards ----------

test('cards.json: identity only, safe names, no invented photos, no Gradient barcodes', () => {
  assert.ok(Array.isArray(CARDS.cards) && CARDS.cards.length > 0)
  const seen = new Set()
  for (const c of CARDS.cards) {
    assert.ok(['bracelets', 'necklaces', 'hair'].includes(c.tab), c.barcode)
    assert.ok(!seen.has(c.barcode), 'unique ' + c.barcode); seen.add(c.barcode)
    assert.ok(!(c.barcode in GRADIENT), 'not a Gradient barcode ' + c.barcode)
    assert.ok(!FORBIDDEN.test(c.name) && !FORBIDDEN.test(c.line), c.name)
    assert.ok(!c.name.includes(' · ') && !c.line.includes(' · '), 'Stripe line separator ' + c.name)
    assert.ok(!('price' in c) && !('price_pence' in c) && !('stock' in c), 'prices/stock come live from /api/stock')
    if (!c.photo_qc) assert.equal(c.photo, null, 'no QC photo => no photo path')
    if (c.photo) assert.ok(existsSync(new URL('..' + c.photo, import.meta.url)), 'photo file exists ' + c.photo)
  }
  // generator: only final names; a photo only when the QC-passed file exists
  const items = [{ name_status: 'final', tab: 'Hair', family: 'Hair', barcode: '9', customer_name_en: 'Hair Clip — Rose', tone_group: 'pink' },
    { name_status: 'pending_photo_qa', tab: 'Hair', family: 'Hair', barcode: '8', customer_name_en: 'Hair Clip No. 8' }]
  assert.deepEqual(buildCards(items).map((c) => [c.barcode, c.name, c.photo, c.photo_qc]), [['9', 'Rose', null, false]])
  assert.throws(() => buildCards([{ ...items[0], customer_name_en: 'Diamond Clip — x' }]), /forbidden/)
})

test('performance: index.html has no embedded base64 images (was 4.28 MB) and stays <= 300 KB; every image file exists', () => {
  assert.ok(!/data:image\//.test(HTML), 'no data:image in index.html')
  assert.ok(Buffer.byteLength(HTML) <= 300 * 1024, `index.html ${Buffer.byteLength(HTML)} bytes`)
  const imgs = [...HTML.matchAll(/"img": "(\/img\/gradient\/[0-9A-Za-z]+\.jpg)"/g)].map((m) => m[1])
  assert.equal(imgs.length, 38)
  for (const p of imgs) {
    assert.ok(existsSync(new URL('..' + p, import.meta.url)), p)
    assert.ok(existsSync(new URL('..' + p.replace('/img/gradient/', '/img/gradient/w480/'), import.meta.url)), 'card-size variant ' + p)
  }
  assert.ok(/<img id="heroImg" src="\/img\/gradient\/1074\.jpg" fetchpriority="high"/.test(HTML), 'hero (LCP) image requested from the HTML, not after JS')
})

test('Vercel CJS guard: no import.meta in api/*.js; ladders.json is the only JSON file the functions read', () => {
  for (const f of readdirSync(new URL('../api/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const src = read('../api/' + f)
    assert.ok(!/import\.meta/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `import.meta in api/${f}`)
    const all = (src.match(/readFileSync\(/g) || []).length
    const ok = (src.match(/readFileSync\(join\(process\.cwd\(\), 'ladders\.json'\)/g) || []).length
    assert.equal(all, ok, `api/${f}: every readFileSync reads <cwd>/ladders.json`)
  }
  const vj = JSON.parse(read('../vercel.json'))
  assert.equal(vj.functions['api/stock.js'].includeFiles, 'ladders.json')
  assert.equal(vj.functions['api/checkout.js'].includeFiles, 'ladders.json')
})

test('sticky bag bar: bottom padding follows the measured bar height (+ scroll padding), never a fixed guess only', () => {
  assert.ok(/body\.has-bar\{padding-bottom:var\(--bar-h,84px\)\}/.test(HTML))
  assert.ok(/html\.has-bar\{scroll-padding-bottom:calc\(var\(--bar-h,84px\) \+ 12px\)\}/.test(HTML))
  assert.ok(/setProperty\('--bar-h'/.test(HTML))
})
