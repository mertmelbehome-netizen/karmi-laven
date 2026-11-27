// Owner rule 27 Nov 2026 (WORKING_SYSTEM §19): a product is shown / sold online only with display > 0 AND stockroom > 0
// in the store (api/_stock-lib.js STORE). /api/stock zeroes stock + sellable of a hidden product (the page already hides
// unavailable cards) and serves the additive `shown` map; /api/checkout refuses a bag holding one (409 not_available).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import stockHandler from '../api/stock.js'
import { GRADIENT } from '../api/_gradient.js'

const G = Object.keys(GRADIENT)
const [G1, G2] = [G[0], G[1]]

test('/api/stock: display 0 or stockroom 0 = stock 0, sellable 0, shown false; both > 0 = counted as before', async () => {
  const saved = { u: process.env.OPS_SUPABASE_URL, k: process.env.OPS_SUPABASE_SERVICE_KEY }
  const real = globalThis.fetch
  process.env.OPS_SUPABASE_URL = 'https://db.test'; process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  globalThis.fetch = async (url) => {
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) return ok([{ barcode: G1, product_id: 'p1' }, { barcode: G2, product_id: 'p2' }, { barcode: 'X1', product_id: 'p3' }, { barcode: 'X2', product_id: 'p4' }])
    if (url.includes('/stock_levels?')) return ok([
      { product_id: 'p1', stockroom_count: 40, display_count: 5 },
      { product_id: 'p2', stockroom_count: 40, display_count: 0 },
      { product_id: 'p3', stockroom_count: 40, display_count: 0 },
      { product_id: 'p4', stockroom_count: 40, display_count: 2 }])
    if (url.includes('/online_orders?')) return ok([])
    if (url.includes('fn_karmi_online_status')) return ok({ window: { open: true, message: null }, items: {
      X1: { sellable: 4, stock: 30, price_pence: 599, online_group: 'A' },
      X2: { sellable: 4, stock: 30, price_pence: 599, online_group: 'A' } } })
    return ok([])
  }
  try {
    let body
    await stockHandler({ query: { bc: `${G1},${G2},X1,X2` } }, { setHeader() {}, status() { return this }, json(b) { body = b; return this } })
    assert.deepEqual(body.shown, { [G1]: true, [G2]: false, X1: false, X2: true })
    assert.ok(body.stock[G1] > 0, 'shown Gradient piece keeps its count')
    assert.equal(body.stock[G2], 0, 'display 0 Gradient piece = nothing to sell')
    assert.equal(body.sellable.X1, 0, 'display 0 non-Gradient = sellable 0')
    assert.equal(body.sellable.X2, 4, 'shown non-Gradient keeps its cap-aware count')
  } finally {
    globalThis.fetch = real
    process.env.OPS_SUPABASE_URL = saved.u; process.env.OPS_SUPABASE_SERVICE_KEY = saved.k
  }
})

test('/api/checkout refuses a bag with a hidden product, one shared function with /api/stock, fail open when unreadable', () => {
  const co = readFileSync(new URL('../api/checkout.js', import.meta.url), 'utf8')
  assert.match(co, /1b\) Display rule/)
  assert.match(co, /sh\.shown && sh\.shown\[bc\] === false/)
  assert.match(co, /status\(409\)\.json\(\{ error: 'not_available'/)
  assert.match(co, /checkout display rule skipped \(fail open\)/)
  const lib = readFileSync(new URL('../api/_stock-lib.js', import.meta.url), 'utf8')
  assert.match(lib, /export function shownMap/)
  assert.match(readFileSync(new URL('../api/stock.js', import.meta.url), 'utf8'), /shownMap\(want, bcToPid, dispMap, slMap\)/)
})
