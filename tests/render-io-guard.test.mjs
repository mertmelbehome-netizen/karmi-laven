// Gradient grid fade-in (render() in index.html): without IntersectionObserver the cards must still show (class 'in'),
// not throw and stay at opacity 0. Static check of the guard + a behavioural run of the render tail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = HTML.match(/requestAnimationFrame\(\(\)=>\{const cs=\[\.\.\.grid\.children\];[\s\S]*?cs\.forEach\(c=>io\.observe\(c\)\);\}\);/)

test('render fade-in tail exists and guards IntersectionObserver before using it', () => {
  assert.ok(m, 'render() fade-in tail not found')
  const guard = m[0].indexOf("typeof IntersectionObserver!=='function'")
  assert.ok(guard > -1 && guard < m[0].indexOf('new IntersectionObserver'), 'guard must come before new IntersectionObserver')
})

test('no IntersectionObserver: every card gets class "in", no throw', () => {
  const cards = [0, 1, 2].map(() => ({ style: {}, cls: new Set(), classList: { add(c) { this.owner.cls.add(c) }, owner: null } }))
  cards.forEach((c) => { c.classList.owner = c })
  const grid = { children: cards }
  const run = new Function('grid', 'requestAnimationFrame', 'IntersectionObserver', m[0])
  assert.doesNotThrow(() => run(grid, (f) => f(), undefined))
  cards.forEach((c, i) => { assert.ok(c.cls.has('in')); assert.equal(c.style.transitionDelay, i * 40 + 'ms') })
})

test('with IntersectionObserver: still observes each card (unchanged behaviour)', () => {
  const seen = []
  const cards = [0, 1].map(() => ({ style: {}, classList: { add() {} } }))
  const IO = function (cb) { this.observe = (c) => seen.push(c); this.unobserve = () => {} }
  const run = new Function('grid', 'requestAnimationFrame', 'IntersectionObserver', m[0])
  run({ children: cards }, (f) => f(), IO)
  assert.equal(seen.length, 2)
})
