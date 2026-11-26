// View funnel beacon (26 Nov 2026): first-party 'view' events (page view + card view) through flTrack, ONLY with
// cookie consent. The page's own code is evaluated as-is (klConsent / flSid / flTrack, cookieChoice and the
// KL-VIEW block of index.html) against a stub DOM, a stub IntersectionObserver / MutationObserver and a stubbed
// navigator.sendBeacon + fetch, so nothing is sent anywhere.
//   1. no consent / rejected: ZERO beacons and ZERO fetches through a full scroll of every card (classic + families)
//   2. accepted: exactly 1 page view + 1 view per distinct card, none again after re-render / filter / tab switch /
//      back-forward; Accept later in the visit starts it at that moment
//   3. never throws (sendBeacon throwing, no IntersectionObserver); old-Safari-safe; no price / email / personal data
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const VIEW = HTML.match(/\/\*KL-VIEW-START\*\/([\s\S]*?)\/\*KL-VIEW-END\*\//)[1]
const fnSrc = (name) => {
  const i = HTML.indexOf(`function ${name}(`)
  assert.ok(i >= 0, name)
  // the function ends at the first line that closes it at column 0 ("}") or on its own one-liner
  const line = HTML.slice(i, HTML.indexOf('\n', i))
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line
  return HTML.slice(i, HTML.indexOf('\n}', i) + 2)
}
const PAGE = [fnSrc('klConsent'), fnSrc('flSid'), fnSrc('flTrack'), fnSrc('cookieChoice'), VIEW].join('\n')

// ---------- stub DOM ----------
function el(attrs = {}, kids = [], text = '') {
  const e = {
    nodeType: 1, attrs, kids, text, parent: null,
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    matches: (sel) => sel === '[data-kl-card][data-bc]' && 'data-kl-card' in e.attrs && 'data-bc' in e.attrs,
    all() { return e.kids.flatMap((k) => [k, ...k.all()]) },
    querySelectorAll: (sel) => e.all().filter((k) => k.matches(sel)),
    querySelector: (sel) => (sel === '.nm' ? e.all().find((k) => k.attrs.class === 'nm') || null : null),
    get textContent() { return e.text },
  }
  kids.forEach((k) => { k.parent = e })
  return e
}
const card = (bc, name) => el({ 'data-kl-card': '', 'data-bc': bc }, [el({ class: 'nm' }, [], `  ${name}\n `)])

function makePage({ consent = null, io = true, mo = true, beaconThrows = false, noBeacon = false } = {}) {
  const store = {}, sess = {}
  if (consent) store.kl_cookie_consent = consent
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
  const sessionStorage = { getItem: (k) => (k in sess ? sess[k] : null), setItem: (k, v) => { sess[k] = String(v) }, removeItem: (k) => { delete sess[k] } }
  const beacons = [], fetches = []
  const navigator = { sendBeacon: (url, blob) => { if (beaconThrows) throw new Error('boom'); beacons.push({ url, body: JSON.parse(blob.text) }); return true } }
  if (noBeacon) delete navigator.sendBeacon
  const fetch = (...a) => { fetches.push(a); return Promise.resolve({}) }
  class Blob { constructor(parts) { this.text = parts.join('') } }
  const ios = [], mos = []
  class IO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = new Set(); ios.push(this) }
    observe(e) { this.els.add(e) }
    unobserve(e) { this.els.delete(e) }
    disconnect() { this.els.clear() }
  }
  class MO { constructor(cb) { this.cb = cb; mos.push(this) } observe() {} disconnect() {} }
  const body = el({}, [])
  const banner = { classList: { remove() {}, add() {} }, style: {} }
  const document = { body, getElementById: (id) => (id === 'cookie-banner' ? banner : null) }
  const window = { IntersectionObserver: io ? IO : undefined, MutationObserver: mo ? MO : undefined }
  const calls = { analytics: 0, firstTouch: 0 }
  const f = new Function('window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'fetch', 'Blob', 'IntersectionObserver', 'MutationObserver', 'setTimeout', 'initConsentedAnalytics', 'klRememberFirstTouch',
    `${PAGE}\n;return { cookieChoice, klView, klViewStart, flTrack };`)
  const api = f(window, document, localStorage, sessionStorage, navigator, fetch, Blob, window.IntersectionObserver, window.MutationObserver, () => {}, () => { calls.analytics++ }, () => { calls.firstTouch++ })
  /** add nodes to the page the way render() / storefront.js do, and let the MutationObserver see them */
  function add(parent, nodes) {
    nodes.forEach((n) => { n.parent = parent; parent.kids.push(n) })
    mos.forEach((m) => m.cb([{ addedNodes: nodes }]))
  }
  function clear(parent) { parent.kids.length = 0 }
  /** scroll through EVERY card in the page (observed or not): each one fully on screen once */
  function scrollAll(ratio = 1) {
    const all = body.querySelectorAll('[data-kl-card][data-bc]')
    ios.forEach((o) => o.cb(all.filter((c) => o.els.has(c)).map((c) => ({ target: c, isIntersecting: ratio > 0, intersectionRatio: ratio }))))
    return all.length
  }
  return { api, body, add, clear, scrollAll, beacons, fetches, ios, mos, store, calls }
}

// the page as it is used: classic Gradient grid + families grid (+ a gifts tab that repeats barcodes)
function buildGrids(p) {
  const grid = el({ id: 'grid' }, []), fam = el({ id: 'klFamGrid' }, [])
  p.add(p.body, [grid, fam])
  p.add(grid, ['1266', '1267', '1268', '1269'].map((bc, i) => card(bc, `Gradient ${i}`)))
  p.add(fam, ['80030', '80028', '6002'].map((bc, i) => card(bc, `Charm ${i}`)))
  return { grid, fam }
}
const views = (p) => p.beacons.filter((b) => b.body.event_type === 'view')
const pageViews = (p) => views(p).filter((b) => !('product_bc' in b.body))
const cardViews = (p) => views(p).filter((b) => 'product_bc' in b.body)

// ---------- 1. no consent = nothing ----------

for (const consent of [null, 'rejected', 'garbage']) {
  test(`consent ${consent === null ? 'not given' : JSON.stringify(consent)}: 0 beacons, 0 fetches through a full scroll of all cards`, () => {
    const p = makePage({ consent })
    const { grid, fam } = buildGrids(p)
    assert.equal(p.ios.length, 0, 'no IntersectionObserver is created before consent')
    assert.equal(p.mos.length, 0, 'no MutationObserver is created before consent')
    const n = p.scrollAll()
    assert.equal(n, 7)
    // filter, tab switch, re-render: still nothing
    p.clear(grid); p.add(grid, [card('1266', 'Gradient 0')]); p.clear(fam); p.add(fam, [card('6009', 'Hair 1')]); p.scrollAll()
    p.api.klViewStart(); p.scrollAll()
    assert.equal(p.beacons.length, 0)
    assert.equal(p.fetches.length, 0)
    assert.equal(p.store.kl_sid, undefined, 'no session id written to the device')
  })
}

test('no consent and no sendBeacon either: fetch is not used (0 calls)', () => {
  for (const consent of [null, 'rejected']) {
    const p = makePage({ consent, noBeacon: true })
    buildGrids(p); p.scrollAll(); p.api.klViewStart(); p.scrollAll()
    assert.equal(p.fetches.length, 0)
  }
  const q = makePage({ consent: 'accepted', noBeacon: true })
  buildGrids(q); q.scrollAll()
  assert.equal(q.fetches.length, 8, 'with consent the fetch fallback carries the same 1 + 7 events')
})

// ---------- 2. accepted = 1 page view + 1 per distinct card ----------

test('accepted on load: exactly 1 page view + 1 view per distinct card, no duplicates after re-render / filter / tab switch / back-forward', () => {
  const p = makePage({ consent: 'accepted' })
  assert.equal(pageViews(p).length, 1, 'page view at load')
  const { grid, fam } = buildGrids(p)
  assert.equal(cardViews(p).length, 0, 'nothing before a card is on screen')
  p.scrollAll(0.3)
  assert.equal(cardViews(p).length, 0, 'under 50% visible is not a view')
  p.scrollAll(1)
  assert.deepEqual(cardViews(p).map((b) => b.body.product_bc).sort(), ['1266', '1267', '1268', '1269', '6002', '80028', '80030'])
  // filter (colour) = grid rebuilt with fewer, same barcodes; un-filter = all again
  p.clear(grid); p.add(grid, [card('1268', 'Gradient 2')]); p.scrollAll()
  p.clear(grid); p.add(grid, ['1266', '1267', '1268', '1269'].map((bc) => card(bc, 'x'))); p.scrollAll()
  // tab switch: families grid re-rendered, gifts repeat 2 barcodes and add 1 new
  p.clear(fam); p.add(fam, [card('80030', 'Charm 0'), card('1266', 'Gradient 0'), card('6017', 'Gift 1')]); p.scrollAll()
  // back / forward (bfcache restore = same page, the observers fire again on the same nodes)
  p.scrollAll(); p.api.klViewStart(); p.api.klViewStart(); p.scrollAll()
  const bcs = cardViews(p).map((b) => b.body.product_bc)
  assert.equal(new Set(bcs).size, bcs.length, `no duplicates: ${bcs}`)
  assert.equal(bcs.length, 8, 'the 7 first cards + the 1 new gift card')
  assert.equal(pageViews(p).length, 1, 'still 1 page view')
  assert.equal(p.ios.length, 1, 'one observer for the whole visit')
  // payload: session id + type + barcode + trimmed name; no price, no email, nothing else
  const cv = cardViews(p)[0].body
  assert.deepEqual(Object.keys(cv).sort(), ['event_type', 'product_bc', 'product_name', 'session_id'])
  assert.match(cv.session_id, /^kl-/)
  assert.equal(cardViews(p).find((b) => b.body.product_bc === '1266').body.product_name, 'Gradient 0')
  assert.deepEqual(Object.keys(pageViews(p)[0].body).sort(), ['event_type', 'session_id'])
  for (const b of p.beacons) assert.equal(b.url, 'https://melbehome-ops-v2.vercel.app/api/track')
  assert.equal(p.fetches.length, 0)
})

test('Accept later in the visit: nothing before the click; at the click 1 page view, then card views start', () => {
  const p = makePage({ consent: null })
  buildGrids(p); p.scrollAll()
  assert.equal(p.beacons.length, 0)
  p.api.cookieChoice(true)
  assert.equal(p.store.kl_cookie_consent, 'accepted')
  assert.equal(p.calls.analytics, 1, 'existing accept behaviour kept')
  assert.equal(pageViews(p).length, 1, 'page view at the moment of consent')
  assert.equal(p.ios.length, 1, 'cards observed from now on')
  p.scrollAll()
  assert.equal(cardViews(p).length, 7, 'cards already on the page are covered too')
  p.api.cookieChoice(true); p.scrollAll()
  assert.equal(pageViews(p).length, 1, 'a second Accept does not send a 2nd page view')
  assert.equal(cardViews(p).length, 7)
})

test('Reject later: nothing is ever sent; accept then reject mid-visit stops further card views', () => {
  const p = makePage({ consent: null })
  buildGrids(p); p.api.cookieChoice(false); p.scrollAll()
  assert.equal(p.beacons.length, 0)
  const q = makePage({ consent: 'accepted' })
  const { fam } = buildGrids(q)
  q.api.cookieChoice(false)
  q.scrollAll(); q.add(fam, [card('7058', 'New')]); q.scrollAll()
  assert.equal(cardViews(q).length, 0, 'flTrack checks consent on every send')
  assert.equal(pageViews(q).length, 1, 'only the page view sent while consent was on')
})

// ---------- 3. never throws, old browsers ----------

test('no IntersectionObserver: page view only, no card views, no throw', () => {
  const p = makePage({ consent: 'accepted', io: false })
  buildGrids(p)
  assert.doesNotThrow(() => { p.scrollAll(); p.api.klViewStart(); p.api.cookieChoice(true) })
  assert.equal(pageViews(p).length, 1)
  assert.equal(cardViews(p).length, 0)
})

test('no MutationObserver: cards on the page at start are still observed, no throw', () => {
  const p = makePage({ consent: null, mo: false })
  buildGrids(p)
  p.api.cookieChoice(true); p.scrollAll()
  assert.equal(cardViews(p).length, 7)
})

test('sendBeacon throwing never breaks the page', () => {
  assert.doesNotThrow(() => { const p = makePage({ consent: 'accepted', beaconThrows: true }); buildGrids(p); p.scrollAll() })
})

test('static: one KL-VIEW block, Accept hooks it, event type is the server-allowed "view" (never view_item), no price / email / deal', () => {
  assert.equal(HTML.split('/*KL-VIEW-START*/').length, 2)
  assert.match(fnSrc('cookieChoice'), /if\(accepted\)\{ try\{ if\(typeof klViewStart==='function'\) klViewStart\(\); \}catch\(e\)\{\} \}/)
  const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.deepEqual([...code.matchAll(/flTrack\('([a-z_]+)'/g)].map((m) => m[1]), ['view', 'view'])
  assert.doesNotMatch(HTML, /flTrack\('view_item'/)
  assert.doesNotMatch(code, /value|price|email|deal|checkout|cart|fetch\(|sendBeacon/i)
  assert.match(code, /threshold:\[0\.5\]/)
  assert.match(code, /typeof window\.IntersectionObserver!=='function'/, 'IntersectionObserver feature-detected')
  // K-08 wording: no forbidden word in the block's strings
  const strings = [...code.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0])
  for (const s of strings) assert.doesNotMatch(s, /hand-strung|diamond|\blux\b|\bstone\b|crystal|best|finest|premium|genuine|sterling/i, s)
})
