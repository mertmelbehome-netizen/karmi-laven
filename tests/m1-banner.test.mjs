import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
// Mert 27 Nov 2026: "70% off / From 1.50 / Instant when you buy 10+ items, no code needed" is the strongest message; it leads the page above the delivery bar.
test('10+ banner sits above the delivery bar: 70% off + its condition, From lowest 10+ price (whole table), instant + no code; no was / save', () => {
  const m = HTML.match(/<div class="m1bar" data-kl-m1="bar">([\s\S]*?)<\/div>\s*<div class="announce">/)
  assert.ok(m, 'm1bar directly above the announce bar')
  assert.equal(m[1], '<b class="bm-pct">70% off</b> <span class="bm-when">when you buy 10+ items</span> <span class="bm-from">· From £1.50 each</span> <span class="bm-how">No code needed. Applied instantly.</span>')
  assert.doesNotMatch(m[1], /\bwas\b|\bsave\b|strike|free gift/i)
  assert.equal((HTML.match(/class="m1bar"/g) || []).length, 1)
})

test('phone: the banner is one line (the no-code line is desktop-only) so the first card stays above the sticky bar (V-01)', () => {
  assert.ok(HTML.includes('@media(max-width:620px){.m1bar{padding:4px 8px 3px}') && HTML.includes('.m1bar .bm-how{display:none}}'))
})
