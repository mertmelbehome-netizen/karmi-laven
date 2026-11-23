// Command centre 23 Nov 2026 (payment path): in mode cart_qty_groups the ONLINE price is the group price, so a missing
// DB/till price (price_pence null/0) must not block a product that HAS an online group, in /api/stock (sellable) and in
// /api/checkout (charged by priceUnits at the group single / 10+ price). No group = refused (fail closed). Pools mode:
// unchanged (a line without a till price is still refused).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHandler } from '../api/checkout.js'
import stockHandler from '../api/stock.js'
import { LADDERS, loadLadders } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'

const [G1, G2] = Object.keys(GRADIENT)
const POOLS = loadLadders(JSON.parse(readFileSync(new URL('./fixtures/ladders.live-2026-11-23.json', import.meta.url), 'utf8'))).table
// reserve lines: SC = group C via online_group with NO till price; SA = group A no price; SB = family stretch_charm (B)
// with no price; NG = no group, no price; NN = group but no name
const LINE = {
  SC: { online_group: 'C', price_pence: null, name: 'Sparkle Line — Gold-tone Swan' },
  SA: { online_group: 'A', price_pence: 0, name: 'Stretch Bracelet — Blush Daisy' },
  SB: { family: 'stretch_charm', price_pence: null, name: 'Stretch Charm — Pink Bell' },
  NG: { family: 'nope', price_pence: null, name: 'x' },
  NN: { online_group: 'C', price_pence: null, name: '' },
  P1: { family: 'stretch_charm', price_pence: 599, name: 'Priced' },
}
const mkDb = (calls) => async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push(url)
  const ok = (b) => ({ ok: true, status: 200, json: async () => b })
  if (url.includes('/product_barcodes?')) return ok(decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',').map((b) => ({ barcode: b, product_id: 'p' + b })))
  if (url.includes('/stock_levels?')) return ok(url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((x) => ({ product_id: x, stockroom_count: 50 })))
  if (url.includes('/online_orders?')) return ok([])
  if (url.includes('/rpc/fn_karmi_checkout_reserve')) {
    const lines = body.p_items.map((i) => ({ bc: i.bc, product_id: 'p', ...LINE[i.bc] }))
    return ok({ ok: true, ref: 'r', short_session: true, recovery_ok: false, lines })
  }
  return ok(1)
}
const run = async (items, ladders = LADDERS) => {
  const calls = []
  const stripe = { created: [], checkout: { sessions: { create: async (x) => { stripe.created.push(x); return { id: 'cs', url: 'u' } } } } }
  const h = createHandler({ stripe, ladders, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: mkDb(calls), now: () => new Date('2026-11-25T12:00:00Z') })
  let status, out
  const res = { status(c) { status = c; return this }, json(b) { out = b; return this }, end() { return this } }
  await h({ method: 'POST', headers: {}, body: { items }, query: {} }, res)
  const s = stripe.created[0]
  const items$ = s && s.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0)
  const ship = s && s.shipping_options[0].shipping_rate_data.fixed_amount.amount
  return { status, out, s, calls, items: items$, total: s && items$ + ship }
}

test('M1: a grouped product WITHOUT a till price is charged its group price (C £13 single, £3.90 at 10+)', async () => {
  assert.equal(LADDERS.mode, 'cart_qty_groups')
  let r = await run([{ bc: 'SC', qty: 1 }])
  assert.deepEqual([r.status, r.items, r.total], [200, 1300, 1449])
  assert.equal(r.s.line_items[0].price_data.product_data.name, 'SC · Sparkle Line — Gold-tone Swan')
  r = await run([{ bc: 'SC', qty: 10 }])
  assert.deepEqual([r.status, r.items, r.total], [200, 3900, 3900])
  r = await run([{ bc: 'SB', qty: 2 }])   // group from family_groups, no till price
  assert.deepEqual([r.status, r.items], [200, 1600])
})

test('M1: no group -> 503 pricing_unavailable, hold released; no name -> refused', async () => {
  let r = await run([{ bc: G1, qty: 1 }, { bc: 'NG', qty: 1 }])
  assert.deepEqual([r.status, r.out.error, r.s], [503, 'pricing_unavailable', undefined])
  assert.ok(r.calls.some((c) => c.includes('fn_karmi_checkout_release')))
  r = await run([{ bc: 'NN', qty: 1 }])
  assert.deepEqual([r.status, r.s], [503, undefined])
})

test('pools mode unchanged: a line without a till price is still refused (503 stock_unavailable)', async () => {
  let r = await run([{ bc: 'SB', qty: 1 }], POOLS)
  assert.deepEqual([r.status, r.out.error, r.s], [503, 'stock_unavailable', undefined])
  r = await run([{ bc: 'P1', qty: 1 }], POOLS)
  assert.deepEqual([r.status, r.items], [200, 599])
})

test('M1 Stripe totals unchanged: 1 B £9.49, 9 B £73.49, 10 B £24.00, 4A+3B+3C £24.90', async () => {
  assert.equal((await run([{ bc: G1, qty: 1 }])).total, 949)
  assert.equal((await run([{ bc: G1, qty: 5 }, { bc: G2, qty: 4 }])).total, 7349)
  assert.equal((await run([{ bc: G1, qty: 6 }, { bc: G2, qty: 4 }])).total, 2400)
  assert.equal((await run([{ bc: 'SA', qty: 4 }, { bc: G1, qty: 3 }, { bc: 'SC', qty: 3 }])).total, 2490)
})

test('/api/stock M1: grouped item without a till price is sellable with price_pence = group single; no group = 0', async () => {
  const saved = { u: process.env.OPS_SUPABASE_URL, k: process.env.OPS_SUPABASE_SERVICE_KEY }
  const real = globalThis.fetch
  process.env.OPS_SUPABASE_URL = 'https://db.test'; process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  globalThis.fetch = async (url) => {
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) return ok([{ barcode: G1, product_id: 'pg' }])
    if (url.includes('/stock_levels?')) return ok([{ product_id: 'pg', stockroom_count: 40 }])
    if (url.includes('/online_orders?')) return ok([])
    if (url.includes('fn_karmi_online_status')) return ok({ window: { open: true, message: null }, items: {
      SC: { sellable: 4, stock: 30, price_pence: null, online_group: 'C' },
      SB: { sellable: 3, stock: 9, price_pence: null, family: 'stretch_charm' },
      P1: { sellable: 2, stock: 9, price_pence: 599, online_group: 'A' },
      NG: { sellable: 5, stock: 9, price_pence: null, family: 'hair' },
    } })
    return ok([])
  }
  try {
    let body
    await stockHandler({ query: { bc: `${G1},SC,SB,P1,NG` } }, { setHeader() {}, status() { return this }, json(b) { body = b; return this } })
    assert.deepEqual(body.sellable, { SC: 4, SB: 3, P1: 2, NG: 0 })
    assert.deepEqual(body.price_pence, { SC: 1300, SB: 800, P1: 599 })
    assert.deepEqual(body.online_group, { SC: 'C', SB: 'B', P1: 'A' })
  } finally {
    globalThis.fetch = real
    for (const [k, v] of [['OPS_SUPABASE_URL', saved.u], ['OPS_SUPABASE_SERVICE_KEY', saved.k]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})
