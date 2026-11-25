// WCAG 2.2 AA pins (25 Nov 2026, K&D a11y debt before the 30 Nov relaunch). Display / CSS / ARIA only.
// The numbers themselves are measured in a real browser by scripts/dev/a11y_measure.py (docs/A11Y_25NOV.md);
// these tests keep the rules that produce them from being dropped by a later edit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const html = read('index.html')
const sf = read('css/storefront.css')
const a11y = read('css/a11y.css')

test('a11y.css is linked in <head> after the inline <style> and after storefront.css', () => {
  const head = html.slice(0, html.indexOf('</head>'))
  const iSf = head.indexOf('href="/css/storefront.css')
  const iA = head.indexOf('href="/css/a11y.css')
  assert.ok(iSf > 0 && iA > iSf, 'a11y.css must come after storefront.css')
  assert.ok(iA > head.lastIndexOf('</style>'), 'a11y.css must come after the inline <style>')
})

test('1 text size: no font-size below 12 px in index.html or css/storefront.css', () => {
  for (const [name, src] of [['index.html', html], ['css/storefront.css', sf], ['css/a11y.css', a11y]]) {
    const small = [...src.matchAll(/font-size:\s*([0-9.]+)px/g)].filter((m) => parseFloat(m[1]) < 12).map((m) => m[0])
    assert.deepEqual(small, [], `${name}: ${small.join(', ')}`)
  }
  assert.match(a11y, /\.cbody \.pr, \.cbody \.pr s\{ font-size:14px \}/, 'card price line >= 14 px (K&D V-11)')
})

test('2 contrast: the dark small-text tokens apply to the whole page, not only html.kl-v2', () => {
  assert.match(a11y, /:root\{ --soft:#6b6457; --accent:#8a5f58; --gold-text:#7d5f2a \}/)
  assert.match(a11y, /border-color:#857b6b/, 'outlined controls need a >= 3:1 border')
})

test('3 tap targets: 44 x 44 min on the controls that were smaller', () => {
  assert.match(a11y, /\.sw, \.btn, \.cbody \.add[^{]*\{ min-height:44px \}/)
  assert.match(a11y, /\.ci-q button\{ width:44px; height:44px/)
  assert.match(a11y, /\.ci-q input\{ width:56px; height:44px \}/)
  assert.match(a11y, /\.ci-q \.ci-x\{[^}]*height:44px/)
  assert.match(a11y, /\.mclose, \.bundle \.x, \.cart-head button, \.klpop-close\{[^}]*width:44px; height:44px/)
  assert.match(a11y, /\.nudge-add\{[^}]*min-height:44px/)
  assert.match(a11y, /\.kl-dot\{ width:44px; height:44px \}/)
  assert.match(a11y, /\.flinks a\{[^}]*min-height:44px/)
})

test('4 names: every icon-only control has an aria-label', () => {
  assert.match(html, /<button class="mclose" onclick="closeModal\(\)" aria-label="Close">/)
  assert.match(html, /<button class="x" onclick="closeBundle\(\)" aria-label="Close">/)
  assert.match(html, /<button onclick="closeCart\(\)" aria-label="Close bag">/)
  assert.match(html, /changeQty\(\$\{i\},-1\)" aria-label="Remove one">/)
  assert.match(html, /changeQty\(\$\{i\},1\)" aria-label="Add one more"/)
  assert.match(html, /id="klpopEmail" type="email" aria-label="Your email address"/)
  assert.match(html, /onclick="closeEmailPopup\(\)" aria-label="Close">/)
})

test('5 reduced motion: one global rule switches off transitions, animations and smooth scroll', () => {
  const m = a11y.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/)
  assert.ok(m, 'media query present')
  for (const d of ['animation-duration:.01ms !important', 'animation-delay:0s !important', 'transition-duration:.01ms !important', 'transition-delay:0s !important', 'scroll-behavior:auto !important']) {
    assert.ok(m[1].includes(d), d)
  }
  assert.match(m[1], /html \*::before/, 'pseudo-elements too')
  // the one inline smooth scrollIntoView asks the media query first
  const calls = html.match(/scrollIntoView\(\{behavior:[^)]*\)/g) || []
  assert.ok(calls.length >= 1)
  for (const c of calls) assert.match(c, /prefers-reduced-motion: reduce/, c)
})

test('6 help bubble: the bag footer keeps its bottom-right corner clear', () => {
  assert.match(a11y, /\.cart-foot\{ padding-bottom:calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/)
  assert.match(a11y, /#cookie-banner\{ padding-right:84px \}/)
})
