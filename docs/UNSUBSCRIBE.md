# Email unsubscribe (Karmi Laven)

Promised on privacy.html: "unsubscribe from marketing emails at any time with the link in any of them".

## Pieces

| File | What |
|------|------|
| `api/_unsub.js` | `emailHash`, `unsubSecret`, `unsubToken`, `verifyUnsub` (constant-time), `unsubUrl`, `listUnsubscribeHeaders`, footer text |
| `api/unsubscribe.js` | `GET` = link click → "Confirm unsubscribe" button page, **writes nothing**; the button = form `POST` → writes → "You're unsubscribed" page; RFC 8058 one-click `POST` → writes → `200 Unsubscribed`. A write is an upsert `marketing_suppression (email_sha256, at, source='unsubscribe')`, on conflict do nothing |
| `scripts/campaign-recipients.mjs` | `buildRecipients(...)` (pure) + dry-run CLI that prints counts only. Sends nothing |

Link: `https://karmilaven.com/api/unsubscribe?h=<sha256>&t=<token>`. No email address in it.

- `h` = `sha256(lower(trim(email)))`, 64 lowercase hex. This is the same form as `marketing_suppression.email_sha256` (the table's CHECK is `^[0-9a-f]{64}$`).
- `t` = `HMAC-SHA256(key, 'unsub:' + h)`, first 32 hex chars.

## Key

1. If `KARMI_UNSUB_SECRET` is set, it is the key.
2. If not, the key is derived one way: `HMAC-SHA256(key = OPS_SUPABASE_SERVICE_KEY, msg = 'karmi-unsub-v1')`. Nothing in a link or token can reveal the service key, the service key is never used as a token, and the derived key stays on the server. No new Vercel env step is needed.

**If the service key rotates, old links stop verifying.** The `mailto:hello@karmilaven.com?subject=unsubscribe` fallback in `List-Unsubscribe` still works, and so does the email address on the error page. To decouple the links from the database key, set `KARMI_UNSUB_SECRET` in Vercel *and* in the sender's environment, using the same value. Links already sent with the old key will then stop verifying too.

The sender must sign with the same key as the deployed function. Use the same `OPS_SUPABASE_SERVICE_KEY`, or the same `KARMI_UNSUB_SECRET`.

**No env step is needed.** As long as `KARMI_UNSUB_SECRET` is not set (this PR does not set it), both the function and the sender derive the key with the same code (`unsubSecret()` in `api/_unsub.js`) from the same `OPS_SUPABASE_SERVICE_KEY`. The sender must import `api/_unsub.js` (as `scripts/campaign-recipients.mjs` does) and must not re-implement the derivation. Set `KARMI_UNSUB_SECRET` only if the links should outlive a service-key rotation; it then has to be set in both places with the same value.

## Sending (decided by Mert / Komuta, never automatic)

```js
import { buildRecipients, loadLists } from './scripts/campaign-recipients.mjs'
import { unsubSecret } from './api/_unsub.js'
const lists = await loadLists({ base: process.env.OPS_SUPABASE_URL, key: process.env.OPS_SUPABASE_SERVICE_KEY })
const { recipients, counts } = buildRecipients({ ...lists, internal: ['@melbehome.co.uk'],
  consentFrom: '2026-07-01', consentTo: '2026-08-05', secret: unsubSecret(process.env) })
// each recipient: { email, headers: {'List-Unsubscribe', 'List-Unsubscribe-Post'}, footerHtml, footerText, unsubscribeUrl }
// Resend: send ONE email per recipient (never a shared To/BCC) with `headers: r.headers`, and add r.footerHtml to the body.
```

Dry run (counts only):

```
node scripts/campaign-recipients.mjs --consent-from 2026-07-01 --consent-to 2026-08-05 --internal @melbehome.co.uk,someone@x.com
```

- `--consent-from` is inclusive (`created_at >= from`).
- `--consent-to` is exclusive (`created_at < to`).
- `--internal` takes exact addresses or `@domain`.

The output gives one count per step: total, after the consent window, after suppression, and after internal exclusion.

Run the dry run, and build the list, right before each send. Suppression is read live.

## End-to-end test (Marketing / Mert, after deploy)

1. Get the link for an internal test address. Replace the placeholder with your own test address. The command prints only the URL, which holds a hash and a token:
   `node -e "import('./api/_unsub.js').then(m=>console.log(m.unsubUrl('YOUR_TEST_ADDRESS', m.unsubSecret(process.env))))"`
   Run it with the same env as Vercel production (`OPS_SUPABASE_SERVICE_KEY`, plus `KARMI_UNSUB_SECRET` if it is set).
2. Send one test email through Resend to that internal address only. Put the `List-Unsubscribe` and `List-Unsubscribe-Post` headers on it, plus the footer link.
3. In Gmail, check that the "Unsubscribe" link appears next to the sender. Then click the footer link: you should see the "Confirm unsubscribe" page and NO row yet (step 4 returns 0 rows). Press the button. You should see "You're unsubscribed from Karmi Laven emails."
4. Check the row (read-only):
   `select source, at from marketing_suppression where email_sha256 = encode(sha256(convert_to(lower(trim('YOUR_TEST_ADDRESS')),'UTF8')),'hex');`
   It should return 1 row with `source = 'unsubscribe'`.
5. Open the link and press the button again. You should get the same page and still 1 row. Then open the link with one character of `t` changed. You should get the "isn't valid" page, and no new row is written.
6. One-click check: `curl -i -X POST -d "List-Unsubscribe=One-Click" "<the link>"` should return `200 Unsubscribed`.
7. Optional: the test row now suppresses the internal address. Deleting it is a manual live-DB step for the owner:
   `delete from marketing_suppression where email_sha256 = '<hash>' and source = 'unsubscribe';`

## Notes

- `GET` never writes (Komuta, 23 Nov). Corporate mail scanners open links before the person does; on a small list every lost subscriber is a real loss, so the link opens a page with a "Confirm unsubscribe" button. The mail app's one-click `POST` (RFC 8058) still writes immediately, because scanners do not send it.
- The table has RLS on, with one policy (`service_role`, ALL). Only the service-role key, which stays on the server, can write to it.
- Rate limit: 10 requests per IP per minute, held in memory like `api/subscribe.js`.
- Nothing logs the email or the hash. A database error logs only its HTTP status.
