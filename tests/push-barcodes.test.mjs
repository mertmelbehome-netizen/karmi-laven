// New-order push carries the barcodes (owner rule 27 Nov 2026: Karmi online orders are picked from the WAT display).
// api/stripe-webhook.js orderPushDetail + the recordOrder push body: "bc×qty, … · pick from display", no customer data.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const wh = await import('../api/stripe-webhook.js')

test('orderPushDetail: barcodes with quantities, same barcode summed, order kept', () => {
  assert.equal(wh.orderPushDetail([{ bc: '6101', qty: 2, name: 'Ring' }, { bc: '7202', qty: 1 }, { bc: '6101', qty: 1 }]),
    '6101×3, 7202×1 · pick from display')
  assert.equal(wh.orderPushDetail([{ bc: '', qty: 2 }, { bc: '8', qty: 'x' }]), 'no barcode×2, 8×1 · pick from display')
  assert.equal(wh.orderPushDetail([]), undefined)
  assert.equal(wh.orderPushDetail(null), undefined)
})

test('orderPushDetail: long orders cut with "+N more" within 160 characters, nothing lost from the count', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ bc: `86800000000${String(i).padStart(2, '0')}`, qty: 1 }))
  const s = wh.orderPushDetail(items)
  assert.ok(s.length <= 160, s)
  const shown = s.split(' +')[0].split(', ').length
  assert.equal(shown + Number(/\+(\d+) more/.exec(s)[1]), 30)
})

test('recordOrder: the new-order push detail is the barcodes, never the customer name or email', async () => {
  const saved = { ...process.env }
  const realFetch = globalThis.fetch
  const realWarn = console.warn, realLog = console.log, realErr = console.error
  console.warn = console.log = console.error = () => {}
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers })
    return { ok: true, status: 201, json: async () => ({}), text: async () => '' }
  }
  try {
    process.env.OPS_SUPABASE_URL = 'https://db.test'
    process.env.OPS_SUPABASE_SERVICE_KEY = 'k'
    process.env.OPS_APP_URL = 'https://ops.test'
    process.env.WEBHOOK_SECRET = 'push-test-secret'
    const stripeClient = { checkout: { sessions: { listLineItems: async () => ({ data: [] }) } } }
    await wh.recordOrder({
      id: 'cs_push_1', metadata: { items: '6101x2,7202x1' },
      customer_details: { name: 'Jane Doe', email: 'jane@example.com' },
    }, { stripeClient })
    const push = calls.filter((c) => c.url === 'https://ops.test/api/orders/notify')
    assert.equal(push.length, 1)
    assert.equal(push[0].body.detail, '6101×2, 7202×1 · pick from display')
    assert.equal(push[0].headers.Authorization, 'Bearer push-test-secret')
    const text = JSON.stringify(push[0].body)
    assert.ok(!text.includes('Jane') && !text.includes('jane@'), text)
  } finally {
    globalThis.fetch = realFetch
    console.warn = realWarn; console.log = realLog; console.error = realErr
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})
