// Command-centre decision 23 Nov 2026: the bead material is NOT verified, so "crystal" must not appear in any
// customer-visible text (page copy, meta/og/twitter, JSON-LD, alt text, colour names, m1Texts(), Stripe line names),
// and no "designed" (UK-designed) claim. Code identifiers / comments / test regex lists are not customer-visible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadLadders, publicLadders } from '../api/_pricing.js'
import { GRADIENT } from '../api/_gradient.js'
import { pageFns, pageData } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const visible = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')

test('no "crystal" in visible index.html (outside <script>/<style>), incl. meta/alt attributes; no "designed" claim', () => {
  assert.doesNotMatch(visible(HTML), /crystal/i)
  assert.doesNotMatch(visible(HTML), /\bdesigned\b/i)
})

test('no "crystal" in JSON-LD, m1Texts(), DATA colour/type names, page string literals or the server Stripe line names', () => {
  for (const m of HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) assert.doesNotMatch(m[1], /crystal/i)
  for (const d of pageData(HTML)) assert.doesNotMatch(`${d.color_en} ${d.type}`, /crystal/i, d.barcode)
  for (const [bc, name] of Object.entries(GRADIENT)) assert.doesNotMatch(name, /crystal/i, bc)
  const v = publicLadders(loadLadders(JSON.parse(read('../ladders-preview/M1_mert_list.json'))).table)
  const p = pageFns(HTML, { ladders: v })
  p.applyLadderShipping(v)
  const T = p.m1Texts()
  assert.ok(T, 'm1Texts() must render with the M1 preview table')
  for (const [k, s] of Object.entries(T)) assert.doesNotMatch(typeof s === 'function' ? String(s(15)) : String(s), /crystal/i, k)
  // every string literal in the page scripts (cart line labels such as 'Bead bracelet', popups, families view)
  const code = [...HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n')
  for (const m of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g)) assert.doesNotMatch(m[0], /crystal/i, m[0])
})

test('review page has no "crystal" / "hand-strung" claim', () => {
  assert.doesNotMatch(visible(read('../review.html')), /crystal|hand-strung/i)
})
