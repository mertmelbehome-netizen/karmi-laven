// The privacy page names the providers the store really uses (Komuta 23 Nov 2026: it said Klaviyo, the store
// sends email through Resend). Klaviyo may be named only while the site actually loads it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('privacy: email goes through Resend; Klaviyo is not named while the site does not load it', () => {
  const privacy = read('privacy.html')
  const index = read('index.html')
  const klaviyoKey = (/klaviyo:\s*'([^']*)'/.exec(index) || [])[1] ?? ''
  if (!klaviyoKey) assert.doesNotMatch(privacy, /klaviyo/i, 'Klaviyo named but not loaded (ANALYTICS.klaviyo is empty)')
  assert.match(privacy, /<b>Email \(Resend\):<\/b>/)
  assert.match(privacy, /Resend for emails/)
  assert.match(privacy, /unsubscribe from marketing emails at any time/)
})

// UK GDPR Art. 13 (24 Nov 2026): controller, lawful basis per purpose, transfers, retention, rights + ICO.
const sect = (html, id) => {
  const i = html.indexOf(`<h2 id="${id}">`)
  assert.ok(i >= 0, `section #${id} missing`)
  const j = html.indexOf('<h2', i + 4)
  return html.slice(i, j < 0 ? undefined : j)
}

test('privacy Art.13: controller name, company number, address and contact', () => {
  const who = sect(read('privacy.html'), 'who')
  assert.match(who, /Melbe Home UK Ltd/)
  assert.match(who, /15549022/)
  assert.match(who, /8 Turner Court, High Street, Berkhamsted, HP4 3ZE/)
  assert.match(who, /controller/)
  assert.match(who, /hello@karmilaven\.com/)
})

test('privacy Art.13: lawful-basis table with order/contract and marketing/consent rows', () => {
  const lb = sect(read('privacy.html'), 'lawful-basis')
  assert.match(lb, /<table>[\s\S]*<th scope="col">Purpose<\/th><th scope="col">Lawful basis<\/th>/)
  const rows = [...lb.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><\/tr>/g)].map(m => [m[1], m[2]])
  assert.ok(rows.some(([p, b]) => /order/i.test(p) && /^Contract/.test(b)), 'order -> contract row')
  assert.ok(rows.some(([p, b]) => /marketing emails/i.test(p) && /^Consent/.test(b)), 'marketing -> consent row')
  assert.ok(rows.some(([p, b]) => /tax records/i.test(p) && /Legal obligation/.test(b)), 'tax -> legal obligation row')
  assert.match(lb, /You need to give your name, email, phone number and delivery address to place an order/)
})

test('privacy: visit source (campaign link) is recorded with the order on legitimate interests', () => {
  const lb = sect(read('privacy.html'), 'lawful-basis')
  assert.match(lb, /We record the source of your visit \(for example a campaign link\) with your order/)
  assert.match(lb, /utm_source, utm_medium, utm_campaign/)
  assert.match(lb, /the site name only[\s\S]*?Legitimate interests[\s\S]*?Nothing is stored on your device for this unless you accepted cookies/)
})

test('privacy Art.13: international transfers name the UK-US data bridge or IDTA', () => {
  const t = sect(read('privacy.html'), 'transfers')
  assert.match(t, /UK-US data bridge/)
  assert.match(t, /International Data Transfer Agreement \(IDTA\)/)
})

test('privacy Art.13: retention table, rights, consent withdrawal and ICO complaint', () => {
  const html = read('privacy.html')
  const r = sect(html, 'retention')
  assert.match(r, /<table>[\s\S]*<th scope="col">Data<\/th>/)
  assert.match(r, /Orders, payments and tax records<\/th><td>6 years, as UK tax law \(HMRC\) requires<\/td>/)
  assert.match(r, /Email list \(marketing\)<\/th><td>Until you unsubscribe<\/td>/)
  assert.match(r, /Record that you unsubscribed<\/th><td>Indefinitely/)
  assert.match(r, /Reviews and review photos<\/th><td>While the review is shown on our site/)
  assert.match(r, /Where your visit came from[^<]*<\/th><td>Kept with your order record \(6 years\)<\/td>/)
  assert.match(r, /Site visit data \(only if you accept cookies\)[^<]*<\/th><td>13 months, then deleted<\/td>/) // ops-v2 fn_funnel_events_purge (#944)
  assert.match(r, /Data held by Meta and Google[^<]*<\/th><td>Kept by Meta and Google under their own retention settings/)
  assert.match(html, /withdraw it at any time/)
  assert.match(html, /complaint with the Information Commissioner's Office \(ICO\) at <a href="https:\/\/ico\.org\.uk"/)
  // every <th scope> table cell is explicit (accessibility); no new scripts on the page
  assert.doesNotMatch(html, /<th>/)
  assert.doesNotMatch(html, /<script/i)
})

test('privacy Art.13: no placeholder text on the public page (Komuta 24 Nov, K&D #86)', () => {
  const html = read('privacy.html')
  assert.doesNotMatch(html, /Mert to confirm|\[TBC\]|TODO/i)
  // decisions 24 Nov: the Stripe checkout reminder stays OFF -> no row; no unverified analytics retention period
  assert.doesNotMatch(html, /Reminder email from Stripe/)
  assert.doesNotMatch(html, /Analytics and visit-source data/)
})

test('privacy: every processor named is really used by the code (no invented vendors)', () => {
  const html = read('privacy.html')
  const code = ['index.html', 'api/checkout.js', 'api/stripe-webhook.js', 'api/subscribe.js', 'api/unsubscribe.js',
    'api/review.js', 'api/stock.js', 'api/analytics-config.js', 'js/christmas.js',
    // Email is sent by the ops side through Resend; this repo documents the unsubscribe headers for it.
    'docs/UNSUBSCRIBE.md'].map(read).join('\n')
  const used = { Stripe: /stripe/i, 'Royal Mail': /royal mail/i, Resend: /resend/i, Vercel: /vercel/i,
    Supabase: /supabase/i, Meta: /graph\.facebook\.com|fbq\(/, Google: /googletagmanager|google-analytics\.com/ }
  for (const [name, re] of Object.entries(used)) {
    if (html.includes(name)) assert.match(code, re, `${name} named in privacy.html but not used in code`)
  }
  // Vendors the site does not load (or only has a placeholder id for) must not be named.
  for (const v of ['Klaviyo', 'Clarity', 'Mailchimp', 'Hotjar', 'TikTok', 'Shopify', 'Zoho']) {
    if (v === 'Klaviyo') continue // covered by the first test (allowed only while ANALYTICS.klaviyo is set)
    assert.doesNotMatch(html, new RegExp(v, 'i'), `${v} named but not used`)
  }
  assert.match(sect(html, 'transfers'), /Stripe, Resend, Vercel, Supabase, Meta and Google/)
})
