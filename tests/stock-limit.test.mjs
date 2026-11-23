// Online sell-limit message (Komuta + K&D 23 Nov 2026). index.html: LIMIT_TXT / limitOf / atLimit / limitText /
// capQty, evaluated as-is. Rules: no scarcity claim and no number (DMCC: the online cap is not real stock); the 2nd
// sentence only under M1, bag < 10, another colour still addable; a cap below stock limits exactly like low stock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const a = HTML.indexOf('var LIMIT_TXT=')
const b = HTML.indexOf('function syncLimits(')
const capA = HTML.indexOf('function capQty(')
const capB = HTML.indexOf('\n', capA)
assert.ok(a > 0 && b > a && capA > 0, 'limit helpers found')
const SRC = HTML.slice(a, b) + '\n' + HTML.slice(capA, capB)

const M1T = { mode: 'cart_qty_groups', cart_qty_tier: { from: 10 } }
function page({ avail, cart, m1 = true }) {
  const DATA = Object.keys(avail).map((barcode) => ({ barcode }))
  const window = { klAvail: (bc) => avail[bc] }
  const totalQty = () => cart.reduce((s, c) => s + c.qty, 0)
  const m1T = () => (m1 ? M1T : null)
  return new Function('window', 'cart', 'DATA', 'totalQty', 'm1T', `${SRC}\n; return { LIMIT_TXT, atLimit, limitText, capQty };`)(window, cart, DATA, totalQty, m1T)
}
const FIRST = 'That’s the most we can sell online in this colour right now.'

test('wording: the agreed first sentence, no "only N left", no "all we have", no stock number', () => {
  const p = page({ avail: { A: 4, B: 9 }, cart: [{ bc: 'A', qty: 4 }] })
  const t = p.limitText('A')
  assert.ok(t.startsWith(FIRST))
  assert.ok(!/only|left|all we have|sold out/i.test(t))
  assert.ok(!/\b[0-9]\b|\b4\b|\b9\b/.test(t.replace('reach 10', '')), 'no stock / cap number in the text')
})

test('2nd sentence only under M1, bag < 10 and another colour still addable', () => {
  assert.equal(page({ avail: { A: 4, B: 9 }, cart: [{ bc: 'A', qty: 4 }] }).limitText('A'), FIRST + ' Add another colour to reach 10.')
  // bag already 10+: first sentence only
  assert.equal(page({ avail: { A: 4, B: 9 }, cart: [{ bc: 'A', qty: 4 }, { bc: 'B', qty: 6 }] }).limitText('A'), FIRST)
  // no other colour can be added (B at its own limit, C sold out): first sentence only
  assert.equal(page({ avail: { A: 4, B: 2, C: 0 }, cart: [{ bc: 'A', qty: 4 }, { bc: 'B', qty: 2 }] }).limitText('A'), FIRST)
  // today's pools table (no M1): first sentence only, never "reach 10"
  assert.equal(page({ avail: { A: 4, B: 9 }, cart: [{ bc: 'A', qty: 4 }], m1: false }).limitText('A'), FIRST)
})

test('online cap below real stock limits exactly like low stock (klAvail = what we can sell online)', () => {
  // 1266-style: stock 9, online cap 4 -> klAvail 4 -> limit at 4
  const cap = page({ avail: { A: 4 }, cart: [{ bc: 'A', qty: 4 }] })
  assert.equal(cap.atLimit('A'), true)
  assert.equal(page({ avail: { A: 4 }, cart: [{ bc: 'A', qty: 3 }] }).atLimit('A'), false)
  // stock-bound: 9 in stock, no lower cap -> limit at 9
  assert.equal(page({ avail: { A: 9 }, cart: [{ bc: 'A', qty: 9 }] }).atLimit('A'), true)
  // sold out / not sellable (0) and "stock not loaded yet" (Infinity) never show the message
  assert.equal(page({ avail: { A: 0 }, cart: [] }).atLimit('A'), false)
  assert.equal(page({ avail: { A: Infinity }, cart: [{ bc: 'A', qty: 50 }] }).atLimit('A'), false)
})

test('bag quantity box / + never go past the online limit', () => {
  const p = page({ avail: { A: 4 }, cart: [{ bc: 'A', qty: 4 }] })
  assert.equal(p.capQty('A', 12), 4)
  assert.equal(p.capQty('A', 3), 3)
  assert.equal(page({ avail: { A: Infinity }, cart: [] }).capQty('A', 12), 12)
})

test('markup: card button names the message (aria-describedby) and the message is a polite status, not hidden by a timer', () => {
  assert.match(HTML, /data-bc="\$\{d\.barcode\}" aria-describedby="lim-\$\{d\.barcode\}"/)
  // K&D A1: the live region is never hidden (a region that appears and fills in one tick is often not announced)
  assert.match(HTML, /<div class="lim" id="lim-\$\{d\.barcode\}" role="status" aria-live="polite"><\/div>/)
  assert.match(HTML, /<div class="lim" id="cilim-\$\{i\}" role="status" aria-live="polite"><\/div>/)
  assert.match(HTML, /\.lim:empty\{margin:0\}/)
  // K&D A2: bag + at the limit returns without re-rendering (focus stays)
  assert.match(HTML, /if\(delta>0 && atLimit\(c\.bc\)\) return;/)
  assert.ok(!/lim[^\n]{0,120}setTimeout\([^)]*hidden\s*=\s*true/.test(HTML), 'no timed hide')
  assert.match(HTML, /\.lim\{font-size:12px;[^}]*color:var\(--ink\)/)
})
