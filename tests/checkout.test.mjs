// /api/checkout with a fake Stripe and a fake ops DB (no network). Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../api/checkout.js'
import stockHandler from '../api/stock.js'
import { GRADIENT } from '../api/_gradient.js'

const [G1, G2] = Object.keys(GRADIENT)

/** reserveReply: object (the RPC's JSON) | 'error' (HTTP 500) | function(args) → object */
function fakeDb({ reserveReply, stockroom = 50 } = {}) {
  const calls = []
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push({ url, body })
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (url.includes('/product_barcodes?')) {
      const bcs = decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',')
      return ok(bcs.map((b) => ({ barcode: b, product_id: 'p' + b })))
    }
    if (url.includes('/stock_levels?')) {
      const pids = url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',')
      return ok(pids.map((p) => ({ product_id: p, stockroom_count: stockroom })))
    }
    if (url.includes('/online_orders?')) return ok([])
    if (url.includes('/rpc/fn_karmi_checkout_reserve')) {
      const r = typeof reserveReply === 'function' ? reserveReply(body) : reserveReply
      if (r === 'error') return { ok: false, status: 500, json: async () => ({}) }
      return ok(r)
    }
    if (url.includes('/rpc/fn_karmi_checkout_attach') || url.includes('/rpc/fn_karmi_checkout_release')) return ok(1)
    if (url.includes('/rpc/fn_karmi_online_status')) {
      if (reserveReply === 'error') return { ok: false, status: 500, json: async () => ({}) }
      const items = {}
      for (const bc of body.p_barcodes) items[bc] = { sellable: 4, stock: 37, price_pence: 599 }
      return ok({ window: { open: true, message: null }, items })
    }
    throw new Error('unexpected ' + url)
  }
  fn.calls = calls
  fn.rpc = (name) => calls.filter((c) => c.url.includes('/rpc/' + name))
  return fn
}

function fakeStripe({ fail = false } = {}) {
  const s = { created: [] }
  s.checkout = { sessions: { create: async (p) => { if (fail) throw new Error('stripe down'); s.created.push(p); return { id: 'cs_test_1', url: 'https://pay/x' } } } }
  return s
}

async function call(handler, body) {
  let status, json
  const res = { status(c) { status = c; return this }, json(b) { json = b; return this }, end() { return this } }
  await handler({ method: 'POST', headers: {}, body }, res)
  return { status, json }
}

const OK_GRADIENT = { ok: true, ref: 'r', lines: [], short_session: false, recovery_ok: true }
const env = () => ({ base: 'https://db.test', key: 'k' })
const make = (o = {}) => {
  const stripe = fakeStripe(o)
  const db = fakeDb(o)
  return { stripe, db, h: createHandler({ stripe, env, fetchImpl: db, now: () => o.now || new Date('2026-11-25T12:00:00Z') }) }
}
const total = (p) => p.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0)

test('Gradient Edit unchanged: 5 = £12, 6 = £14.99; promo codes on; client name/price ignored', async () => {
  for (const [q, want] of [[5, 1200], [6, 1499]]) {
    const { stripe, h } = make({ reserveReply: OK_GRADIENT })
    const r = await call(h, { items: [{ bc: G1, name: 'Diamond Gold', qty: q - 1, price: 0.01 }, { bc: G2, name: 'x', qty: 1 }] })
    assert.equal(r.status, 200)
    const p = stripe.created[0]
    assert.equal(total(p), want)
    assert.equal(p.allow_promotion_codes, true)
    assert.ok(p.line_items.every((l) => !/Diamond/.test(l.price_data.product_data.name)))
    assert.equal(p.line_items[0].price_data.product_data.name, `${G1} · ${GRADIENT[G1]}`)
    assert.ok(p.after_expiration, 'recovery stays on when the DB says it is safe')
    assert.equal(p.expires_at, undefined)
  }
})

test('a new family is charged the WAT single price from the DB; mixed cart 3 Gradient + 1 = £13.49', async () => {
  const reply = { ok: true, ref: 'r', short_session: true, recovery_ok: false,
    lines: [{ bc: '6101', product_id: 'p', family: 'stretch_charm', price_pence: 599, name: 'Stretch Charm — Rose' }] }
  const { stripe, db, h } = make({ reserveReply: reply })
  const r = await call(h, { items: [{ bc: G1, qty: 3 }, { bc: '6101', name: 'Diamond hack', qty: 1, price: 0.5 }] })
  assert.equal(r.status, 200)
  const p = stripe.created[0]
  assert.equal(total(p), 1349)
  const line = p.line_items.find((l) => l.price_data.product_data.name.startsWith('6101'))
  assert.deepEqual([line.price_data.unit_amount, line.price_data.product_data.name], [599, '6101 · Stretch Charm — Rose'])
  assert.equal(p.allow_promotion_codes, false, 'no promo codes once a capped product is in the cart')
  assert.equal(p.after_expiration, undefined, 'no recovery link that would skip the caps')
  assert.ok(p.expires_at > Date.parse('2026-11-25T12:30:00Z') / 1000 && p.expires_at <= Date.parse('2026-11-25T12:31:00Z') / 1000)
  assert.ok(p.metadata.hold_ref)
  const res = db.rpc('fn_karmi_checkout_reserve')[0].body
  assert.deepEqual(res.p_items, [{ bc: '6101', qty: 1 }])
  assert.equal(res.p_gradient_units, 3)
  assert.equal(db.rpc('fn_karmi_checkout_attach')[0].body.p_session_id, 'cs_test_1')
})

test('fail CLOSED: caps DB unreadable with a capped product in the cart → 503, Stripe never called', async () => {
  const { stripe, h } = make({ reserveReply: 'error' })
  const r = await call(h, { items: [{ bc: G1, qty: 1 }, { bc: '6101', qty: 1 }] })
  assert.equal(r.status, 503)
  assert.equal(r.json.error, 'stock_unavailable')
  assert.equal(stripe.created.length, 0)
  // env missing entirely → same
  const s2 = fakeStripe()
  const h2 = createHandler({ stripe: s2, env: () => ({}), fetchImpl: fakeDb({}) })
  assert.equal((await call(h2, { items: [{ bc: '6101', qty: 1 }] })).status, 503)
})

test('fail CLOSED: a DB line without a price is refused and its hold released', async () => {
  const { stripe, db, h } = make({ reserveReply: { ok: true, ref: 'r', lines: [{ bc: '6101', price_pence: null, name: 'x' }] } })
  const r = await call(h, { items: [{ bc: '6101', qty: 1 }] })
  assert.equal(r.status, 503)
  assert.equal(stripe.created.length, 0)
  assert.equal(db.rpc('fn_karmi_checkout_release').length, 1)
})

test('Gradient-only cart with the DB down: fail open before 13 Dec, refused from 13 Dec (limit cannot be checked)', async () => {
  let m = make({ reserveReply: 'error', now: new Date('2026-12-12T23:59:00Z') })
  let r = await call(m.h, { items: [{ bc: G1, qty: 2 }] })
  assert.equal(r.status, 200)
  assert.equal(total(m.stripe.created[0]), 550)
  assert.equal(m.stripe.created[0].after_expiration, undefined)
  m = make({ reserveReply: 'error', now: new Date('2026-12-13T00:00:00Z') })
  r = await call(m.h, { items: [{ bc: G1, qty: 2 }] })
  assert.equal(r.status, 503)
  assert.equal(m.stripe.created.length, 0)
})

test('cut-off / Christmas limit / not available come back with the server message', async () => {
  let m = make({ reserveReply: { ok: false, error: 'closed', message: 'Online orders are closed for Christmas.' } })
  let r = await call(m.h, { items: [{ bc: G1, qty: 1 }] })
  assert.deepEqual([r.status, r.json.message], [403, 'Online orders are closed for Christmas.'])
  m = make({ reserveReply: { ok: false, error: 'limit_reached', message: 'limit' } })
  assert.equal((await call(m.h, { items: [{ bc: G1, qty: 1 }] })).status, 403)
  m = make({ reserveReply: { ok: false, error: 'not_available', message: 'Not available online right now', items: [{ bc: '6101', requested: 2, available: 1 }] } })
  r = await call(m.h, { items: [{ bc: '6101', qty: 2 }] })
  assert.deepEqual([r.status, r.json.message, r.json.items[0].available], [409, 'Not available online right now', 1])
  assert.equal(m.stripe.created.length, 0)
})

test('Stripe failure releases the hold', async () => {
  const { db, h } = make({ fail: true, reserveReply: { ok: true, ref: 'r', lines: [], short_session: false, recovery_ok: true } })
  const r = await call(h, { items: [{ bc: G1, qty: 1 }] })
  assert.equal(r.status, 500)
  assert.equal(db.rpc('fn_karmi_checkout_release').length, 1)
})

test('Gradient stock check still trims (409 out_of_stock) before any reservation', async () => {
  const { db, h } = make({ reserveReply: OK_GRADIENT, stockroom: 4 }) // 4 − buffer 3 = 1 available
  const r = await call(h, { items: [{ bc: G1, qty: 2 }] })
  assert.equal(r.status, 409)
  assert.equal(r.json.error, 'out_of_stock')
  assert.equal(db.rpc('fn_karmi_checkout_reserve').length, 0)
})

test('/api/stock: non-Gradient barcodes get sellable + WAT price + real stock; DB down → absent (fail closed)', async () => {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const real = globalThis.fetch
  try {
    for (const [reply, want] of [[OK_GRADIENT, { sellable: { 6101: 4 }, price_pence: { 6101: 599 }, stock6101: 37 }],
                                 ['error', { sellable: {}, price_pence: {}, stock6101: undefined }]]) {
      globalThis.fetch = fakeDb({ reserveReply: reply })
      let body
      const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
      await stockHandler({ query: { bc: `${G1},6101` } }, res)
      assert.equal(body.ok, true)
      assert.equal(body.stock[G1], 50 - 3)
      assert.deepEqual(body.sellable, want.sellable)
      assert.deepEqual(body.price_pence, want.price_pence)
      assert.equal(body.stock['6101'], want.stock6101)
    }
  } finally {
    globalThis.fetch = real
  }
})
