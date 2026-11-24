// Old-Safari guard (K&D #89 B1, Komuta 24 Nov 2026): a regex lookbehind in an inline <script> is a PARSE error on
// Safari < 16.4 (iOS <= 16.3), which kills the whole block - on 24 Nov that block held addToCart() and checkout().
// Node supports all of this, so the other tests cannot see it. This test reads every browser-side script (inline
// <script> blocks of the root *.html pages + js/*.js) and fails on syntax / APIs newer than Safari 14.
// Server code (api/) runs on Node and is not checked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')

const RULES = [
  [/\(\?<[=!]/, 'regex lookbehind (?<= / (?<! - Safari 16.4'],
  [/\?\?=|\|\|=|&&=/, 'logical assignment ??= ||= &&= - Safari 14'],
  [/\.at\(\s*-?\d/, 'Array/String .at() - Safari 15.4'],
  [/\bstructuredClone\s*\(/, 'structuredClone() - Safari 15.4'],
  [/\.findLast(Index)?\s*\(/, 'findLast / findLastIndex - Safari 15.4'],
  [/\bObject\.hasOwn\s*\(/, 'Object.hasOwn() - Safari 15.4'],
  [/\bstatic\s*\{/, 'class static block - Safari 16.4'],
]

/** [{ file, block, code }] for every browser-side script. */
function browserScripts() {
  const out = []
  for (const f of readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const html = read(f)
    const re = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/g
    let m, i = 0
    while ((m = re.exec(html))) out.push({ file: f, block: i++, code: m[1] })
  }
  for (const f of readdirSync(new URL('js/', ROOT)).filter((n) => n.endsWith('.js'))) out.push({ file: `js/${f}`, block: 0, code: read(`js/${f}`) })
  return out
}

test('browser scripts use nothing newer than Safari 14 (old iPhones must reach checkout)', () => {
  const scripts = browserScripts()
  assert.ok(scripts.length >= 5, 'found the inline scripts and js/*.js')
  assert.ok(scripts.some((s) => s.file === 'index.html' && /function checkout\s*\(/.test(s.code)), 'checkout() is in the scanned set')
  const hits = []
  for (const s of scripts) for (const [re, what] of RULES) if (re.test(s.code)) hits.push(`${s.file} block ${s.block}: ${what}`)
  assert.deepEqual(hits, [])
})

test('the guard itself catches a lookbehind (the 24 Nov #89 case)', () => {
  const sample = "s.replace(/(?<!free with any )\b(\d+\+|\d+ or more) items/g, 'x')"
  assert.ok(RULES.some(([re]) => re.test(sample)))
  assert.ok(!RULES.some(([re]) => re.test("s.replace(/(free with any )?\b(\d+\+) items/g, f)")), 'the K&D replacement passes')
})
