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
    assert.deepEqual(p.after_expiration, { recovery: { enabled: true, allow_promotion_codes: true } }, 'Gradient-only: recovery ON')
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
  assert.deepEqual(p.after_expiration, { recovery: { enabled: false } }, 'capped product in the cart: recovery OFF')
  assert.ok(p.expires_at > Date.parse('2026-11-25T12:30:00Z') / 1000 && p.expires_at <= Date.parse('2026-11-25T12:31:00Z') / 1000)
  assert.ok(p.metadata.hold_ref)
  const res = db.rpc('fn_karmi_checkout_reserve')[0].body
  assert.deepEqual(res.p_items, [{ bc: '6101', qty: 1 }])
  assert.equal(res.p_gradient_units, 3)
  assert.equal(db.rpc('fn_karmi_checkout_attach')[0].body.p_session_id, 'cs_test_1')
})

test('Gradient-only recovery follows recovery_off_from: session on 12 Dec has it, on 13 Dec has none', async () => {
  // DB answer for a session created 12 Dec (before recovery_off_from) vs 13 Dec (from it)
  let m = make({ reserveReply: { ...OK_GRADIENT, short_session: true, recovery_ok: true }, now: new Date('2026-12-12T15:00:00Z') })
  await call(m.h, { items: [{ bc: G1, qty: 1 }] })
  assert.deepEqual(m.stripe.created[0].after_expiration, { recovery: { enabled: true, allow_promotion_codes: true } })
  m = make({ reserveReply: { ...OK_GRADIENT, short_session: true, recovery_ok: false }, now: new Date('2026-12-13T15:00:00Z') })
  await call(m.h, { items: [{ bc: G1, qty: 1 }] })
  assert.deepEqual(m.stripe.created[0].after_expiration, { recovery: { enabled: false } })
})

test('webhook: a late Gradient payment is flagged (note + push), never refunded', async () => {
  const { flagLateOrder } = await import('../api/stripe-webhook.js')
  for (const flagged of [true, false]) {
    const calls = []
    const fetchImpl = async (url, o) => {
      calls.push(url)
      if (url.includes('/rpc/fn_karmi_flag_late_order')) {
        assert.equal(JSON.parse(o.body).p_session_id, 'cs_live_late')
        return { ok: true, status: 200, json: async () => (flagged ? { flagged: true, reason: 'paid after the Christmas cut-off', order_id: 'o1' } : { flagged: false }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const d = await flagLateOrder({ id: 'cs_live_late' }, { env: { base: 'https://db.test', key: 'k' }, appUrl: 'https://ops.test', fetchImpl })
    assert.equal(d.flagged, flagged)
    assert.equal(calls.some((u) => u.includes('/api/orders/notify')), flagged)
    assert.ok(!calls.some((u) => /refund|cancel/.test(u)), 'no refund / cancel call')
  }
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
  assert.equal(m.stripe.created[0].after_expiration.recovery.enabled, true)
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

// ───────────────────────────── F1 resolver, overshoot alarm, F6 notify bearer ─────────────────────────────

/** fake ops DB that also answers the F1 RPCs; toCheck = session ids fn_karmi_holds_to_check returns */
function fakeDbF1({ toCheck = [], over = [], flagged = false } = {}) {
  const base = fakeDb({ reserveReply: OK_GRADIENT })
  const fn = async (url, opts = {}) => {
    if (url.includes('/rpc/fn_karmi_holds_to_check')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => toCheck }
    }
    if (url.includes('/rpc/fn_karmi_checkout_resolve') || url.includes('/rpc/fn_karmi_checkout_complete')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => 1 }
    }
    if (url.includes('/rpc/fn_karmi_cap_overshoot')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => ({ over }) }
    }
    if (url.includes('/rpc/fn_karmi_flag_late_order')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => (flagged ? { flagged: true, reason: 'paid after the Christmas cut-off' } : { flagged: false }) }
    }
    if (url.includes('/api/orders/notify') || (url.endsWith('/rest/v1/online_orders') && opts.method === 'POST')) {
      base.calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers })
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' }
    }
    return base(url, opts)
  }
  fn.calls = base.calls
  fn.rpc = base.rpc
  return fn
}

const stripeWithSessions = (statuses) => {
  const s = fakeStripe()
  s.retrieved = []
  s.checkout.sessions.retrieve = async (id) => {
    s.retrieved.push(id)
    if (statuses[id] === 'throw') throw new Error('stripe down')
    return { id, status: statuses[id] }
  }
  return s
}

test('F1 checkout: before admission, holds past their time are settled from Stripe (complete counts, expired freed, error keeps counting)', async () => {
  const db = fakeDbF1({ toCheck: ['cs_paid', 'cs_gone', 'cs_err', 'cs_open'] })
  const stripe = stripeWithSessions({ cs_paid: 'complete', cs_gone: 'expired', cs_err: 'throw', cs_open: 'open' })
  const h = createHandler({ stripe, env, fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
  const r = await call(h, { items: [{ bc: G1, qty: 1 }] })
  assert.equal(r.status, 200)
  assert.deepEqual(stripe.retrieved, ['cs_paid', 'cs_gone', 'cs_err', 'cs_open'])
  assert.deepEqual(db.rpc('fn_karmi_checkout_resolve').map((c) => [c.body.p_session_id, c.body.p_outcome]),
    [['cs_paid', 'complete'], ['cs_gone', 'expired']], 'unknown outcomes are not reported: those holds keep counting')
  const order = db.calls.map((c) => c.url).filter((u) => /holds_to_check|checkout_reserve/.test(u))
  assert.ok(order[0].includes('holds_to_check') && order[1].includes('checkout_reserve'), 'resolver runs before reserve')
})

test('F1 checkout: resolver failure never blocks or changes the admission', async () => {
  const db = fakeDbF1({ toCheck: ['cs_x'] })
  const stripe = stripeWithSessions({ cs_x: 'throw' })
  const h = createHandler({ stripe, env, fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
  assert.equal((await call(h, { items: [{ bc: G1, qty: 1 }] })).status, 200)
  assert.equal(db.rpc('fn_karmi_checkout_resolve').length, 0)
})

test('F1 /api/stock: settles stale holds before reading capped status (so an expired session cannot block the page)', async () => {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const { _setStripe } = await import('../api/stock.js')
  const real = globalThis.fetch
  const db = fakeDbF1({ toCheck: ['cs_gone'] })
  try {
    globalThis.fetch = db
    _setStripe(stripeWithSessions({ cs_gone: 'expired' }))
    let body
    const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
    await stockHandler({ query: { bc: '6101' } }, res)
    assert.equal(body.ok, true, body.error)
    assert.deepEqual(db.rpc('fn_karmi_checkout_resolve').map((c) => c.body.p_outcome), ['expired'])
    const urls = db.calls.map((c) => c.url)
    assert.ok(urls.findIndex((u) => u.includes('checkout_resolve')) < urls.findIndex((u) => u.includes('online_status')))
  } finally {
    globalThis.fetch = real
    _setStripe(undefined)
  }
})

test('F1 overshoot alarm: warning + push on the order-notify route; nothing when within the caps; never refunds', async () => {
  const { alarmOvershoot } = await import('../api/stripe-webhook.js')
  const over = [{ kind: 'product', family: 'stretch_charm', product_id: 'p1', cap: 2, sold: 4, held: 0 }]
  for (const o of [over, []]) {
    const db = fakeDbF1({ over: o })
    const d = await alarmOvershoot({ id: 'cs_late' }, { env: { base: 'https://db.test', key: 'k' }, appUrl: 'https://ops.test', fetchImpl: db, secret: '' })
    assert.deepEqual(d.over, o)
    assert.equal(db.rpc('fn_karmi_cap_overshoot')[0].body.p_session_id, 'cs_late')
    const push = db.calls.filter((c) => c.url === 'https://ops.test/api/orders/notify')
    assert.equal(push.length, o.length ? 1 : 0)
    if (o.length) {
      assert.equal(push[0].body.title, 'Karmi online cap exceeded: manual check')
      assert.match(push[0].body.detail, /stretch_charm product: 4 sold \+ 0 held > cap 2/)
    }
    assert.ok(!db.calls.some((c) => /refund|cancel/.test(c.url)), 'no refund / cancel call')
  }
})

test('F6: every /api/orders/notify push sends the WEBHOOK_SECRET bearer when it is set, and no Authorization when not', async () => {
  const { notifyHeaders } = await import('../api/_caps-lib.js')
  const wh = await import('../api/stripe-webhook.js')
  assert.deepEqual(notifyHeaders('s3cret'), { 'Content-Type': 'application/json', Authorization: 'Bearer s3cret' })
  assert.deepEqual(notifyHeaders(''), { 'Content-Type': 'application/json' })
  const saved = { ...process.env }
  const realFetch = globalThis.fetch
  const realWarn = console.warn, realLog = console.log, realErr = console.error
  const logged = []
  console.warn = console.log = console.error = (...a) => logged.push(a.map(String).join(' '))
  try {
    for (const secret of ['s3cret-test-value', undefined]) {
      if (secret) process.env.WEBHOOK_SECRET = secret; else delete process.env.WEBHOOK_SECRET
      process.env.OPS_SUPABASE_URL = 'https://db.test'
      process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
      process.env.OPS_APP_URL = 'https://ops.test'
      const db = fakeDbF1({ over: [{ kind: 'family', family: 'hair', cap: 1, sold: 2, held: 0 }], flagged: true })
      globalThis.fetch = db
      // 1) new-order push (recordOrder), 2) late-order flag push, 3) overshoot alarm push — env defaults, no injection
      await wh.recordOrder({ id: 'cs_1', metadata: { items: '6101x1' }, customer_details: {} })
      await wh.flagLateOrder({ id: 'cs_1' }, { fetchImpl: db })
      await wh.alarmOvershoot({ id: 'cs_1' }, { fetchImpl: db })
      const pushes = db.calls.filter((c) => c.url === 'https://ops.test/api/orders/notify')
      assert.equal(pushes.length, 3)
      for (const p of pushes) {
        if (secret) assert.equal(p.headers.Authorization, `Bearer ${secret}`)
        else assert.equal('Authorization' in p.headers, false)
        assert.equal(p.headers['Content-Type'], 'application/json')
      }
    }
    assert.ok(!logged.some((l) => l.includes('s3cret-test-value')), 'the secret is never logged')
  } finally {
    globalThis.fetch = realFetch
    console.warn = realWarn; console.log = realLog; console.error = realErr
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})
