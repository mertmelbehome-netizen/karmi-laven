// U5 (shopper test 26 Nov 2026): the bag's "Now £X each · 70% off ... when your bag has 10+ items" hint read "Now £8 each ...
// (£2.40 each)" under £5 items. Root cause: m1Foot() took the price from t.groups[t.gradient_group] (group B) for the whole
// bag. Now every group in the bag states ITS OWN single / 10+ price, and the bag totals still equal api/checkout.js.
// Barcodes are real ones from the data: A (£5 / £1.50) = Stretch Bracelet 6008, 6002; B (£8 / £2.40) = Gradient Edit 1074, 1111;
// C (£13 / £3.90) = Sparkle Line 81004, 81006 (data/cards.json, api/_gradient.js). Online groups come from the DB lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, publicLadders } from '../api/_pricing.js'
import { createHandler } from '../api/checkout.js'
import { blocks, pageData } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const RAW = JSON.parse(read('../ladders.json'))
const VIEW = publicLadders(LADDERS)

const A = '6008', A2 = '6002', B = '1074', B2 = '1111', C = '81004', C2 = '81006'
const DBGROUP = { [A]: 'A', [A2]: 'A', [C]: 'C', [C2]: 'C' }   // online_group of the non-Gradient lines (DB)
const GRP = (bc) => (bc === B || bc === B2 ? 'B' : DBGROUP[bc])   // Gradient Edit = gradient_group B
const NAME = { [A]: 'Stretch Bracelet — Blush Daisy', [A2]: 'Stretch Bracelet — Sky', [C]: 'Sparkle Line — Gold-tone Swan', [C2]: 'Sparkle Line — Silver Star' }
const HINT = {
  A: 'Now £5 each · 70% off every item when your bag has 10+ items (£1.50 each)',
  B: 'Now £8 each · 70% off every item when your bag has 10+ items (£2.40 each)',
  C: 'Now £13 each · 70% off every item when your bag has 10+ items (£3.90 each)',
}
const SINGLE = { A: '£5', B: '£8', C: '£13' }, TIER = { A: '£1.50', B: '£2.40', C: '£3.90' }
const ALL = ['A', 'B', 'C']

function fnSrc(src, name) {
  const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name)
  let j = src.indexOf('{', i), d = 0, q = null
  for (; j < src.length; j++) {
    const ch = src[j]
    if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') q = ch
    else if (ch === '{') d++
    else if (ch === '}' && --d === 0) break
  }
  return src.slice(i, j + 1)
}
const el = () => ({ textContent: '', innerHTML: '', hidden: false, style: {}, disabled: false, attrs: {},
  setAttribute(k, v) { this.attrs[k] = String(v) }, getAttribute(k) { return this.attrs[k] ?? null }, removeAttribute(k) { delete this.attrs[k] } })
function page() {
  const BY = {}
  for (const d of pageData(HTML)) BY[d.barcode] = d
  for (const bc of [A, A2, C, C2]) BY[bc] = { barcode: bc, type: bc[0] === '6' ? 'Stretch Bracelet' : 'Sparkle Line', color_en: NAME[bc] }
  const byId = {}, doc = { getElementById: (id) => byId[id] || (byId[id] = el()) }
  const PRICE = Number(HTML.match(/\],\s*PRICE=([\d.]+);/)[1])
  const LADDER_TYPES = JSON.parse(HTML.match(/const LADDER_TYPES=(\[[^\]]*\]);/)[1].replace(/'/g, '"'))
  const window = { klPrice: () => null, klGroup: (bc) => DBGROUP[bc] || null, klLadders: VIEW, klGroupList: () => ALL }
  const b = blocks(HTML)
  const glue = ['m1Foot', 'm1LineText', 'itemWord'].map((n) => fnSrc(HTML, n)).join('\n')
  const p = new Function('BY', 'LADDER_TYPES', 'PRICE', 'window', 'document', 'NA_TXT',
    `let cart=[];\n${b.pricing}\n${b.delivery}\n${b.m1}\n${glue}\n; return { setCart: (c) => { cart = c }, applyLadderShipping, m1Foot, m1LineText, m1Summary };`)(BY, LADDER_TYPES, PRICE, window, doc, 'n/a')
  p.applyLadderShipping(VIEW)
  return { p, doc }
}
const { p, doc } = page()

// server: api/checkout.js with the same table; reserve lines carry the DB online_group of the non-Gradient barcodes
const mkDb = () => async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null
  const ok = (b) => ({ ok: true, status: 200, json: async () => b })
  if (url.includes('/product_barcodes?')) return ok(decodeURIComponent(url.match(/barcode=in\.\(([^)]*)\)/)[1]).split(',').map((b) => ({ barcode: b, product_id: 'p' + b })))
  if (url.includes('/stock_levels?')) return ok(url.match(/product_id=in\.\(([^)]*)\)/)[1].split(',').map((x) => ({ product_id: x, stockroom_count: 50 })))
  if (url.includes('/online_orders?')) return ok([])
  if (url.includes('/rpc/fn_karmi_checkout_reserve')) return ok({ ok: true, ref: 'r', short_session: true, recovery_ok: false,
    lines: body.p_items.map((i) => ({ bc: i.bc, product_id: 'p', online_group: DBGROUP[i.bc], price_pence: null, name: NAME[i.bc] })) })
  return ok(1)
}
async function server(items) {
  const stripe = { created: [], checkout: { sessions: { create: async (x) => { stripe.created.push(x); return { id: 'cs', url: 'u' } } } } }
  const h = createHandler({ stripe, ladders: LADDERS, env: () => ({ base: 'https://db.test', key: 'k' }), fetchImpl: mkDb(), now: () => new Date('2026-11-26T12:00:00Z') })
  let status
  const res = { status(c) { status = c; return this }, json() { return this }, end() { return this } }
  await h({ method: 'POST', headers: {}, body: { items }, query: {} }, res)
  assert.equal(status, 200)
  const s = stripe.created[0]
  const lines = s.line_items.reduce((a, l) => a + l.price_data.unit_amount * l.quantity, 0)
  const ship = s.shipping_options[0].shipping_rate_data.fixed_amount.amount
  return { items: lines, ship, total: lines + ship }
}
const gbp = (pence) => '£' + (pence / 100).toFixed(2)

// O&W's six baskets (the sixth is the £30 free-delivery edge: £29 and exactly £30)
const BASKETS = {
  '1: 1xA': [[A, 1]],
  '2: 1xB': [[B, 1]],
  '3: 5xA': [[A, 5]],
  '4: 9 mixed (3A 3B 3C)': [[A, 3], [B, 3], [C, 3]],
  '5: 10 mixed (4A 3B 3C)': [[A, 4], [B, 3], [C, 3]],
  '6a: £29 just under £30 (2B + 1C)': [[B, 2], [C, 1]],
  '6b: exactly £30 (6A)': [[A, 6]],
}

for (const [name, lines] of Object.entries(BASKETS)) {
  test('bag ' + name + ': each line states its OWN group price; totals = api/checkout.js', async () => {
    const cart = lines.map(([bc, qty]) => ({ bc, qty }))
    p.setCart(cart.map((c) => ({ ...c })))
    p.m1Foot()
    const box = doc.getElementById('cartM1'), units = cart.reduce((a, c) => a + c.qty, 0)
    const groups = [...new Set(cart.map((c) => GRP(c.bc)))]
    if (units < 10) {
      // a hint per group in the bag: exactly that group's own prices, nothing from another group
      const shown = groups.length === 1 ? [box.textContent] : [...box.innerHTML.matchAll(/<div>(.*?)<\/div>/g)].map((m) => m[1])
      assert.equal(shown.length, groups.length)
      for (const g of groups) {
        const t = shown.find((s) => s.includes(HINT[g]))
        assert.ok(t, g + ' hint missing: ' + shown.join(' | '))
        if (groups.length > 1) assert.ok(t.startsWith(SINGLE[g] + ' items: '), t)
        for (const o of ALL.filter((x) => x !== g)) {
          assert.ok(!t.includes(HINT[o]), g + ' line shows ' + o + ' price: ' + t)
          assert.ok(!t.includes('(' + TIER[o] + ' each)'), t)
        }
      }
      for (const g of ALL.filter((x) => !groups.includes(x))) assert.ok(!shown.join('|').includes(HINT[g]), 'hint for a group not in the bag: ' + g)
    } else {
      // 10+: the applied line pairs every group's tier price with its own single price; each line shows its own tier price
      const t = box.innerHTML
      for (const g of groups) assert.ok(t.includes(TIER[g] + ' each instead of ' + SINGLE[g]), g + ': ' + t)
      for (const g of ALL.filter((x) => !groups.includes(x))) assert.ok(!t.includes(TIER[g] + ' each instead of'), t)
      for (const c of cart) assert.ok(p.m1LineText(c.bc).includes(TIER[GRP(c.bc)] + ' each'), p.m1LineText(c.bc))
    }
    // totals: the bag footer = what the server charges for the same basket
    const sv = await server(cart)
    const s = p.m1Summary(cart)
    assert.equal(s.charged_pence, sv.items, 'items')
    assert.equal(s.shipping_pence, sv.ship, 'delivery')
    assert.equal(doc.getElementById('cartSub').textContent, gbp(sv.items))
    assert.equal(doc.getElementById('cartTotal').textContent, gbp(sv.total))
  })
}

test('£30 edge: £29.00 pays £3.99 delivery, exactly £30.00 is free (page = server)', async () => {
  const under = await server([{ bc: B, qty: 2 }, { bc: C, qty: 1 }])
  assert.deepEqual([under.items, under.ship], [2900, 399])
  const edge = await server([{ bc: A, qty: 6 }])
  assert.deepEqual([edge.items, edge.ship], [3000, 0])
})

test('regression: the bag hint no longer reads t.groups[t.gradient_group] for the whole bag', () => {
  assert.doesNotMatch(fnSrc(HTML, 'm1Foot'), /gradient_group/)
  assert.equal(RAW.gradient_group, 'B')
})
