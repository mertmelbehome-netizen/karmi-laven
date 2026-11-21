// node --test tests/   (no dependencies; fetch is faked)
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
  assert.deepEqual(r, { ok: true, stock: { 111: 10 - B } })
})

test('/api/stock output is unchanged by the refactor (same maths through the shared module)', async () => {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  globalThis.fetch = fakeFetch(ROWS)
  try {
    let status, body
    const res = { setHeader() {}, status(s) { status = s; return this }, json(b) { body = b; return this } }
    await stockHandler({ query: { bc: '111,222' } }, res)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.stock, { 111: 10 - B - 3, 222: 0 })
  } finally {
    globalThis.fetch = real
  }
})
