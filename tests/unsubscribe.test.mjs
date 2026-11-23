// /api/unsubscribe + api/_unsub.js + scripts/campaign-recipients.mjs with a fake ops DB (no network). Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { emailHash, unsubToken, verifyUnsub, unsubUrl, unsubSecret, listUnsubscribeHeaders, unsubFooterHtml, KEY_LABEL } from '../api/_unsub.js'
import { createHandler, makeRate } from '../api/unsubscribe.js'
import { buildRecipients, loadLists, parseArgs, formatCounts, isInternal } from '../scripts/campaign-recipients.mjs'

const SVC = 'test-service-key-not-real'
const ENV = { OPS_SUPABASE_URL: 'https://db.test', OPS_SUPABASE_SERVICE_KEY: SVC }
const SECRET = unsubSecret(ENV)
const EMAIL = '  Jane.Doe@Example.com '
const H = emailHash(EMAIL)
const T = unsubToken(H, SECRET)
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

/** fake PostgREST: marketing_suppression with a primary key on email_sha256 */
function fakeDb({ status } = {}) {
  const rows = new Map()
  const calls = []
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null })
    if (status) return { ok: false, status, text: async () => 'err' }
    if (url.startsWith('https://db.test/rest/v1/marketing_suppression') && opts.method === 'POST') {
      const b = JSON.parse(opts.body)
      if (!/^[0-9a-f]{64}$/.test(b.email_sha256)) return { ok: false, status: 400, text: async () => 'check' }
      if (!rows.has(b.email_sha256)) rows.set(b.email_sha256, b) // resolution=ignore-duplicates
      return { ok: true, status: 201, text: async () => '' }
    }
    throw new Error('unexpected ' + url)
  }
  fn.calls = calls
  fn.rows = rows
  return fn
}

function fakeRes() {
  const r = { headers: {}, statusCode: 0, body: undefined }
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.send = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}
function fakeLog() { const lines = []; return { lines, error: (...a) => lines.push(a.join(' ')), log: (...a) => lines.push(a.join(' ')) } }

const make = (o = {}) => {
  const db = fakeDb(o)
  const log = fakeLog()
  const h = createHandler({ env: () => o.env || ENV, fetchImpl: db, now: () => new Date('2026-11-25T12:00:00Z'), rate: o.rate || (() => true), log })
  return { db, log, h }
}
const get = async (h, query, url) => { const res = fakeRes(); await h({ method: 'GET', headers: {}, query, url }, res); return res }
const form = async (h, query, body = { confirm: '1' }) => { const res = fakeRes(); await h({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, query, body }, res); return res }
const post = async (h, query, body = 'List-Unsubscribe=One-Click') => { const res = fakeRes(); await h({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, query, body }, res); return res }

// ---------- token ----------

test('hash = sha256(lower(trim(email))) hex, the marketing_suppression form', () => {
  assert.equal(H, createHash('sha256').update('jane.doe@example.com').digest('hex'))
  assert.match(H, /^[0-9a-f]{64}$/)
})

test('derived key is one-way HMAC(service key, label); KARMI_UNSUB_SECRET overrides; never the service key itself', () => {
  assert.equal(KEY_LABEL, 'karmi-unsub-v1')
  assert.deepEqual(SECRET, createHmac('sha256', SVC).update('karmi-unsub-v1').digest())
  assert.notEqual(SECRET.toString('utf8'), SVC)
  assert.ok(!SECRET.toString('hex').includes(Buffer.from(SVC).toString('hex')))
  assert.deepEqual(unsubSecret({ ...ENV, KARMI_UNSUB_SECRET: 'own-secret' }), Buffer.from('own-secret'))
  assert.equal(unsubSecret({}), null)
  const u = unsubUrl(EMAIL, SECRET)
  assert.ok(!u.includes(SVC) && !T.includes(SVC))
})

test('token sign / verify: valid passes; tamper, wrong hash, wrong key, malformed fail', () => {
  assert.match(T, /^[0-9a-f]{32}$/)
  assert.equal(verifyUnsub(H, T, SECRET), true)
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'a' ? 'b' : 'a') + s.slice(i + 1)
  assert.equal(verifyUnsub(H, flip(T, 5), SECRET), false)
  assert.equal(verifyUnsub(emailHash('other@example.com'), T, SECRET), false)
  assert.equal(verifyUnsub(H, T, unsubSecret({ OPS_SUPABASE_SERVICE_KEY: 'rotated' })), false)
  for (const [h, t] of [[H, ''], ['', T], [H, T.toUpperCase()], [H.toUpperCase(), T], [H, T + '0'], [H, T.slice(0, 31)], [undefined, T], [H, null], [[H], T]]) {
    assert.equal(verifyUnsub(h, t, SECRET), false)
  }
  assert.equal(verifyUnsub(H, T, null), false)
})

test('verify uses a constant-time compare (crypto.timingSafeEqual), not ===', () => {
  const s = src('../api/_unsub.js')
  assert.match(s, /timingSafeEqual\(want, got\)/)
  const body = s.slice(s.indexOf('export function verifyUnsub'), s.indexOf('export function unsubUrl'))
  assert.doesNotMatch(body, /token\s*===|===\s*token|want\s*===/)
})

test('unsubscribe URL + headers: exact format, no email in them', () => {
  const u = unsubUrl(EMAIL, SECRET)
  assert.equal(u, `https://karmilaven.com/api/unsubscribe?h=${H}&t=${T}`)
  const hd = listUnsubscribeHeaders(EMAIL, SECRET)
  assert.deepEqual(Object.keys(hd), ['List-Unsubscribe', 'List-Unsubscribe-Post'])
  assert.equal(hd['List-Unsubscribe'], `<https://karmilaven.com/api/unsubscribe?h=${H}&t=${T}>, <mailto:hello@karmilaven.com?subject=unsubscribe>`)
  assert.equal(hd['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  for (const v of [u, ...Object.values(hd), unsubFooterHtml(u)]) assert.ok(!/jane|example\.com|%40/i.test(v), v)
  assert.match(unsubFooterHtml(u), /<a href="https:\/\/karmilaven\.com\/api\/unsubscribe\?h=[0-9a-f]{64}&amp;t=[0-9a-f]{32}">Unsubscribe<\/a>/)
})

// ---------- endpoint ----------

test('GET valid link → confirm page with a button, WRITES NOTHING (mail scanners pre-open links; Komuta 23 Nov)', async () => {
  const { db, h, log } = make()
  for (let i = 0; i < 3; i++) {
    const r = await get(h, { h: H, t: T })
    assert.equal(r.statusCode, 200)
    assert.match(r.headers['content-type'], /text\/html/)
    assert.match(r.body, /Unsubscribe from Karmi Laven emails\?/)
    assert.match(r.body, /<form method="post"><input type="hidden" name="confirm" value="1"><button type="submit"[^>]*>Confirm unsubscribe<\/button><\/form>/)
    assert.doesNotMatch(r.body, /<form[^>]*action=/, 'posts back to its own URL: the hash is never written into the page')
    assert.ok(!r.body.includes(H) && !r.body.includes(T))
    assert.doesNotMatch(r.body, /<script|googletagmanager|gtag|fbq|pixel|<img/i)
    assert.match(r.headers['content-security-policy'], /form-action 'self'/)
  }
  assert.equal(db.calls.length, 0, 'GET never writes')
  assert.equal(log.lines.length, 0)
})

test("the button (form POST) → 200 'You are unsubscribed' page + one upsert with source unsubscribe", async () => {
  const { db, h, log } = make()
  const r = await form(h, { h: H, t: T })
  assert.equal(r.statusCode, 200)
  assert.match(r.headers['content-type'], /text\/html/)
  assert.match(r.body, /You're unsubscribed from Karmi Laven emails\./)
  assert.match(r.body, /You won't receive marketing emails from us again\./)
  assert.match(r.body, /Changed your mind\? Email <a href="mailto:hello@karmilaven\.com">hello@karmilaven\.com<\/a>/)
  assert.match(r.body, /<html lang="en">/)
  assert.doesNotMatch(r.body, /<script|<form|googletagmanager|gtag|fbq|pixel|<img/i, 'no tracking, no scripts')
  assert.ok(!r.body.includes(H), 'hash not echoed on the page')
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.equal(r.headers['referrer-policy'], 'no-referrer')
  assert.match(r.headers['content-security-policy'], /default-src 'none'/)
  assert.doesNotMatch(r.headers['content-security-policy'], /script-src/)
  assert.equal(db.calls.length, 1)
  const c = db.calls[0]
  assert.equal(c.url, 'https://db.test/rest/v1/marketing_suppression?on_conflict=email_sha256')
  assert.equal(c.opts.method, 'POST')
  assert.equal(c.opts.headers.Prefer, 'resolution=ignore-duplicates,return=minimal')
  assert.deepEqual(c.body, { email_sha256: H, at: '2026-11-25T12:00:00.000Z', source: 'unsubscribe' })
  assert.equal(log.lines.length, 0)
})

test('second click is idempotent: still 200, still one row', async () => {
  const { db, h } = make()
  assert.equal((await form(h, { h: H, t: T })).statusCode, 200)
  assert.equal((await form(h, { h: H, t: T })).statusCode, 200)
  assert.equal((await post(h, { h: H, t: T })).statusCode, 200)
  assert.equal((await form(h, { h: H, t: T }, 'confirm=1')).statusCode, 200, 'string body too')
  assert.equal(db.rows.size, 1)
  assert.equal(db.rows.get(H).source, 'unsubscribe')
})

test('PostgREST 409 on the duplicate is treated as success', async () => {
  const { h } = make({ status: 409 })
  assert.equal((await form(h, { h: H, t: T })).statusCode, 200)
})

test('invalid / missing token → 400 plain page, nothing written', async () => {
  const { db, h } = make()
  for (const q of [{ h: H, t: '0'.repeat(32) }, { h: H }, { t: T }, {}, { h: emailHash('x@y.z'), t: T }, { h: H, t: T.toUpperCase() }]) {
    const r = await get(h, q, '/api/unsubscribe')
    assert.equal(r.statusCode, 400)
    assert.match(r.body, /This unsubscribe link isn't valid/)
    assert.doesNotMatch(r.body, /<script/i)
  }
  const p = await post(h, { h: H, t: 'f'.repeat(32) })
  assert.equal(p.statusCode, 400)
  assert.equal(p.body, 'Invalid unsubscribe link')
  const f = await form(h, { h: H, t: 'f'.repeat(32) })
  assert.equal(f.statusCode, 400)
  assert.match(f.body, /This unsubscribe link isn't valid/)
  assert.equal(db.calls.length, 0)
})

test('h / t are read from req.url when req.query is absent', async () => {
  const { db, h } = make()
  const r = await get(h, undefined, `/api/unsubscribe?h=${H}&t=${T}`)
  assert.equal(r.statusCode, 200)
  assert.match(r.body, /Confirm unsubscribe/)
  assert.equal(db.rows.size, 0)
})

test('POST one-click (RFC 8058) → 200 text and the row', async () => {
  const { db, h } = make()
  const r = await post(h, { h: H, t: T })
  assert.equal(r.statusCode, 200)
  assert.match(r.headers['content-type'], /text\/plain/)
  // Vercel parses a urlencoded body into an object; a Buffer body works too
  assert.equal((await post(h, { h: H, t: T }, { 'List-Unsubscribe': 'One-Click' })).body, 'Unsubscribed')
  assert.equal((await post(h, { h: H, t: T }, Buffer.from('List-Unsubscribe=One-Click'))).body, 'Unsubscribed')
  assert.equal(r.body, 'Unsubscribed')
  assert.equal(db.rows.get(H).source, 'unsubscribe')
})

test('DB error → 500, logs the status only (no email, no hash); missing config → 500, no write', async () => {
  const { h, log } = make({ status: 500 })
  const r = await form(h, { h: H, t: T })
  assert.equal(r.statusCode, 500)
  assert.match(r.body, /hello@karmilaven\.com/)
  assert.equal(log.lines.length, 1)
  assert.ok(!log.lines[0].includes(H) && !/jane|example/i.test(log.lines[0]) && !log.lines[0].includes(SVC))
  const m = make({ env: {} })
  assert.equal((await get(m.h, { h: H, t: T })).statusCode, 500)
  assert.equal(m.db.calls.length, 0)
})

test('rate limit → 429, no write; other methods → 405; OPTIONS → 204', async () => {
  const { db, h } = make({ rate: () => false })
  assert.equal((await get(h, { h: H, t: T })).statusCode, 429)
  assert.equal(db.calls.length, 0)
  const m = make()
  const res = fakeRes(); await m.h({ method: 'DELETE', headers: {}, query: { h: H, t: T } }, res)
  assert.equal(res.statusCode, 405)
  const o = fakeRes(); await m.h({ method: 'OPTIONS', headers: {} }, o)
  assert.equal(o.statusCode, 204)
  const lim = makeRate(2, 60_000)
  assert.deepEqual([lim('ip', 0), lim('ip', 1), lim('ip', 2), lim('ip', 60_001)], [true, true, false, true])
})

test('source never logs the email or the hash; endpoint never reads an email', () => {
  for (const f of ['../api/unsubscribe.js', '../api/_unsub.js']) {
    const s = src(f)
    assert.doesNotMatch(s, /console\.(log|error|warn|info)\([^)]*\b(email|h|hash)\b/, f)
    assert.doesNotMatch(s, /log\.(log|error|warn|info)\([^)]*,\s*(h|hash|email|body)\)/, f)
  }
  assert.doesNotMatch(src('../api/unsubscribe.js'), /\bemail\s*[:=]/)
})

// ---------- recipient list ----------

const SUBS = [
  { email: 'old@example.com', created_at: '2026-06-26T10:00:00Z' },
  { email: 'a@example.com', created_at: '2026-07-02T10:00:00Z' },
  { email: 'A@Example.com ', created_at: '2026-07-03T10:00:00Z' }, // duplicate of a@ (by hash)
  { email: 'gone@example.com', created_at: '2026-07-05T10:00:00Z' },
  { email: 'mert@melbehome.co.uk', created_at: '2026-07-06T10:00:00Z' },
  { email: 'test@example.com', created_at: '2026-07-07T10:00:00Z' },
  { email: 'b@example.com', created_at: '2026-07-08T10:00:00Z' },
  { email: 'late@example.com', created_at: '2026-08-04T10:00:00Z' },
]

test('recipients = subscribers in consent window − suppressed − internal; counts per step', () => {
  const r = buildRecipients({
    subscribers: SUBS, suppressed: [emailHash('gone@example.com').toUpperCase(), emailHash('late@example.com')],
    internal: ['@melbehome.co.uk', 'TEST@example.com'], consentFrom: '2026-07-01', consentTo: '2026-08-01', secret: SECRET,
  })
  assert.deepEqual(r.counts, { total: 7, after_consent_window: 5, after_suppression: 4, after_internal: 2 })
  assert.deepEqual(r.recipients.map((x) => x.email), ['a@example.com', 'b@example.com'])
  const a = r.recipients[0]
  assert.equal(a.hash, emailHash('a@example.com'))
  assert.equal(a.unsubscribeUrl, unsubUrl('a@example.com', SECRET))
  assert.equal(verifyUnsub(a.hash, new URL(a.unsubscribeUrl).searchParams.get('t'), SECRET), true)
  assert.deepEqual(a.headers, listUnsubscribeHeaders('a@example.com', SECRET))
  assert.ok(a.footerHtml.includes('Unsubscribe'))
  // no window → all; suppression still applies; consentTo is exclusive
  const all = buildRecipients({ subscribers: SUBS, suppressed: [emailHash('gone@example.com')], secret: SECRET })
  assert.deepEqual(all.counts, { total: 7, after_consent_window: 7, after_suppression: 6, after_internal: 6 })
  assert.equal(buildRecipients({ subscribers: SUBS, consentTo: '2026-07-02T10:00:00Z', secret: SECRET }).counts.after_consent_window, 1)
  assert.throws(() => buildRecipients({ subscribers: SUBS, consentFrom: 'soon', secret: SECRET }), /consentFrom/)
  assert.throws(() => buildRecipients({ subscribers: SUBS }), /secret/)
  assert.equal(isInternal('X@Melbehome.co.uk', ['@melbehome.co.uk']), true)
  assert.equal(isInternal('x@notmelbehome.co.uk', ['@melbehome.co.uk']), false)
})

test('a recipient-list link really unsubscribes through the endpoint', async () => {
  const { recipients } = buildRecipients({ subscribers: SUBS.slice(1, 2), secret: SECRET })
  const u = new URL(recipients[0].unsubscribeUrl)
  const { db, h } = make()
  const r = await post(h, Object.fromEntries(u.searchParams))
  assert.equal(r.statusCode, 200)
  assert.ok(db.rows.has(emailHash('a@example.com')))
  // next build excludes them
  const again = buildRecipients({ subscribers: SUBS.slice(1, 2), suppressed: [...db.rows.keys()], secret: SECRET })
  assert.equal(again.counts.after_suppression, 0)
})

test('dry-run: read-only GETs, counts printed, never an address; no send code in the script', async () => {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts?.method || 'GET' })
    if (url.includes('/karmi_subscribers?')) return { ok: true, json: async () => SUBS }
    if (url.includes('/marketing_suppression?')) return { ok: true, json: async () => [{ email_sha256: emailHash('gone@example.com') }] }
    throw new Error('unexpected')
  }
  const lists = await loadLists({ base: 'https://db.test', key: 'k', fetchImpl })
  assert.ok(calls.every((c) => c.method === 'GET'))
  const o = parseArgs(['--consent-from', '2026-07-01', '--consent-to', '2026-08-01', '--internal', '@melbehome.co.uk,test@example.com'])
  const out = formatCounts(buildRecipients({ ...lists, ...o, secret: SECRET }).counts, o)
  assert.match(out, /after internal exclusion:\s+2/)
  assert.doesNotMatch(out, /@|[0-9a-f]{32}/)
  const s = src('../scripts/campaign-recipients.mjs')
  assert.doesNotMatch(s, /resend|nodemailer|smtp|method:\s*'POST'|\/emails/i)
  assert.doesNotMatch(s.slice(s.indexOf('async function main')), /\.recipients|recipients\s*[,}]|\.email\b/, 'main() only takes the counts')
  assert.throws(() => parseArgs(['--send']), /unknown argument/)
})

test('CJS guard: no import.meta in api/*.js (incl. the new files)', () => {
  const files = readdirSync(new URL('../api/', import.meta.url)).filter((x) => x.endsWith('.js'))
  assert.ok(files.includes('unsubscribe.js') && files.includes('_unsub.js'))
  for (const f of files) {
    assert.doesNotMatch(src(`../api/${f}`).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /import\.meta/, f)
  }
})
