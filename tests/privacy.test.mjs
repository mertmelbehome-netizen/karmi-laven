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
