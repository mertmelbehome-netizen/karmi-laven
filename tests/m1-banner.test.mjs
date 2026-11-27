import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
// Mert 27 Nov 2026: "70% off / From 1.50 / Instant when you buy 10+ items, no code needed" is the strongest message; it leads the page above the delivery bar.
test('10+ banner sits above the delivery bar: 70% off + its condition, From lowest 10+ price (whole table), instant + no code; no was / save', () => {
  const m = HTML.match(/<div class="m1bar" data-kl-m1="bar">([\s\S]*?)<\/div>\s*<div class="announce">/)
  assert.ok(m, 'm1bar directly above the announce bar')
  assert.equal(m[1], '<b class="bm-pct">70% off</b> <span class="bm-when">when you buy 10+ items</span> <span class="bm-from">From £1.50 each</span> <span class="bm-how">No code needed. Applied instantly.</span>')
  assert.doesNotMatch(m[1], /\bwas\b|\bsave\b|strike|free gift/i)
  assert.equal((HTML.match(/class="m1bar"/g) || []).length, 1)
})

// 27 Nov 2026 (Mert: 'Üst şerit çok üstte'): in the families view (production) the strip is off and its text leads hero
// slide 1 instead (same m1Texts().bar key, tests/hero-slider.test.mjs); the strip stays for the old page only (families off)
test('families view: the strip is off and the same offer line (same key, same text) leads hero slide 1', () => {
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  assert.match(css, /\nhtml\.kl-v2 \.m1bar\{display:none\}/)
  const bar = HTML.match(/<div class="m1bar" data-kl-m1="bar">([\s\S]*?)<\/div>/)[1]
  assert.ok(HTML.includes(`<p class="kl-hs-offer" data-kl-m1="bar">${bar}</p>`))
  assert.equal((HTML.match(/data-kl-m1="bar"/g) || []).length, 2, 'strip (old page) + slide 1 (families view): one shows at a time')
})

test('phone: the banner is one line (the no-code line is desktop-only) so the first card stays above the sticky bar (V-01)', () => {
  assert.ok(HTML.includes('@media(max-width:620px){.m1bar{padding:2px 8px 1px;') && HTML.includes('.m1bar .bm-how{display:none}}'))
})
