// Design-token rules T-01..T-08 (27 Nov 2026): morning_review/52_designer_review/DESIGN_TOKEN_RULES.md
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HTML = read('../index.html')
const SF = read('../css/storefront.css')
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const root = HTML.match(/:root\{([^}]*)\}/)[1]
const tok = (n) => root.match(new RegExp('--' + n + ':(#[0-9a-fA-F]{6})'))[1]

test('T-01/T-02: :root tokens (no v2 flag needed) meet 4.5:1 on bg and paper', () => {
  assert.equal(tok('soft'), '#766d5e')
  for (const [n, bg] of [['ink', '#faf7f1'], ['soft', '#faf7f1'], ['soft', '#fffefb'], ['gold', '#faf7f1'], ['gold', '#fffefb']]) {
    assert.ok(ratio(tok(n), bg) >= 4.5, `${n} on ${bg}: ${ratio(tok(n), bg).toFixed(2)}`)
  }
})

test('T-03: the old gold #b08d4e (2.90:1 on paper, 4.22:1 on the dark bar) is gone; cookie link #d4b676 on the dark bar >= 4.5', () => {
  assert.equal(tok('gold'), '#85672f')
  assert.doesNotMatch(HTML + SF, /#b08d4e/i)
  assert.match(HTML, /#cookie-banner a\{ color:#d4b676;/)
  assert.ok(ratio('#d4b676', '#34302a') >= 4.5)
})

test('T-04: tab border #7d7464 >= 3:1 (4.31 on bg, 4.57 on paper)', () => {
  assert.match(SF, /\.kl-tabs \[role=tab\]\{[^}]*border:1px solid #7d7464/)
  assert.ok(ratio('#7d7464', '#faf7f1') >= 3 && ratio('#7d7464', '#fffefb') >= 3)
})

test('T-05: no struck / was price colour or element (§18)', () => {
  assert.doesNotMatch(HTML + SF, /#bdb3a3/i)
  assert.doesNotMatch(HTML + SF, /line-through/)
})

test('T-07: Jost body text is weight 400 (300 only on >= 24 px Cormorant headings)', () => {
  assert.match(HTML, /body\{[^}]*font-family:'Jost',sans-serif; font-weight:400;/)
  for (const m of HTML.matchAll(/([^{}\n]+)\{([^}]*font-weight:300[^}]*)\}/g)) {
    assert.match(m[2], /Cormorant/, 'weight 300 on a non-Cormorant rule: ' + m[1].trim())
  }
})

test('T-08: lining numerals on the whole page (Cormorant default is old-style: "70" read as "7o")', () => {
  assert.match(HTML, /body\{[^}]*font-variant-numeric:lining-nums/)
})
