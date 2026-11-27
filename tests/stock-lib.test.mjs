// node --test tests/   (no dependencies; fetch is faked)
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAvailable, fetchAvailable, shortages, ONLINE_STOCKROOM_BUFFER } from '../api/_stock-lib.js'
import stockHandler from '../api/stock.js'

const B = ONLINE_STOCKROOM_BUFFER

function fakeFetch(rows) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (rows.fail && url.includes(rows.fail)) return { ok: false, status: 500, json: async () => ({}) }
    if (url.includes('/product_barcodes?')) return ok(rows.pb)
    if (url.includes('/stock_levels?')) return ok(rows.sl)
    if (url.includes('/online_orders?')) return ok(rows.oo)
    throw new Error('unexpected ' + url)
  }
  fn.calls = calls
  return fn
}

const ROWS = {
  pb: [{ barcode: '111', product_id: 'p1' }, { barcode: '222', product_id: 'p2' }],
  sl: [{ product_id: 'p1', stockroom_count: 10 }, { product_id: 'p2', stockroom_count: 2 }],
  oo: [{ items: [{ bc: '111', qty: 2 }, { bc: '999', qty: 1 }] }, { items: [{ bc: '111', qty: '1' }] }, { items: null }],
}

test('computeAvailable: stockroom − buffer − paid holds, floored at 0; unknown barcode = 0', () => {
  const s = computeAvailable(['111', '222', '333'], { 111: 'p1', 222: 'p2' }, { p1: 10, p2: 2 }, ROWS.oo)
  assert.deepEqual(s, { 111: 10 - B - 3, 222: 0, 333: 0 })
})

test('shortages: only barcodes asking for more than available', () => {
  assert.deepEqual(shortages({ 111: 4, 222: 1 }, { 111: 4, 222: 0 }), [{ bc: '222', requested: 1, available: 0 }])
  assert.deepEqual(shortages({ 444: 1 }, {}), [{ bc: '444', requested: 1, available: 0 }])
  assert.deepEqual(shortages({ 111: 1 }, { 111: 5 }), [])
})

test('fetchAvailable: reads the three tables with the service key and returns the map', async () => {
  const f = fakeFetch(ROWS)
  const r = await fetchAvailable(['111', '222', '111', ' '], { base: 'https://db.test', key: 'k', fetchImpl: f })
  assert.equal(r.ok, true)
  assert.deepEqual(r.stock, { 111: 10 - B - 3, 222: 0 })
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls[0].includes('barcode=in.(111,222)'))
})

test('fetchAvailable: env missing or DB error -> ok:false (callers fail open); holds error is non-fatal', async () => {
  assert.equal((await fetchAvailable(['111'], {})).ok, false)
  assert.equal((await fetchAvailable(['111'], { base: 'https://db.test', key: 'k', fetchImpl: fakeFetch({ ...ROWS, fail: 'stock_levels' }) })).ok, false)
  const r = await fetchAvailable(['111'], { base: 'https://db.test', key: 'k', fetchImpl: fakeFetch({ ...ROWS, fail: 'online_orders' }) })
  assert.deepEqual(r, { ok: true, stock: { 111: 10 - B }, shown: { 111: true } })
})

test('/api/stock output is unchanged for Gradient Edit barcodes (same maths through the shared module)', async () => {
  // 22 Nov 2026: non-Gradient barcodes now come from the caps functions (tests/checkout.test.mjs); the Gradient Edit
  // barcodes 1074 / 1111 keep the barcode-level maths exactly as before.
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  const rows = { pb: [{ barcode: '1074', product_id: 'p1' }, { barcode: '1111', product_id: 'p2' }], sl: ROWS.sl,
    oo: [{ items: [{ bc: '1074', qty: 2 }, { bc: '999', qty: 1 }] }, { items: [{ bc: '1074', qty: '1' }] }, { items: null }] }
  const f = fakeFetch(rows)
  globalThis.fetch = async (url, o) => (url.includes('/rpc/') ? { ok: true, status: 200, json: async () => ({ window: { open: true }, items: {} }) } : f(url, o))
  try {
    let status, body
    const res = { setHeader() {}, status(s) { status = s; return this }, json(b) { body = b; return this } }
    await stockHandler({ query: { bc: '1074,1111' } }, res)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.stock, { 1074: 10 - B - 3, 1111: 0 })
  } finally {
    globalThis.fetch = real
  }
})

test('display rule (owner 27 Nov 2026): shown only with display > 0 AND stockroom > 0; no evidence = never hidden', async () => {
  const { shownMap } = await import('../api/_stock-lib.js')
  const m = { a: 'pa', b: 'pb', c: 'pc', d: 'pd' }
  assert.deepEqual(shownMap(['a', 'b', 'c', 'd', 'zz'], m, { pa: 3, pb: 0, pc: 5 }, { pa: 9, pb: 9, pc: 0, pd: 4 }),
    { a: true, b: false, c: false, d: true, zz: true })   // b display 0, c stockroom 0, d no display field (unknown), zz unmapped
})

test('sellable = display + stockroom − buffer − holds (owner 27 Nov 2026); without a display map the old stockroom-only maths', () => {
  const bcToPid = { a: 1, b: 2 }
  const orders = [{ items: [{ bc: 'a', qty: 2 }] }]
  assert.deepEqual(computeAvailable(['a', 'b'], bcToPid, { 1: 10, 2: 1 }, orders, { 1: 4, 2: 5 }), { a: 10 + 4 - 3 - 2, b: 1 + 5 - 3 })
  assert.deepEqual(computeAvailable(['a'], bcToPid, { 1: 10 }, orders), { a: 10 - 3 - 2 })
  assert.deepEqual(computeAvailable(['a'], bcToPid, { 1: 2 }, [], { 1: 0 }), { a: 0 }, 'floored at 0')
})
