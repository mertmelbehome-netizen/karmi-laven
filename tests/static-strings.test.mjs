// M1 cleanup (K&D N4, 23 Nov 2026): no pools-era price / delivery string is left in any file Vercel serves, and the
// page's static fallbacks equal the served table (ladders.json).
//   "Shipped" = every git-tracked file that .vercelignore does not exclude, minus api/ (serverless functions, not served
//   as static files) and binary assets. The visible texts themselves are checked against m1Texts() in
//   tests/m1-page.test.mjs / tests/m1-70off.test.mjs / tests/delivery.test.mjs (unchanged by this PR).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const BANNED = ['£2.99', 'free from', '£12', '6 for £1']
const BINARY = /\.(jpe?g|png|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|pdf)$/i

/** .vercelignore patterns used here: `dir/` (any depth prefix at the root) and `*.ext` (any depth). */
function ignored(file, patterns) {
  return patterns.some((p) => (p.endsWith('/') ? file.startsWith(p) : p.startsWith('*.') ? file.endsWith(p.slice(1)) : file === p))
}
const PATTERNS = read('.vercelignore').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const TRACKED = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
const SHIPPED = TRACKED.filter((f) => !ignored(f, PATTERNS) && !f.startsWith('api/') && !BINARY.test(f) && f !== '.vercelignore')

test('.vercelignore keeps repo-only folders (docs, tests, db SQL, scripts, *.md) off the site', () => {
  for (const p of ['docs/', 'tests/', 'db/', 'scripts/', '*.md']) assert.ok(PATTERNS.includes(p), p)
  // the functions read these at runtime (vercel.json includeFiles): never ignore them
  for (const f of ['ladders.json', 'ladders-preview/M1_mert_list.json', 'index.html', 'js/storefront.js', 'data/cards.json']) {
    assert.equal(ignored(f, PATTERNS), false, f)
  }
})

test('no shipped static file contains a pools-era string ("£2.99", "free from", "£12", "6 for £1")', () => {
  assert.ok(SHIPPED.includes('index.html') && SHIPPED.includes('js/storefront.js') && SHIPPED.length >= 15, `shipped: ${SHIPPED.join(', ')}`)
  const hits = []
  for (const f of SHIPPED) {
    const text = read(f).toLowerCase()
    for (const b of BANNED) {
      const i = text.indexOf(b.toLowerCase())
      if (i >= 0) hits.push(`${f}: "${b}" … ${text.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, ' ')}`)
    }
  }
  assert.deepEqual(hits, [])
})

// ---------- static fallbacks = ladders.json (used only until /api/stock answers, or when it fails) ----------
const HTML = read('index.html')
const LADDERS = JSON.parse(read('ladders.json'))

test('fallback SHIP in index.html = ladders.json shipping (£1.49, no spend threshold, free with 10+ items)', () => {
  const m = HTML.match(/const SHIP=\{freeP:(\d+|null), feeP:(\d+), freeQty:(\d+|null)\};/)
  assert.ok(m, 'SHIP fallback present')
  const s = LADDERS.shipping
  assert.equal(m[1] === 'null' ? null : Number(m[1]), s.free_threshold_pence)
  assert.equal(Number(m[2]), s.below_threshold_fee_pence)
  assert.equal(m[3] === 'null' ? null : Number(m[3]), s.free_at_qty.enabled ? s.free_at_qty.qty : null)
  // today's numbers, spelled out
  assert.deepEqual([s.free_threshold_pence, s.below_threshold_fee_pence, s.free_at_qty.qty], [null, 149, 10])
})

test('fallback M1_FALLBACK in index.html = ladders.json (prices per group, 10+ tier, shipping, gradient group)', () => {
  const m = HTML.match(/const M1_FALLBACK=(.*?);   \/\/ GO-LIVE/)
  assert.ok(m, 'M1_FALLBACK present')
  const fb = JSON.parse(m[1])
  for (const k of ['version', 'mode', 'rule', 'cart_qty_tier', 'groups', 'gradient_group', 'family_groups']) {
    assert.deepEqual(fb[k], LADDERS[k], k)
  }
  // shipping: the charged fields (the fallback carries the public view's `derived_from`, the file `derive_threshold`)
  for (const k of ['free_threshold_pence', 'below_threshold_fee_pence', 'free_at_qty']) assert.deepEqual(fb.shipping[k], LADDERS.shipping[k], `shipping.${k}`)
})
