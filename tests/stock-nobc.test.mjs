// /api/stock without ?bc= (K&D #40, 23 Nov 2026): it used to return WAT stockroom counts for every WAT product
// (~2,000, PostgREST join "strategy B", "admin/debug") to anyone. Now a call without ?bc= answers exactly what the
// storefront page itself shows: the Gradient Edit barcodes (api/_gradient.js = index.html DATA). The ?bc= call the page
// makes is unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stockHandler from '../api/stock.js'
import { GRADIENT } from '../api/_gradient.js'

const B = 3 // ONLINE_STOCKROOM_BUFFER default (api/_stock-lib.js)

/** Fake ops DB: every barcode -> product p<bc> with stockroom 10; records every URL. */
function fakeDb() {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const u = decodeURIComponent(url)
    let body
    if (u.includes('/rpc/')) body = { window: { open: true }, items: {} }
    else if (u.includes('/product_barcodes?')) {
      const bcs = u.match(/barcode=in\.\(([^)]*)\)/)[1].split(',')
      body = bcs.map((bc) => ({ barcode: bc, product_id: `p${bc}` }))
    } else if (u.includes('/stock_levels?')) {
      const m = u.match(/product_id=in\.\(([^)]*)\)/)
      body = m ? m[1].split(',').map((pid) => ({ product_id: pid, stockroom_count: 10 })) : Array.from({ length: 2037 }, (_, i) => ({ product_id: `x${i}`, stockroom_count: 5, products: { product_barcodes: [{ barcode: `X${i}` }] } }))
    } else if (u.includes('/online_orders?')) body = []
    else body = []
    return { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetchImpl }
}

async function call(query) {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  const db = fakeDb()
  globalThis.fetch = db.fetchImpl
  try {
    let status, body
    const res = { setHeader() {}, status(s) { status = s; return this }, json(b) { body = b; return this } }
    await stockHandler({ query }, res)
    return { status, body, calls: db.calls }
  } finally {
    globalThis.fetch = real
  }
}

test('no ?bc=: only the storefront list (Gradient Edit barcodes), never the WAT-wide dump', async () => {
  const { status, body, calls } = await call({})
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(Object.keys(body.stock).sort(), Object.keys(GRADIENT).sort())
  assert.equal(Object.keys(body.stock).length, 38)
  for (const v of Object.values(body.stock)) assert.equal(v, 10 - B)
  assert.deepEqual(body.sellable, {})
  assert.deepEqual(body.price_pence, {})
  assert.equal(body.window, null)
  assert.ok(body.ladders && body.ladders.mode, 'ladders still served')
  assert.ok(body.storefront && 'families' in body.storefront, 'storefront flags still served')
  // the old join over all WAT stock_levels is never requested; every stock_levels read is filtered by product_id
  assert.ok(!calls.some((u) => decodeURIComponent(u).includes('products(product_barcodes')), 'no WAT-wide join')
  assert.ok(calls.filter((u) => u.includes('/stock_levels?')).every((u) => u.includes('product_id=in.')))
  assert.ok(!calls.some((u) => u.includes('/rpc/')), 'no caps call for the default list')
})

test('?bc=1267,1271 (the page call): counts as before', async () => {
  const { body } = await call({ bc: '1267,1271' })
  assert.equal(body.ok, true)
  assert.deepEqual(body.stock, { 1267: 10 - B, 1271: 10 - B })
})

test('?bc= with a non-storefront barcode: no barcode-level count for it (caps decide, here: none)', async () => {
  const { body } = await call({ bc: '1267,999999' })
  assert.deepEqual(body.stock, { 1267: 10 - B })
})

test('api/stock.js stays CommonJS-safe (no import.meta) and has no unfiltered stock_levels read', () => {
  const src = readFileSync(new URL('../api/stock.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('import.meta'))
  assert.ok(!/stock_levels\?store_id=/.test(src), 'no stock_levels read without a product_id filter')
})
