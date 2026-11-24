// /api/checkout with a fake Stripe and a fake ops DB (no network). Run: npm test
import './fixtures/use-live-table.mjs' // pools-table tests: frozen 23 Nov table (see the file)
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
    assert.deepEqual(p.after_expiration, { recovery: { enabled: false } }, 'Gradient-only: recovery OFF too (24 Nov 2026)')
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

test('recovery is always off (24 Nov 2026): recovery_ok true or false, 12 Dec or 13 Dec', async () => {
  // DB answer for a session created 12 Dec (before recovery_off_from) vs 13 Dec (from it)
  let m = make({ reserveReply: { ...OK_GRADIENT, short_session: true, recovery_ok: true }, now: new Date('2026-12-12T15:00:00Z') })
  await call(m.h, { items: [{ bc: G1, qty: 1 }] })
  assert.deepEqual(m.stripe.created[0].after_expiration, { recovery: { enabled: false } })
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
  assert.equal(m.stripe.created[0].after_expiration.recovery.enabled, false)
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
function fakeDbF1({ toCheck = [], over = [], flagged = false, reserveReply = OK_GRADIENT, unrecorded = [], unrecordedTotal,
  notifyStatus = 201, notifyHang = false } = {}) {
  const base = fakeDb({ reserveReply })
  const fn = async (url, opts = {}) => {
    if (url.includes('/rpc/fn_karmi_holds_to_check')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => toCheck }
    }
    if (url.includes('/rpc/fn_karmi_checkout_resolve') || url.includes('/rpc/fn_karmi_checkout_complete')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => 1 }
    }
    if (url.includes('/rpc/fn_karmi_paid_unrecorded_mark')) {
      const body = JSON.parse(opts.body)
      base.calls.push({ url, body })
      return { ok: true, status: 200, json: async () => body.p_session_ids.length }
    }
    if (url.includes('/rpc/fn_karmi_paid_unrecorded')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      if (unrecorded === 'error') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ items: unrecorded, total: unrecordedTotal ?? unrecorded.length }) }
    }
    if (url.includes('/rpc/fn_karmi_cap_overshoot')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => ({ over }) }
    }
    if (url.includes('/rpc/fn_karmi_flag_late_order')) {
      base.calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, status: 200, json: async () => (flagged ? { flagged: true, reason: 'paid after the Christmas cut-off' } : { flagged: false }) }
    }
    if (url.includes('/api/orders/notify')) {
      base.calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers })
      if (notifyHang) return new Promise(() => {})
      return { ok: notifyStatus >= 200 && notifyStatus < 300, status: notifyStatus, json: async () => ({}), text: async () => '' }
    }
    if (url.endsWith('/rest/v1/online_orders') && opts.method === 'POST') {
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
  // N2: the checkout path asks Stripe about at most 3 sessions (the 4th waits for the next call / /api/stock)
  assert.deepEqual(db.rpc('fn_karmi_holds_to_check')[0].body.p_limit, 3)
  assert.deepEqual(stripe.retrieved, ['cs_paid', 'cs_gone', 'cs_err'])
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
      assert.match(push[0].body.detail, /stretch_charm product in stretch_charm: 4 sold \+ 0 held > cap 2/)
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

// ───────────────────────────── N2: Stripe latency off the critical path (K&D review of #35) ─────────────────────────────

const hang = () => new Promise(() => {})
const NON_GRADIENT_OK = { ok: true, ref: 'r', short_session: true, recovery_ok: false,
  lines: [{ bc: '6101', product_id: 'p', family: 'stretch_charm', price_pence: 599, name: 'Stretch Charm' }] }

test('N2 resolver: each Stripe lookup has a short timeout and no retries; a hanging one is not reported (keeps counting)', async () => {
  const { resolveStaleHolds } = await import('../api/_caps-lib.js')
  const db = fakeDbF1({ toCheck: ['cs_hang', 'cs_gone', 'cs_paid'] })
  const seenOpts = []
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = async (id, params, opts) => {
    seenOpts.push(opts)
    if (id === 'cs_hang') return hang()
    return { id, status: id === 'cs_gone' ? 'expired' : 'complete' }
  }
  const t0 = Date.now()
  const out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { perCallMs: 80, budgetMs: 2000 })
  const ms = Date.now() - t0
  assert.ok(ms < 1000, `returned after ${ms} ms`)
  assert.equal(out.timedOut, 1)
  assert.equal(out.budgetHit, false)
  assert.deepEqual([out.complete, out.expired], [1, 1])
  assert.deepEqual(db.rpc('fn_karmi_checkout_resolve').map((c) => c.body.p_session_id).sort(), ['cs_gone', 'cs_paid'])
  for (const o of seenOpts) { assert.equal(o.maxNetworkRetries, 0); assert.ok(o.timeout > 0 && o.timeout <= 80) }
})

test('N2 resolver: lookups run in parallel, never more than `concurrency` at once', async () => {
  const { resolveStaleHolds } = await import('../api/_caps-lib.js')
  const ids = Array.from({ length: 10 }, (_, i) => 'cs_' + i)
  const db = fakeDbF1({ toCheck: ids })
  let inFlight = 0, peak = 0
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = async (id) => {
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 40))
    inFlight--
    return { id, status: 'expired' }
  }
  const t0 = Date.now()
  const out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { concurrency: 3, budgetMs: 5000 })
  assert.equal(out.checked, 10)
  assert.equal(out.expired, 10)
  assert.equal(peak, 3)
  assert.ok(Date.now() - t0 < 10 * 40, 'faster than one by one')
})

test('N2 resolver: the whole step returns at its budget even when every call (DB included) hangs; never throws', async () => {
  const { resolveStaleHolds } = await import('../api/_caps-lib.js')
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = hang
  // Stripe hangs
  let db = fakeDbF1({ toCheck: ['a', 'b', 'c', 'd', 'e'] })
  let t0 = Date.now()
  let out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { perCallMs: 5000, budgetMs: 150 })
  assert.ok(Date.now() - t0 < 600)
  assert.equal(db.rpc('fn_karmi_checkout_resolve').length, 0, 'nothing reported: every hold keeps counting')
  // the DB call itself hangs
  const dbHang = async () => hang()
  t0 = Date.now()
  out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: dbHang }, { budgetMs: 150 })
  assert.ok(Date.now() - t0 < 600)
  assert.equal(out.budgetHit, true)
})

test('N2 checkout: Stripe hanging never blocks a Gradient-only cart (≈1.5 s budget) and a capped cart still goes to reserve', async () => {
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = hang
  // Gradient-only
  let db = fakeDbF1({ toCheck: ['cs_a', 'cs_b', 'cs_c'] })
  let h = createHandler({ stripe, env, fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
  let t0 = Date.now()
  let r = await call(h, { items: [{ bc: G1, qty: 1 }] })
  let ms = Date.now() - t0
  assert.equal(r.status, 200)
  assert.ok(ms >= 1000 && ms < 2500, `gradient-only checkout took ${ms} ms`)
  assert.equal(db.rpc('fn_karmi_checkout_resolve').length, 0)
  assert.equal(db.rpc('fn_karmi_checkout_reserve').length, 1)
  // capped product: admission still decided by reserve (stale holds keep counting there = fail closed)
  db = fakeDbF1({ toCheck: ['cs_a'], reserveReply: NON_GRADIENT_OK })
  h = createHandler({ stripe, env, fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z') })
  t0 = Date.now()
  r = await call(h, { items: [{ bc: '6101', qty: 1 }] })
  ms = Date.now() - t0
  assert.equal(r.status, 200)
  assert.ok(ms < 4000, `capped checkout took ${ms} ms`)
  assert.equal(db.rpc('fn_karmi_checkout_reserve').length, 1)
})

test('N2 /api/stock: a hanging Stripe does not hang the storefront stock call', async () => {
  process.env.OPS_SUPABASE_URL = 'https://db.test'
  process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
  const { _setStripe } = await import('../api/stock.js')
  const real = globalThis.fetch
  const db = fakeDbF1({ toCheck: ['cs_a', 'cs_b'] })
  try {
    globalThis.fetch = db
    const stripe = fakeStripe()
    stripe.checkout.sessions.retrieve = hang
    _setStripe(stripe)
    let body
    const res = { setHeader() {}, status() { return this }, json(b) { body = b; return this } }
    const t0 = Date.now()
    await stockHandler({ query: { bc: '6101' } }, res)
    const ms = Date.now() - t0
    assert.ok(ms < 4000, `stock call took ${ms} ms`)
    assert.equal(body.ok, true, body.error)
    assert.equal(body.sellable['6101'], 4)
  } finally {
    globalThis.fetch = real
    _setStripe(undefined)
  }
})

// ───────────────────────────── N1 (404), N3 (paid not recorded), N6 (alarm names the product) ─────────────────────────────
// (updated for K1–K3, K&D review of #36)

const missing404 = () => Object.assign(new Error('No such checkout.session'), { statusCode: 404, code: 'resource_missing' })
const pushes = (db) => db.calls.filter((c) => c.url === 'https://ops.test/api/orders/notify')
async function quiet(fn) {
  const real = { warn: console.warn, error: console.error }
  const logged = []
  console.warn = console.error = (...a) => logged.push(a.map(String).join(' '))
  try { await fn(logged) } finally { console.warn = real.warn; console.error = real.error }
  return logged
}

test('N1 resolver: a session Stripe does not know (404 / resource_missing) is reported as expired, so its hold is freed', async () => {
  const { resolveStaleHolds, _resetPaidCheck } = await import('../api/_caps-lib.js')
  _resetPaidCheck()
  const db = fakeDbF1({ toCheck: ['cs_live_smoke', 'cs_live_err', 'cs_live_paid'] })
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = async (id) => {
    if (id === 'cs_live_smoke') throw missing404()
    if (id === 'cs_live_paid') return { id, status: 'complete' }
    throw Object.assign(new Error('api error'), { statusCode: 500 })
  }
  const out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { paidAlarm: false, keyMode: 'live' })
  assert.deepEqual([out.missing, out.expired, out.complete, out.failed, out.missingBlocked], [1, 1, 1, 1, 0])
  assert.deepEqual(db.rpc('fn_karmi_checkout_resolve').map((c) => [c.body.p_session_id, c.body.p_outcome]).sort(),
    [['cs_live_paid', 'complete'], ['cs_live_smoke', 'expired']], 'a 500 is not an answer: that hold keeps counting')
  _resetPaidCheck()
})

test('K2 mode check: key and session modes read from the prefixes only; a 404 is freed only when both are known and equal', async () => {
  const { resolveStaleHolds, stripeKeyMode, sessionMode, _resetPaidCheck } = await import('../api/_caps-lib.js')
  assert.deepEqual(['sk_live_x', 'rk_live_x', 'sk_test_x', 'rk_test_x', 'pk_live_x', '', undefined].map(stripeKeyMode),
    ['live', 'live', 'test', 'test', 'unknown', 'unknown', 'unknown'])
  assert.deepEqual(['cs_live_a', 'cs_test_a', 'cs_a', null].map(sessionMode), ['live', 'test', 'unknown', 'unknown'])
  const cases = [
    { keyMode: 'test', sid: 'cs_live_a', freed: false }, // test key asked about a live session → 404, NOT freed
    { keyMode: 'live', sid: 'cs_test_a', freed: false },
    { keyMode: 'unknown', sid: 'cs_live_a', freed: false }, // key missing / odd prefix
    { keyMode: 'live', sid: 'cs_a', freed: false }, // session id without a mode
    { keyMode: 'test', sid: 'cs_test_a', freed: true },
  ]
  for (const c of cases) {
    _resetPaidCheck()
    const db = fakeDbF1({ toCheck: [c.sid] })
    const stripe = fakeStripe()
    stripe.checkout.sessions.retrieve = async () => { throw missing404() }
    let out
    const logged = await quiet(async () => {
      out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { paidAlarm: false, keyMode: c.keyMode })
    })
    assert.equal(db.rpc('fn_karmi_checkout_resolve').length, c.freed ? 1 : 0, JSON.stringify(c))
    assert.equal(out.modeMismatch, c.freed ? 0 : 1, JSON.stringify(c))
    if (!c.freed) assert.ok(logged.some((l) => /hold NOT freed/.test(l)), 'logged as an error')
  }
  // default key mode comes from STRIPE_SECRET's prefix; the key itself is never logged
  const saved = process.env.STRIPE_SECRET
  try {
    process.env.STRIPE_SECRET = 'sk_test_SECRETVALUE123'
    _resetPaidCheck()
    const db = fakeDbF1({ toCheck: ['cs_live_z'] })
    const stripe = fakeStripe()
    stripe.checkout.sessions.retrieve = async () => { throw missing404() }
    const logged = await quiet(() => resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: db }, { paidAlarm: false }))
    assert.equal(db.rpc('fn_karmi_checkout_resolve').length, 0)
    assert.ok(logged.some((l) => /live-mode session .* key is test-mode/.test(l)))
    assert.ok(!logged.some((l) => l.includes('SECRETVALUE')), 'the key is never logged')
  } finally {
    if (saved === undefined) delete process.env.STRIPE_SECRET; else process.env.STRIPE_SECRET = saved
    _resetPaidCheck()
  }
})

test('K2 burst guard: more than 3 holds freed by 404 in one run, or most answered sessions 404 → none freed, error + push', async () => {
  const { resolveStaleHolds, _resetPaidCheck } = await import('../api/_caps-lib.js')
  const env = (db) => ({ base: 'https://db.test', key: 'k', fetchImpl: db })
  const opts = { paidAlarm: false, keyMode: 'live', appUrl: 'https://ops.test', secret: 'tok' }
  // (1) 4 sessions, all 404 → burst: none freed, one alarm with the Bearer
  _resetPaidCheck()
  const ids = ['cs_live_1', 'cs_live_2', 'cs_live_3', 'cs_live_4']
  let db = fakeDbF1({ toCheck: ids })
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = async () => { throw missing404() }
  let out
  let logged = await quiet(async () => { out = await resolveStaleHolds(stripe, env(db), opts) })
  assert.equal(out.missingBlocked, 4)
  assert.equal(out.expired, 0)
  assert.equal(db.rpc('fn_karmi_checkout_resolve').length, 0, 'no hold freed')
  assert.ok(logged.some((l) => l.includes('STRIPE 404 BURST')))
  let p = pushes(db)
  assert.equal(p.length, 1)
  assert.equal(p[0].body.title, 'Karmi caps: Stripe 404 burst, holds kept')
  assert.match(p[0].body.detail, /^4 of 4 Stripe sessions answered "does not exist" \(404\)/)
  assert.equal(p[0].headers.Authorization, 'Bearer tok')
  // the alarm is not repeated on the next run within 30 min (still blocked, still logged)
  db = fakeDbF1({ toCheck: ids })
  logged = await quiet(async () => { out = await resolveStaleHolds(stripe, env(db), opts) })
  assert.equal(out.missingBlocked, 4)
  assert.equal(pushes(db).length, 0)
  // (2) more than half of the answered sessions 404 (2 of 3) → blocked
  _resetPaidCheck()
  db = fakeDbF1({ toCheck: ['cs_live_a', 'cs_live_b', 'cs_live_c'] })
  stripe.checkout.sessions.retrieve = async (id) => { if (id === 'cs_live_c') return { id, status: 'complete' }; throw missing404() }
  await quiet(async () => { out = await resolveStaleHolds(stripe, env(db), opts) })
  assert.equal(out.missingBlocked, 2)
  assert.deepEqual(db.rpc('fn_karmi_checkout_resolve').map((c) => c.body.p_outcome), ['complete'], 'real statuses still reported')
  // (3) 1 of 3 → not a burst: freed
  _resetPaidCheck()
  db = fakeDbF1({ toCheck: ['cs_live_a', 'cs_live_b', 'cs_live_c'] })
  stripe.checkout.sessions.retrieve = async (id) => { if (id === 'cs_live_a') throw missing404(); return { id, status: 'expired' } }
  out = await resolveStaleHolds(stripe, env(db), opts)
  assert.deepEqual([out.missingBlocked, out.missing, out.expired], [0, 1, 3])
  // (4) single 404s spread over runs: the 4th within 30 min in this instance is blocked
  _resetPaidCheck()
  stripe.checkout.sessions.retrieve = async (id) => { if (id.startsWith('cs_live_gone')) throw missing404(); return { id, status: 'complete' } }
  const freed = []
  for (let i = 0; i < 4; i++) {
    db = fakeDbF1({ toCheck: ['cs_live_gone' + i, 'cs_live_ok' + i] })
    await quiet(async () => { out = await resolveStaleHolds(stripe, env(db), opts) })
    freed.push(out.missing)
  }
  assert.deepEqual(freed, [1, 1, 1, 0])
  assert.equal(out.missingBlocked, 1)
  // (5) a failed burst push is retried on the next run (not throttled)
  _resetPaidCheck()
  db = fakeDbF1({ toCheck: ids, notifyStatus: 401 })
  stripe.checkout.sessions.retrieve = async () => { throw missing404() }
  await quiet(() => resolveStaleHolds(stripe, env(db), opts))
  db = fakeDbF1({ toCheck: ids })
  await quiet(() => resolveStaleHolds(stripe, env(db), opts))
  assert.equal(pushes(db).length, 1, 'alarm retried after a 401')
  _resetPaidCheck()
})

test('K1: paid-not-recorded alarm names every session, marks ONLY after a 2xx push, exactly the sessions it named', async () => {
  const { resolveStaleHolds, _resetPaidCheck } = await import('../api/_caps-lib.js')
  const item = (n) => ({ session: 'cs_live_u' + n, completed_at: '2026-11-25T09:00:00Z', units: 1,
    lines: [{ name: 'Stretch Charm — Rose', bc: '610' + n, family: 'stretch_charm', qty: 1 }] })
  const items = Array.from({ length: 8 }, (_, i) => item(i + 1))
  const env = (db) => ({ base: 'https://db.test', key: 'k', fetchImpl: db })
  const opts = { appUrl: 'https://ops.test', secret: 'tok' }
  try {
    // 2xx → all 8 named (no more 5-cap), then those 8 marked
    _resetPaidCheck()
    let db = fakeDbF1({ unrecorded: items })
    let out
    const logged = await quiet(async () => { out = await resolveStaleHolds(null, env(db), opts) })
    assert.equal(out.unrecorded, 8)
    assert.deepEqual(db.rpc('fn_karmi_paid_unrecorded_due')[0].body, { p_min_age: '2 hours', p_limit: 20 })
    assert.equal(db.calls.filter((c) => c.url.endsWith('/rpc/fn_karmi_paid_unrecorded')).length, 0, 'the old marking-while-reading function is not called')
    let p = pushes(db)
    assert.equal(p.length, 1)
    assert.equal(p[0].body.title, 'Karmi paid order not recorded: manual check')
    assert.ok(p[0].body.detail.startsWith('8 paid sessions without an order row: cs_live_u1: 1 x Stretch Charm — Rose (6101); '))
    for (const it of items) assert.ok(p[0].body.detail.includes(it.session), it.session)
    assert.equal(p[0].headers.Authorization, 'Bearer tok')
    const mark = db.rpc('fn_karmi_paid_unrecorded_mark')
    assert.equal(mark.length, 1)
    assert.deepEqual(mark[0].body.p_session_ids, items.map((i) => i.session))
    const order = db.calls.map((c) => c.url).filter((u) => /paid_unrecorded|notify/.test(u))
    assert.deepEqual(order.map((u) => u.replace(/^.*\//, '')), ['fn_karmi_paid_unrecorded_due', 'notify', 'fn_karmi_paid_unrecorded_mark'])
    assert.ok(logged.some((w) => w.includes('PAID ORDER NOT RECORDED')))
    assert.ok(!db.calls.some((c) => /release|resolve|refund|cancel/.test(c.url)), 'nothing released, resolved or refunded')
    // throttled: the next call within 5 min does not ask again
    await quiet(() => resolveStaleHolds(null, env(db), opts))
    assert.equal(db.rpc('fn_karmi_paid_unrecorded_due').length, 1)
    // more due than listed: full count + every listed session; only the listed ones are marked
    _resetPaidCheck()
    db = fakeDbF1({ unrecorded: items.slice(0, 3), unrecordedTotal: 31 })
    await quiet(() => resolveStaleHolds(null, env(db), opts))
    assert.ok(pushes(db)[0].body.detail.startsWith('31 paid sessions without an order row (oldest 3 listed; the rest follow in the next alarm): '))
    assert.deepEqual(db.rpc('fn_karmi_paid_unrecorded_mark')[0].body.p_session_ids, ['cs_live_u1', 'cs_live_u2', 'cs_live_u3'])
    // 401 / 500 from notify → counts as NOT sent → nothing marked; the next check alarms again
    for (const notifyStatus of [401, 500]) {
      _resetPaidCheck()
      db = fakeDbF1({ unrecorded: items.slice(0, 1), notifyStatus })
      await quiet(async () => { out = await resolveStaleHolds(null, env(db), opts) })
      assert.equal(pushes(db).length, 1)
      assert.equal(db.rpc('fn_karmi_paid_unrecorded_mark').length, 0, `HTTP ${notifyStatus}: not marked`)
    }
    // hanging notify → awaited with a short timeout inside the request, then not marked
    _resetPaidCheck()
    db = fakeDbF1({ unrecorded: items.slice(0, 1), notifyHang: true })
    const t0 = Date.now()
    await quiet(() => resolveStaleHolds(null, env(db), { ...opts, paidCallMs: 100 }))
    assert.ok(Date.now() - t0 < 1000, 'returns after the push timeout')
    assert.equal(db.rpc('fn_karmi_paid_unrecorded_mark').length, 0)
    // no OPS_APP_URL → no push → not marked
    _resetPaidCheck()
    db = fakeDbF1({ unrecorded: items.slice(0, 1) })
    await quiet(() => resolveStaleHolds(null, env(db), { appUrl: '', secret: '' }))
    assert.equal(db.rpc('fn_karmi_paid_unrecorded_mark').length, 0)
    // DB error → no push, no throw
    _resetPaidCheck()
    const bad = fakeDbF1({ unrecorded: 'error' })
    await quiet(async () => { out = await resolveStaleHolds(null, env(bad), opts) })
    assert.equal(out.unrecorded, 0)
    assert.equal(pushes(bad).length, 0)
  } finally {
    _resetPaidCheck()
  }
})

test('K1: the paid alarm is awaited inside the request even when the hold check used up its budget', async () => {
  const { resolveStaleHolds, _resetPaidCheck } = await import('../api/_caps-lib.js')
  _resetPaidCheck()
  const db = fakeDbF1({ toCheck: ['cs_live_h'], unrecorded: [{ session: 'cs_live_p', units: 1, lines: [] }] })
  const stripe = fakeStripe()
  stripe.checkout.sessions.retrieve = hang
  // Deterministic (was flaky at 103-108 ms on a busy machine, 23 Nov 2026): a hung Stripe lookup times out at
  // min(perCallMs, budget left), i.e. at the same moment as the budget timer, so either could win and budgetHit
  // was a coin toss. Here the hold list itself never answers: only the budget can end the work.
  const slowDb = (url, opts) => (url.includes('/rpc/fn_karmi_holds_to_check') ? hang() : db(url, opts))
  let out
  await quiet(async () => {
    out = await resolveStaleHolds(stripe, { base: 'https://db.test', key: 'k', fetchImpl: slowDb },
      { appUrl: 'https://ops.test', secret: '', perCallMs: 5000, budgetMs: 100, keyMode: 'live' })
  })
  assert.equal(out.budgetHit, true)
  // by the time resolveStaleHolds returned, the push AND the mark already happened (nothing left in the background)
  assert.equal(pushes(db).length, 1)
  assert.deepEqual(db.rpc('fn_karmi_paid_unrecorded_mark')[0].body.p_session_ids, ['cs_live_p'])
  _resetPaidCheck()
})

test('N6 + K3: the overshoot alarm names the product (line name + ordered barcode), its family, and the family line', async () => {
  const { alarmOvershoot } = await import('../api/stripe-webhook.js')
  const over = [
    { kind: 'family', family: 'stretch_charm', name: 'Stretch Charm Bracelet', cap: 4, sold: 5, held: 0 },
    { kind: 'product', family: 'stretch_charm', family_name: 'Stretch Charm Bracelet', product_id: 'p1', name: 'Stretch Charm — Rose',
      bc: '6101', cap: 2, sold: 4, held: 1 },
    { kind: 'product', family: 'hair', product_id: 'p2', name: 'Hair Claw — Pearl', bc: '7001', cap: 1, sold: 2, held: 0 },
  ]
  const db = fakeDbF1({ over })
  await alarmOvershoot({ id: 'cs_late' }, { env: { base: 'https://db.test', key: 'k' }, appUrl: 'https://ops.test', fetchImpl: db, secret: '' })
  assert.equal(pushes(db)[0].body.detail,
    'family Stretch Charm Bracelet (stretch_charm): 5 sold + 0 held > cap 4; '
    + 'Stretch Charm — Rose (6101) in Stretch Charm Bracelet (stretch_charm): 4 sold + 1 held > cap 2; '
    + 'Hair Claw — Pearl (7001) in hair: 2 sold + 0 held > cap 1')
})
