// Limit message vs sticky bag band (fix after #43). index.html: bandScrollDelta, evaluated as-is. The message must end
// at least 8px above the band's top; scrollIntoView({block:'nearest'}) alone does not scroll when the message is
// "in view" behind the fixed band.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const a = HTML.indexOf('function bandScrollDelta(')
const b = HTML.indexOf('function showAboveBand(')
assert.ok(a > 0 && b > a, 'bandScrollDelta found')
const bandScrollDelta = new Function(`${HTML.slice(a, b)}\n; return bandScrollDelta;`)()

test('message behind the band: scroll by the overlap plus the 8px gap', () => {
  // 844 viewport, 84px band -> limit 752; message bottom 790 -> 38px
  assert.equal(bandScrollDelta(770, 790, 844, 84, 8), 38)
  // fractional bottoms round up so the gap is never 7.x px
  assert.equal(bandScrollDelta(770, 790.2, 844, 84, 8), 39)
})

test('message clear of the band, or no band: no scroll', () => {
  assert.equal(bandScrollDelta(700, 750, 844, 84, 8), 0)
  assert.equal(bandScrollDelta(700, 752, 844, 84, 8), 0)
  assert.equal(bandScrollDelta(800, 820, 844, 0, 8), 0)
  assert.equal(bandScrollDelta(800, 840, 844, 0, 8), 4)
})

test('never pushes the message top off the screen; default gap 8', () => {
  // very tall message near the top: capped at top - gap
  assert.equal(bandScrollDelta(20, 900, 844, 84, 8), 12)
  assert.equal(bandScrollDelta(4, 900, 844, 84, 8), 0)
  assert.equal(bandScrollDelta(770, 790, 844, 84), 38)
})

test('addToCart at the limit goes through showAboveBand (not a bare scrollIntoView)', () => {
  const i = HTML.indexOf('function addToCart(')
  const body = HTML.slice(i, HTML.indexOf('addToCartSilent(bc); save()', i))
  assert.ok(body.includes('showAboveBand(m)'))
  assert.ok(!body.includes("scrollIntoView({block:'nearest'})"))
})
