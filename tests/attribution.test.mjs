// Order attribution (Komuta 24 Nov 2026): api/_attribution.js + its wiring in checkout.js, stripe-webhook.js, index.html.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanUtm, cleanPath, cleanHost, fromBody, toMetadata, fromSession, ATTRIBUTION_KEYS } from '../api/_attribution.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// the ops-v2 CHECK online_orders_utm_shape (migration 20261124110500)
const UTM_RE = /^[a-z0-9_.-]{1,100}$/
const PATH_RE = /^\/[A-Za-z0-9/_.-]{0,199}$/
const HOST_RE = /^[a-z0-9.-]{1,253}$/

test('cleanUtm: lower-case, spaces -> "-", only [a-z0-9_.-], max 100, empty -> null', () => {
  assert.equal(cleanUtm('Facebook'), 'facebook')
  assert.equal(cleanUtm('  Black Friday 2026 '), 'black-friday-2026')
  assert.equal(cleanUtm('paid_social'), 'paid_social')
  assert.equal(cleanUtm('<script>alert(1)</script>'), 'scriptalert1script')
  assert.equal(cleanUtm('x'.repeat(300)).length, 100)
  for (const v of ['', '   ', '!!!', null, undefined, 42, {}]) assert.equal(cleanUtm(v), null, String(v))
  for (const v of ['Facebook', 'Black Friday', 'a.b-c_d']) assert.match(cleanUtm(v), UTM_RE)
})

test('cleanPath: path only (no host / query / fragment), safe characters, must start with "/"', () => {
  assert.equal(cleanPath('/'), '/')
  assert.equal(cleanPath('/gifts?utm_source=x#top'), '/gifts')
  assert.equal(cleanPath('https://karmilaven.com/privacy.html?a=1'), '/privacy.html')
  assert.equal(cleanPath('/a b<c>'), '/abc')
  for (const v of ['', 'gifts', 'javascript:alert(1)', null]) assert.equal(cleanPath(v), null, String(v))
  assert.ok(cleanPath('/' + 'x'.repeat(500)).length <= 200)
  for (const v of ['/', '/gifts?x=1', 'https://karmilaven.com/a/b.html']) assert.match(cleanPath(v), PATH_RE)
})

test('cleanHost: host only (never the URL / query), lower-case, own site -> null', () => {
  assert.equal(cleanHost('https://l.facebook.com/l.php?u=https%3A%2F%2Fkarmilaven.com&h=SECRET'), 'l.facebook.com')
  assert.equal(cleanHost('https://www.Google.co.uk/'), 'www.google.co.uk')
  assert.equal(cleanHost('instagram.com/some/path?x=1'), 'instagram.com')
  assert.equal(cleanHost('https://x.com:8443/a'), 'x.com')
  for (const v of ['https://karmilaven.com/', 'https://www.karmilaven.com/gifts', '', null, 'https://']) assert.equal(cleanHost(v), null, String(v))
  assert.match(cleanHost('https://L.Facebook.com/x'), HOST_RE)
})

test('fromBody -> toMetadata -> fromSession: round trip, only non-empty keys, metadata re-cleaned', () => {
  const a = fromBody({ utm_source: 'Facebook', utm_medium: 'Paid Social', utm_campaign: 'BF-2026', landing: '/gifts?utm_source=facebook', referrer: 'https://l.facebook.com/l.php?u=x' })
  assert.deepEqual(a, { utm_source: 'facebook', utm_medium: 'paid-social', utm_campaign: 'bf-2026', landing_path: '/gifts', referrer_host: 'l.facebook.com' })
  const md = toMetadata(a)
  assert.deepEqual(md, { a_src: 'facebook', a_med: 'paid-social', a_cmp: 'bf-2026', a_land: '/gifts', a_ref: 'l.facebook.com' })
  for (const [k, v] of Object.entries(md)) { assert.ok(k.length <= 40); assert.ok(v.length <= 500) }   // Stripe metadata limits
  assert.deepEqual(fromSession({ metadata: md }), a)
  // a direct visit: nothing at all
  assert.deepEqual(toMetadata(fromBody({ landing: '/', referrer: '' })), { a_land: '/' })
  assert.deepEqual(fromBody(null), { utm_source: null, utm_medium: null, utm_campaign: null, landing_path: null, referrer_host: null })
  assert.deepEqual(fromBody(['x']), fromBody(null))
  // the webhook does not trust metadata: a tampered value is cleaned again, an empty one is left out
  assert.deepEqual(fromSession({ metadata: { a_src: 'EVIL Value!', a_ref: 'https://karmilaven.com/x', a_land: 'no-slash' } }), { utm_source: 'evil-value' })
  assert.deepEqual(fromSession({}), {})
  assert.deepEqual(ATTRIBUTION_KEYS, ['utm_source', 'utm_medium', 'utm_campaign', 'landing_path', 'referrer_host'])
})

test('checkout.js puts the cleaned attribution into the Stripe session metadata', () => {
  const src = read('api/checkout.js')
  assert.ok(src.includes("import { fromBody, toMetadata } from './_attribution.js';"))
  assert.ok(src.includes('...toMetadata(fromBody(req.body?.attribution))'))
})

test('stripe-webhook.js writes the fields and still records the order if the columns are missing', () => {
  const src = read('api/stripe-webhook.js')
  assert.ok(src.includes('...fromSession(s),'))
  assert.match(src, /PGRST204\|42703/)
  const retry = src.slice(src.indexOf('let resp = await post(row);'), src.indexOf('insertStatus = resp.status;'))
  assert.ok(retry.includes('for (const k of ATTRIBUTION_KEYS) delete plain[k];'))
  assert.ok(retry.includes('resp = await post(plain);'))
})

test('index.html: first touch kept only with consent; without consent only this page is sent; reject clears it', () => {
  const src = read('index.html')
  assert.ok(src.includes("function klRememberFirstTouch(){ try{ if(klConsent()!=='accepted') return;"))
  assert.match(src, /function klAttribution\(\)\{ try\{ if\(klConsent\(\)==='accepted'\)\{ var ft=sessionStorage\.getItem\('kl_ft'\)/)
  assert.ok(src.includes('return klTouch(); }'), 'no consent -> the current page only, nothing stored')
  assert.ok(src.includes('attribution:klAttribution()'))
  assert.ok(src.includes("if(accepted){ initConsentedAnalytics(); klRememberFirstTouch(); }"))
  assert.ok(src.includes("sessionStorage.removeItem('kl_ft')"), 'reject clears the stored first touch')
  // nothing stored before consent: the only setItem of kl_ft is behind the consent check
  const setAt = src.indexOf("sessionStorage.setItem('kl_ft'")
  const fn = src.slice(src.indexOf('function klRememberFirstTouch'), setAt)
  assert.ok(fn.includes("klConsent()!=='accepted'") && setAt > 0)
})

test('no import.meta in api/_attribution.js (Vercel CJS rule)', () => {
  assert.ok(!read('api/_attribution.js').includes('import.meta'))
})
