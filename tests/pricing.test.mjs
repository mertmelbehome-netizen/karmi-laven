// node --test tests/   (no dependencies)
// Locks the multi-buy maths: the storefront (index.html) and the server (api/checkout.js) must charge the same,
// the bundle builder's TIERS must come from DENOMS, and the copy must not promise a price/bundle the bag does not charge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(ROOT, f), 'utf8')
const grab = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0] }

// --- storefront: evaluate the real DENOMS / TIERS / bestPrice lines from index.html ---
const html = read('index.html')
const clientSrc = [
  grab(html, /const FREE_SHIP=.*$/m, 'FREE_SHIP'),
  grab(html, /const DENOMS=.*$/m, 'client DENOMS'),
  grab(html, /const TIER_LABELS=.*$/m, 'TIER_LABELS'),
  grab(html, /const TIERS=.*$/m, 'TIERS'),
  grab(html, /function bestPrice\(q\)\{.*$/m, 'client bestPrice'),
].join('\n')
const client = new Function(`${clientSrc}\nreturn { FREE_SHIP, DENOMS, TIERS, bestPrice }`)()

// --- server: evaluate the real DENOMS / bestPriceP from api/checkout.js (no Stripe import needed) ---
const api = read('api/checkout.js')
const serverSrc = [
  grab(api, /const DENOMS = .*$/m, 'server DENOMS'),
  grab(api, /function bestPriceP\(q\) \{[\s\S]*?\n\}/, 'server bestPriceP'),
].join('\n')
const server = new Function(`${serverSrc}\nreturn { DENOMS, bestPriceP }`)()

const EXPECTED = { 1: 2.99, 2: 5.50, 3: 7.50, 4: 10.49, 5: 12.00, 6: 14.99, 7: 17.50 }

test('cart: 5 bracelets = £12.00 and 6 bracelets = £14.99 (client and server)', () => {
  assert.equal(client.bestPrice(5), 12.00)
  assert.equal(client.bestPrice(6), 14.99)
  assert.equal(server.bestPriceP(5), 1200)
  assert.equal(server.bestPriceP(6), 1499)
})

test('cart: full 1..7 ladder unchanged, client === server', () => {
  for (const [q, gbp] of Object.entries(EXPECTED)) {
    assert.equal(client.bestPrice(+q), gbp, `client q=${q}`)
    assert.equal(server.bestPriceP(+q), Math.round(gbp * 100), `server q=${q}`)
  }
  for (let q = 1; q <= 99; q++) assert.equal(Math.round(client.bestPrice(q) * 100), server.bestPriceP(q), `q=${q}`)
})

test('DENOMS: client ladder equals the server ladder (1/£2.99, 2/£5.50, 3/£7.50, 5/£12)', () => {
  assert.deepEqual(client.DENOMS.map(([n, p]) => [n, Math.round(p * 100)]), server.DENOMS)
  assert.deepEqual(server.DENOMS, [[5, 1200], [3, 750], [2, 550], [1, 299]])
})

test('bundle builder TIERS = DENOMS (same quantities, same prices, every tier charged exactly)', () => {
  assert.deepEqual(client.TIERS.map(t => [t.n, t.price]), [[1, 2.99], [2, 5.50], [3, 7.50], [5, 12.00]])
  for (const t of client.TIERS) assert.equal(client.bestPrice(t.n), t.price, `tier ${t.n}`)
  assert.match(html, /let bTier=5;/)
})

test('free UK delivery threshold is £12 (5 bracelets reach it)', () => {
  assert.equal(client.FREE_SHIP, 12)
  assert.ok(client.bestPrice(5) >= client.FREE_SHIP)
  assert.ok(client.bestPrice(4) < client.FREE_SHIP)
})

test('copy: no "6 for £15", "6-bracelet bundle" or "5-stack" anywhere on the site', () => {
  const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'))
  assert.ok(pages.includes('index.html') && pages.includes('404.html'))
  for (const f of pages) {
    const s = read(f)
    for (const bad of ['6 for £15', '6-bracelet bundle', '5-stack']) assert.ok(!s.includes(bad), `${f} contains "${bad}"`)
  }
})
