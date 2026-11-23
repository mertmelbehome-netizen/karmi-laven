// Christmas last-order notice (23 Nov 2026; command centre approved; CMA: condition visible, no delivery promise).
//   /api/stock: additive `christmas` { last_order_date, closes_at, limit_from } from karmi_online_window; DB error -> absent.
//   page (js/christmas.js KL-XMAS-CORE, evaluated as-is): approved sentence for the served date; nothing when the field
//   is absent, the date has passed or the window has closed; never a delivery promise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stockHandler from '../api/stock.js'
import { christmasFromRow, christmasNotice } from '../api/_christmas.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const ROW = { id: 'christmas_2026', closes_at: '2026-12-16T00:00:00+00:00', limit_from: '2026-12-13T00:00:00+00:00', limit_orders: 15, limit_units: 40 }
const BEFORE = new Date('2026-11-23T12:00:00Z')

// ---------- server ----------
function fakeDb({ windowReply = 'row' } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const u = decodeURIComponent(url)
    if (u.includes('/karmi_online_window?')) {
      if (windowReply === 'throw') throw new Error('network down')
      if (windowReply === '500') return { ok: false, status: 500, json: async () => ({}) }
      if (windowReply === 'hang') return new Promise(() => {})
      return { ok: true, status: 200, json: async () => (windowReply === 'none' ? [] : [ROW]) }
    }
    let body = []
    if (u.includes('/rpc/')) body = { window: { open: true, message: null }, items: {} }
    else if (u.includes('/product_barcodes?')) body = u.match(/barcode=in\.\(([^)]*)\)/)[1].split(',').map((bc) => ({ barcode: bc, product_id: `p${bc}` }))
    else if (u.includes('/stock_levels?')) body = u.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((pid) => ({ product_id: pid, stockroom_count: 10 }))
    return { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetchImpl }
}
async function call(query, opts) {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  const db = fakeDb(opts)
  globalThis.fetch = db.fetchImpl
  try {
    let body
    const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
    await stockHandler({ query }, res)
    return { body, calls: db.calls }
  } finally { globalThis.fetch = real }
}
const strip = (b) => { const { ts, christmas, ...rest } = b; return rest }

test('row closes_at 2026-12-16 00:00 London -> last_order_date 2026-12-15 (pure)', () => {
  assert.deepEqual(christmasFromRow(ROW, BEFORE), { last_order_date: '2026-12-15', closes_at: '2026-12-16T00:00:00.000Z', limit_from: '2026-12-13T00:00:00.000Z' })
  // a BST-season close at London midnight still names the day before
  assert.equal(christmasFromRow({ closes_at: '2026-07-16T00:00:00+01:00' }, new Date('2026-07-01T00:00:00Z')).last_order_date, '2026-07-15')
  // closed / bad rows -> null
  assert.equal(christmasFromRow(ROW, new Date('2026-12-16T00:00:00Z')), null)
  assert.equal(christmasFromRow({ closes_at: 'nope' }, BEFORE), null)
  assert.equal(christmasFromRow(null, BEFORE), null)
})

test('/api/stock (page call and default call): adds christmas from the mocked karmi_online_window row; read-only GET', async () => {
  for (const q of [{ bc: '1267,1271' }, { bc: '1267,999999' }, {}]) {
    const { body, calls } = await call(q)
    assert.equal(body.ok, true)
    assert.equal(body.christmas.last_order_date, '2026-12-15')
    assert.equal(body.christmas.closes_at, '2026-12-16T00:00:00.000Z')
    assert.equal(body.christmas.limit_from, '2026-12-13T00:00:00.000Z')
    const w = calls.filter((u) => u.includes('/karmi_online_window?'))
    assert.equal(w.length, 1)
    assert.match(decodeURIComponent(w[0]), /select=id,closes_at,limit_from&id=like\.christmas\*&closes_at=gt\./)
  }
})

test('/api/stock: DB error / no row / timeout -> christmas absent, response otherwise unchanged', async () => {
  for (const q of [{ bc: '1267,1271' }, { bc: '1267,999999' }]) {
    const good = await call(q)
    for (const windowReply of ['throw', '500', 'none']) {
      const { body } = await call(q, { windowReply })
      assert.equal('christmas' in body, false, windowReply)
      assert.deepEqual(strip(body), strip(good.body), windowReply)
    }
  }
  const t0 = Date.now()
  assert.equal(await christmasNotice({ base: 'https://db.test', key: 'k', fetchImpl: () => new Promise(() => {}), timeoutMs: 50 }), null)
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(await christmasNotice({ base: '', key: 'k' }), null)
})

test('/api/stock: stock read failure (ok:false) still carries christmas; env missing -> absent', async () => {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  globalThis.fetch = async (url) => (url.includes('/karmi_online_window?') ? { ok: true, json: async () => [ROW] } : { ok: false, status: 503, json: async () => ({}) })
  try {
    let body
    await stockHandler({ query: { bc: '1267' } }, { setHeader() {}, status() { return this }, json(b) { body = b; return this } })
    assert.equal(body.ok, false)
    assert.equal(body.christmas.last_order_date, '2026-12-15')
  } finally { globalThis.fetch = real }
  delete process.env.OPS_SUPABASE_SERVICE_KEY
  let body
  await stockHandler({ query: { bc: '1267' } }, { setHeader() {}, status() { return this }, json(b) { body = b; return this } })
  assert.equal('christmas' in body, false)
})

// ---------- page ----------
const JS = read('../js/christmas.js')
const core = JS.match(/\/\*KL-XMAS-CORE-START\*\/([\s\S]*?)\/\*KL-XMAS-CORE-END\*\//)[1]
const P = new Function(`${core}\n; return { xmLongText, xmShortText, xmLongDate, XM_FAQ_Q };`)()
const C = { last_order_date: '2026-12-15', closes_at: '2026-12-16T00:00:00.000Z', limit_from: '2026-12-13T00:00:00.000Z' }
const APPROVED = "Last online order date for Christmas: Tuesday 15 December (or earlier if our Christmas order limit is reached). We dispatch within 1–2 business days; Royal Mail usually takes 2–5 business days, so we can't guarantee delivery before Christmas for late orders."
const SHORT = 'Christmas: last online order Tue 15 Dec (or earlier if our limit is reached) · delivery not guaranteed before Christmas for late orders'

test('page text = the approved sentence for the served date (and the short form)', () => {
  assert.equal(P.xmLongText(C, BEFORE), APPROVED)
  assert.equal(P.xmShortText(C, BEFORE), SHORT)
  assert.equal(P.XM_FAQ_Q, 'Last order date for Christmas?')
  // the date comes from the field: another date, another text
  assert.equal(P.xmLongDate({ last_order_date: '2027-12-14' }, new Date('2027-11-01T00:00:00Z')), 'Tuesday 14 December')
  // still shown on the last day itself (London), until closes_at
  assert.equal(P.xmLongText(C, new Date('2026-12-15T23:59:00Z')), APPROVED)
})

test('no notice: field absent / malformed, date passed (London), window closed', () => {
  for (const c of [undefined, null, {}, { last_order_date: '15/12/2026' }, { last_order_date: '2026-02-31' }]) {
    assert.equal(P.xmLongText(c, BEFORE), '')
    assert.equal(P.xmShortText(c, BEFORE), '')
  }
  assert.equal(P.xmLongText(C, new Date('2026-12-16T00:00:00Z')), '')
  assert.equal(P.xmLongText({ last_order_date: '2026-12-15' }, new Date('2026-12-16T00:30:00Z')), '')   // no closes_at: by date only
  assert.equal(P.xmShortText(C, new Date('2027-01-02T00:00:00Z')), '')
})

test('never a promise: no "%", no "was", no "guarantee delivery before Christmas" without "can\'t"', () => {
  const texts = [P.xmLongText(C, BEFORE), P.xmShortText(C, BEFORE), P.XM_FAQ_Q]
  for (const t of texts) {
    assert.ok(!t.includes('%'), t)
    assert.ok(!/\bwas\b/i.test(t), t)
    const i = t.toLowerCase().indexOf('guarantee delivery before christmas')
    if (i >= 0) assert.ok(/can't $/.test(t.slice(0, i).toLowerCase()), t)
    assert.ok(!/guaranteed (delivery|before christmas)|will arrive|in time for christmas/i.test(t.replace('delivery not guaranteed before Christmas', '')), t)
  }
  // no hard-coded visible date anywhere in the notice code or the pages
  for (const f of ['../js/christmas.js', '../index.html', '../shipping-returns.html']) {
    assert.ok(!/15 Dec|Tuesday 15|Tue 15/.test(read(f)), f)
  }
})

test('wiring: index.html loads js/christmas.js and passes data.christmas; shipping page fetches it itself', () => {
  const html = read('../index.html')
  assert.match(html, /<script src="\/js\/christmas\.js\?v=1"><\/script>\s*<script>\s*\/\* ---- LIVE STOCK/)
  assert.match(html, /if\(data && data\.christmas && typeof window\.klXmasApply==='function'\) window\.klXmasApply\(data\.christmas\);/)
  const sr = read('../shipping-returns.html')
  assert.match(sr, /<ul data-kl-xmas-anchor>/)
  assert.match(sr, /<script src="\/js\/christmas\.js\?v=1" data-kl-xmas-fetch><\/script>/)
  assert.doesNotThrow(() => new Function(JS))
  // contrast >= 4.5:1 and >= 12px for the small lines (#5c554a on the page / bag backgrounds)
  assert.match(JS, /\.kl-xmas\{font-size:12px;[^}]*color:#5c554a/)
})
