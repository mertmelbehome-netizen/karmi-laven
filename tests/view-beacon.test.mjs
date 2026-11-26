// View funnel beacon (26 Nov 2026): first-party 'view' events (page view + card view) through flTrack, ONLY with
// cookie consent, deduped per SESSION, hard-capped at 30 per session, card views spaced >= 400 ms apart.
// The page's own code is evaluated as-is (klConsent / flSid / flTrack, cookieChoice and the KL-VIEW block of
// index.html) against a stub DOM, stub IntersectionObserver / MutationObserver, a stub sessionStorage that survives
// a "reload" (a new page on the same storage), fake timers, and a stubbed navigator.sendBeacon + fetch: nothing is
// sent anywhere.
//   1. no consent / rejected: ZERO beacons / fetches / storage writes through a full scroll of every card
//   2. accepted: 1 page view per session + 1 view per product per session, at most 30 in total, 1 per 400 ms
//   3. Accept later / Reject mid-visit; never throws (sendBeacon throwing, no IO / MO / sessionStorage)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const VIEW = HTML.match(/\/\*KL-VIEW-START\*\/([\s\S]*?)\/\*KL-VIEW-END\*\//)[1]
const fnSrc = (name) => {
  const i = HTML.indexOf(`function ${name}(`)
  assert.ok(i >= 0, name)
  const line = HTML.slice(i, HTML.indexOf('\n', i))
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line
  return HTML.slice(i, HTML.indexOf('\n}', i) + 2)
}
const PAGE = [fnSrc('klConsent'), fnSrc('flSid'), fnSrc('flTrack'), fnSrc('cookieChoice'), VIEW].join('\n')

// ---------- stubs ----------
function el(attrs = {}, kids = [], text = '') {
  const e = {
    nodeType: 1, attrs, kids, text,
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    matches: (sel) => sel === '[data-kl-card][data-bc]' && 'data-kl-card' in e.attrs && 'data-bc' in e.attrs,
    all() { return e.kids.flatMap((k) => [k, ...k.all()]) },
    querySelectorAll: (sel) => e.all().filter((k) => k.matches(sel)),
    querySelector: (sel) => (sel === '.nm' ? e.all().find((k) => k.attrs.class === 'nm') || null : null),
    get textContent() { return e.text },
  }
  return e
}
const card = (bc, name = `Piece ${bc}`) => el({ 'data-kl-card': '', 'data-bc': bc }, [el({ class: 'nm' }, [], `  ${name}\n `)])
const storage = (data = {}) => ({
  data, writes: 0,
  getItem(k) { return k in this.data ? this.data[k] : null },
  setItem(k, v) { this.writes++; this.data[k] = String(v) },
  removeItem(k) { delete this.data[k] },
})

/** one page load. Pass the same `local` / `sess` to simulate a reload in the same visit. */
function makePage({ consent = null, local = null, sess = undefined, io = true, mo = true, beaconThrows = false, noBeacon = false } = {}) {
  const ls = local || storage()
  if (!local && consent) ls.data.kl_cookie_consent = consent
  const ss = sess === undefined ? storage() : sess   // null = no sessionStorage (old / private browser)
  const beacons = [], fetches = []
  const navigator = { sendBeacon: (url, blob) => { if (beaconThrows) throw new Error('boom'); beacons.push({ url, body: JSON.parse(blob.text), t: clock.now }); return true } }
  if (noBeacon) delete navigator.sendBeacon
  const fetch = (...a) => { fetches.push(a); return Promise.resolve({}) }
  class Blob { constructor(parts) { this.text = parts.join('') } }
  // fake timers
  const clock = { now: 0, timers: [], id: 0 }
  const setTimeout = (fn, ms) => { const t = { id: ++clock.id, at: clock.now + (ms || 0), fn }; clock.timers.push(t); return t.id }
  const clearTimeout = (id) => { clock.timers = clock.timers.filter((t) => t.id !== id) }
  const tick = (ms) => {
    const end = clock.now + ms
    for (;;) {
      clock.timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const t = clock.timers[0]
      if (!t || t.at > end) break
      clock.timers.shift(); clock.now = t.at; t.fn()
    }
    clock.now = end
  }
  const ios = [], mos = []
  class IO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.els = new Set(); this.off = false; ios.push(this) }
    observe(e) { if (!this.off) this.els.add(e) }
    unobserve(e) { this.els.delete(e) }
    disconnect() { this.els.clear(); this.off = true }
  }
  class MO { constructor(cb) { this.cb = cb; this.off = false; mos.push(this) } observe() {} disconnect() { this.off = true } }
  const body = el({}, [])
  const banner = { classList: { remove() {}, add() {} }, style: {} }
  const document = { body, getElementById: (id) => (id === 'cookie-banner' ? banner : null) }
  const window = { IntersectionObserver: io ? IO : undefined, MutationObserver: mo ? MO : undefined, sessionStorage: ss || undefined }
  const sessionStorage = ss || { getItem() { throw new Error('no storage') }, setItem() { throw new Error('no storage') }, removeItem() { throw new Error('no storage') } }
  const f = new Function('window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'fetch', 'Blob', 'IntersectionObserver', 'MutationObserver', 'setTimeout', 'clearTimeout', 'initConsentedAnalytics', 'klRememberFirstTouch',
    `${PAGE}\n;return { cookieChoice, klView, klViewStart, klViewStop };`)
  const api = f(window, document, ls, sessionStorage, navigator, fetch, Blob, window.IntersectionObserver, window.MutationObserver, setTimeout, clearTimeout, () => {}, () => {})
  function add(parent, nodes) {
    parent.kids.push(...nodes)
    mos.filter((m) => !m.off).forEach((m) => m.cb([{ addedNodes: nodes }]))
  }
  const clear = (parent) => { parent.kids.length = 0 }
  /** fast scroll: EVERY card in the page fully on screen in one go, then optionally let timers run */
  function scrollAll(ratio = 1, wait = 0) {
    const all = body.querySelectorAll('[data-kl-card][data-bc]')
    ios.forEach((o) => { const es = all.filter((c) => o.els.has(c)).map((c) => ({ target: c, isIntersecting: ratio > 0, intersectionRatio: ratio })); if (es.length) o.cb(es) })
    if (wait) tick(wait)
    return all.length
  }
  return { api, body, add, clear, scrollAll, tick, clock, beacons, fetches, ios, mos, ls, ss }
}
function buildGrids(p, nGrad = 4, nFam = 3) {
  const grid = el({ id: 'grid' }, []), fam = el({ id: 'klFamGrid' }, [])
  p.add(p.body, [grid, fam])
  p.add(grid, Array.from({ length: nGrad }, (_, i) => card(String(1266 + i), `Gradient ${i}`)))
  p.add(fam, Array.from({ length: nFam }, (_, i) => card(String(80000 + i), `Charm ${i}`)))
  return { grid, fam }
}
const views = (p) => p.beacons.filter((b) => b.body.event_type === 'view')
const pageViews = (p) => views(p).filter((b) => !('product_bc' in b.body))
const cardViews = (p) => views(p).filter((b) => 'product_bc' in b.body)
const LONG = 60 * 1000

// ---------- 1. no consent = nothing ----------

for (const consent of [null, 'rejected', 'garbage']) {
  test(`consent ${consent === null ? 'not given' : JSON.stringify(consent)}: 0 beacons, 0 fetches, 0 storage writes through a full scroll of 99 cards`, () => {
    for (const noBeacon of [false, true]) {
      const p = makePage({ consent, noBeacon })
      const { grid, fam } = buildGrids(p, 30, 69)
      assert.equal(p.ios.length + p.mos.length, 0, 'no observer is created before consent')
      assert.equal(p.scrollAll(1, LONG), 99)
      p.clear(grid); p.add(grid, [card('1266')]); p.clear(fam); p.add(fam, [card('6009')]); p.scrollAll(1, LONG)
      p.api.klViewStart(); p.scrollAll(1, LONG)
      assert.equal(p.beacons.length, 0)
      assert.equal(p.fetches.length, 0)
      assert.equal(p.ss.writes, 0, 'nothing written to sessionStorage')
      assert.equal(p.ls.data.kl_sid, undefined, 'no session id written to the device')
    }
  })
}

// ---------- 2. accepted ----------

test('accepted: 1 page view + 1 view per distinct card, no repeats after re-render / filter / tab switch / back-forward', () => {
  const p = makePage({ consent: 'accepted' })
  assert.equal(pageViews(p).length, 1, 'page view at load')
  const { grid, fam } = buildGrids(p)
  p.scrollAll(0.3, LONG)
  assert.equal(cardViews(p).length, 0, 'under 50% visible is not a view')
  p.scrollAll(1, LONG)
  assert.deepEqual(cardViews(p).map((b) => b.body.product_bc), ['1266', '1267', '1268', '1269', '80000', '80001', '80002'], 'first seen first')
  p.clear(grid); p.add(grid, [card('1268')]); p.scrollAll(1, LONG)
  p.clear(grid); p.add(grid, ['1266', '1267', '1268', '1269'].map((bc) => card(bc))); p.scrollAll(1, LONG)
  p.clear(fam); p.add(fam, [card('80000'), card('1266'), card('6017', 'Gift 1')]); p.scrollAll(1, LONG)
  p.scrollAll(1, LONG); p.api.klViewStart(); p.api.klViewStart(); p.scrollAll(1, LONG)
  const bcs = cardViews(p).map((b) => b.body.product_bc)
  assert.equal(new Set(bcs).size, bcs.length, `no duplicates: ${bcs}`)
  assert.equal(bcs.length, 8)
  assert.equal(pageViews(p).length, 1)
  const cv = cardViews(p).find((b) => b.body.product_bc === '6017').body
  assert.deepEqual(Object.keys(cv).sort(), ['event_type', 'product_bc', 'product_name', 'session_id'], 'no price / email / anything else')
  assert.equal(cv.product_name, 'Gift 1')
  assert.deepEqual(Object.keys(pageViews(p)[0].body).sort(), ['event_type', 'session_id'])
  for (const b of p.beacons) assert.equal(b.url, 'https://melbehome-ops-v2.vercel.app/api/track')
  assert.equal(p.ss.data.kl_view_n, '9')
  assert.equal(JSON.parse(p.ss.data.kl_view_seen).length, 8)
})

test('hard cap: exactly 30 view beacons per session (1 page + 29 cards) even when 99 cards are scrolled; then observers are disconnected', () => {
  const p = makePage({ consent: 'accepted' })
  const { fam } = buildGrids(p, 30, 69)
  p.scrollAll(1, LONG)
  assert.equal(views(p).length, 30)
  assert.equal(pageViews(p).length, 1)
  assert.equal(cardViews(p).length, 29)
  assert.deepEqual(cardViews(p).map((b) => b.body.product_bc), Array.from({ length: 29 }, (_, i) => String(1266 + i)), 'priority = first cards seen')
  assert.equal(p.ss.data.kl_view_n, '30')
  assert.ok(p.ios.every((o) => o.off) && p.mos.every((m) => m.off), 'IntersectionObserver + MutationObserver disconnected at the cap')
  assert.equal(p.clock.timers.length, 0, 'queue dropped, no timer left')
  // more cards, more scrolling, more starts: nothing
  p.add(fam, [card('7058'), card('7056')]); p.scrollAll(1, LONG); p.api.klViewStart(); p.scrollAll(1, LONG)
  assert.equal(views(p).length, 30)
  // reload in the same session: still capped, nothing at all (not even the page view), no observer created
  const r = makePage({ local: p.ls, sess: p.ss })
  buildGrids(r, 30, 69); r.scrollAll(1, LONG)
  assert.equal(r.beacons.length, 0)
  assert.equal(r.ios.length, 0)
})

test('reload in the same session: page view not sent again, already-seen products not sent again, new ones are', () => {
  const p = makePage({ consent: 'accepted' })
  buildGrids(p, 4, 3); p.scrollAll(1, LONG)
  assert.equal(views(p).length, 8)
  const r = makePage({ local: p.ls, sess: p.ss })   // same visit, page reloaded
  assert.equal(pageViews(r).length, 0, 'page view once per session')
  const { fam } = buildGrids(r, 4, 3)
  assert.equal(r.ios[0].els.size, 0, 'seen products are not even observed')
  r.scrollAll(1, LONG)
  assert.equal(r.beacons.length, 0, '0 new beacons for already-seen products')
  r.add(fam, [card('6017'), card('80001')]); r.scrollAll(1, LONG)
  assert.deepEqual(cardViews(r).map((b) => b.body.product_bc), ['6017'])
  assert.equal(r.ss.data.kl_view_n, '9')
  // a NEW session (fresh sessionStorage) starts again
  const n = makePage({ local: p.ls })
  buildGrids(n, 4, 3); n.scrollAll(1, LONG)
  assert.equal(views(n).length, 8)
})

test('spacing: a fast scroll is sent 1 card view per 400 ms, never a burst', () => {
  const p = makePage({ consent: 'accepted' })
  buildGrids(p, 10, 0)
  p.scrollAll(1)   // all 10 cards on screen at t=0
  assert.equal(cardViews(p).length, 0, 'nothing sent in the same tick')
  p.tick(399); assert.equal(cardViews(p).length, 0)
  p.tick(1); assert.equal(cardViews(p).length, 1)
  p.tick(399); assert.equal(cardViews(p).length, 1)
  p.tick(1); assert.equal(cardViews(p).length, 2)
  p.tick(LONG); assert.equal(cardViews(p).length, 10)
  const ts = cardViews(p).map((b) => b.t)
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 400, `gap ${ts[i] - ts[i - 1]}`)
  assert.equal(p.clock.timers.length, 0, 'no timer left once the queue is empty')
})

// ---------- 3. Accept later / Reject mid-visit / robustness ----------

test('Accept later: nothing before the click; at the click 1 page view, then card views start; 2nd Accept adds nothing', () => {
  const p = makePage({ consent: null })
  buildGrids(p); p.scrollAll(1, LONG)
  assert.equal(p.beacons.length, 0)
  p.api.cookieChoice(true)
  assert.equal(pageViews(p).length, 1)
  p.scrollAll(1, LONG)
  assert.equal(cardViews(p).length, 7)
  p.api.cookieChoice(true); p.scrollAll(1, LONG)
  assert.equal(views(p).length, 8)
})

test('Reject mid-visit stops everything (queued views dropped, observers off); the view keys are left as they are', () => {
  const p = makePage({ consent: 'accepted' })
  const { fam } = buildGrids(p, 10, 0)
  p.scrollAll(1); p.tick(800)
  assert.equal(cardViews(p).length, 2)
  const keep = { ...p.ss.data }
  p.api.cookieChoice(false)
  p.tick(LONG); p.add(fam, [card('7058')]); p.scrollAll(1, LONG)
  assert.equal(cardViews(p).length, 2, 'the 8 queued card views are never sent')
  assert.ok(p.ios.every((o) => o.off) && p.mos.every((m) => m.off))
  assert.equal(p.ss.data.kl_view_n, keep.kl_view_n); assert.equal(p.ss.data.kl_view_seen, keep.kl_view_seen)
  // consent revoked by another tab (no click here): the next flush stops too
  const q = makePage({ consent: 'accepted' })
  buildGrids(q, 10, 0); q.scrollAll(1); q.tick(400)
  q.ls.data.kl_cookie_consent = 'rejected'
  q.tick(LONG); q.scrollAll(1, LONG)
  assert.equal(cardViews(q).length, 1)
})

test('no sessionStorage: falls back to in-memory dedupe + cap for this page load, no throw', () => {
  const p = makePage({ consent: 'accepted', sess: null })
  buildGrids(p, 30, 69)
  assert.doesNotThrow(() => { p.scrollAll(1, LONG); p.api.klViewStart(); p.scrollAll(1, LONG) })
  assert.equal(pageViews(p).length, 1)
  assert.equal(views(p).length, 30)
  assert.equal(new Set(cardViews(p).map((b) => b.body.product_bc)).size, 29)
})

test('no IntersectionObserver: page view only, no throw; no MutationObserver: cards at start still covered', () => {
  const p = makePage({ consent: 'accepted', io: false })
  buildGrids(p)
  assert.doesNotThrow(() => { p.scrollAll(1, LONG); p.api.klViewStart(); p.api.cookieChoice(true) })
  assert.equal(pageViews(p).length, 1)
  assert.equal(cardViews(p).length, 0)
  const q = makePage({ consent: null, mo: false })
  buildGrids(q); q.api.cookieChoice(true); q.scrollAll(1, LONG)
  assert.equal(cardViews(q).length, 7)
})

test('sendBeacon throwing never breaks the page', () => {
  assert.doesNotThrow(() => { const p = makePage({ consent: 'accepted', beaconThrows: true }); buildGrids(p); p.scrollAll(1, LONG) })
})

test('static: one KL-VIEW block, Accept starts / Reject stops it, event type "view" only, cap 30 / 400 ms, no price / email / deal', () => {
  assert.equal(HTML.split('/*KL-VIEW-START*/').length, 2)
  assert.ok(fnSrc('cookieChoice').includes("try{ if(accepted){ if(typeof klViewStart==='function') klViewStart(); } else if(typeof klViewStop==='function') klViewStop(); }catch(e){}"))
  const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.deepEqual([...code.matchAll(/flTrack\('([a-z_]+)'/g)].map((m) => m[1]), ['view'])
  assert.doesNotMatch(HTML, /flTrack\('view_item'/)
  assert.doesNotMatch(code, /value|price|email|deal|checkout|cart|fetch\(|sendBeacon|localStorage/i)
  assert.match(code, /var CAP=30, GAP=400, K_SEEN='kl_view_seen', K_N='kl_view_n', K_PAGE='kl_view_page';/)
  assert.match(code, /threshold:\[0\.5\]/)
  assert.match(code, /typeof window\.IntersectionObserver!=='function'/)
  const strings = [...code.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0])
  for (const s of strings) assert.doesNotMatch(s, /hand-strung|diamond|\blux\b|\bstone\b|crystal|best|finest|premium|genuine|sterling/i, s)
})
