// 24 Nov 2026: never state a colour count that is not in stock / shown (only some Gradient colours are sellable online).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('index.html (visible + meta + inline JS copy) carries no shade-count claim', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /fifteen/i)
  assert.doesNotMatch(html, /\b15\s+(faceted|shades|colou?rs)/i)
})
