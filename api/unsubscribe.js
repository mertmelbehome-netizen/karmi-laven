// /api/unsubscribe — the unsubscribe link in every Karmi Laven marketing email.
//
//   GET  /api/unsubscribe?h=<sha256>&t=<token>   link click → page with a "Confirm unsubscribe" button. WRITES NOTHING
//                                               (mail scanners pre-open links; Komuta 23 Nov: a lost subscriber is a real loss)
//   POST same URL, form body "confirm=1"         the button → writes → HTML "You're unsubscribed" page
//   POST same URL, "List-Unsubscribe=One-Click"  RFC 8058 one-click from the mail app → writes → 200 text
//
// Valid signature → idempotent upsert into public.marketing_suppression (shared ops v2 Supabase):
//   { email_sha256: h, at: now, source: 'unsubscribe' }, on conflict (email_sha256 = primary key) do nothing,
//   so a second click is still a success and never a second row (an earlier 'objection' row is kept as it is).
// Invalid / missing h or t → 400 plain page, nothing written.
// Never logs or shows the email address or the hash. No scripts on the page. Helpers + key choice: api/_unsub.js.
//
// Env (already set in Vercel): OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (service role, server-side only);
// optional KARMI_UNSUB_SECRET (see docs/UNSUBSCRIBE.md).
import { verifyUnsub, unsubSecret } from './_unsub.js';

// In-process rate-limit like api/subscribe.js (resets on cold start): max 10 requests per IP per minute.
export function makeRate(limit = 10, windowMs = 60_000) {
  const m = new Map();
  return (ip, now = Date.now()) => {
    let r = m.get(ip);
    if (!r || now > r.resetAt) { r = { count: 0, resetAt: now + windowMs }; m.set(ip, r); }
    r.count++;
    return r.count <= limit;
  };
}

const CSS = `*{margin:0;box-sizing:border-box}
body{background:#faf7f1;color:#34302a;font-family:'Jost',sans-serif;font-weight:300;line-height:1.7;letter-spacing:.01em}
.wrap{max-width:620px;margin:0 auto;padding:0 26px}
header{text-align:center;padding:34px 0 18px;border-bottom:1px solid rgba(52,48,42,.13)}
header a{font-family:'Herr Von Muellerhoff',cursive;font-size:54px;color:#34302a;text-decoration:none;line-height:.8}
main{padding:64px 0 56px;text-align:center}
h1{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:clamp(28px,5vw,40px);margin-bottom:16px;letter-spacing:-.01em}
p{font-size:16px;color:#4a453d;margin-bottom:12px}
a{color:#8a6a33}
a:focus-visible{outline:2px solid #34302a;outline-offset:2px}
footer{border-top:1px solid rgba(52,48,42,.13);text-align:center;padding:34px 0 50px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6f675b}
footer a{text-decoration:none;margin:0 8px}`;

export function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${title} — Karmi Laven</title>
<link href="/fonts/fonts.css" rel="stylesheet">
<style>${CSS}</style></head><body>
<header><a href="/">Karmi Laven</a></header>
<main class="wrap" id="main">${bodyHtml}</main>
<footer class="wrap"><a href="/">Home</a> · <a href="/privacy.html">Privacy</a> · <a href="/contact.html">Contact</a></footer>
</body></html>`;
}

export const PAGE_DONE = page('Unsubscribed',
  `<h1>You're unsubscribed from Karmi Laven emails.</h1>
<p>You won't receive marketing emails from us again.</p>
<p>Changed your mind? Email <a href="mailto:hello@karmilaven.com">hello@karmilaven.com</a></p>`);
// The form has no action attribute: it posts back to this page's own URL (h + t stay in the query string, so the hash
// is never written into the page).
export const PAGE_CONFIRM = page('Unsubscribe',
  `<h1>Unsubscribe from Karmi Laven emails?</h1>
<p>Press the button to stop marketing emails from us.</p>
<form method="post"><input type="hidden" name="confirm" value="1"><button type="submit" style="margin-top:18px;background:#34302a;color:#faf7f1;border:0;padding:16px 34px;font:inherit;font-size:13px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer">Confirm unsubscribe</button></form>
<p style="margin-top:22px">Changed your mind? Just close this page.</p>`);
export const PAGE_BAD = page('Link not valid',
  `<h1>This unsubscribe link isn't valid.</h1>
<p>It may have been cut short when it was copied. Please use the unsubscribe link in the email again, or email <a href="mailto:hello@karmilaven.com?subject=unsubscribe">hello@karmilaven.com</a> and we'll unsubscribe you.</p>`);
export const PAGE_ERR = page('Something went wrong',
  `<h1>Sorry, something went wrong.</h1>
<p>We couldn't record your request just now. Please try the link again in a minute, or email <a href="mailto:hello@karmilaven.com?subject=unsubscribe">hello@karmilaven.com</a> and we'll unsubscribe you.</p>`);

/** RFC 8058 one-click POST from a mail app (body "List-Unsubscribe=One-Click"); anything else is the page's button. */
export function isOneClick(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b['List-Unsubscribe'] === 'One-Click';
  const s = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  return /(^|&)List-Unsubscribe=One-Click(&|$)/.test(s);
}

function params(req) {
  if (req.query && (req.query.h !== undefined || req.query.t !== undefined)) {
    const one = (v) => (Array.isArray(v) ? v[0] : v);
    return { h: one(req.query.h), t: one(req.query.t) };
  }
  try {
    const u = new URL(req.url || '/', 'https://karmilaven.com');
    return { h: u.searchParams.get('h'), t: u.searchParams.get('t') };
  } catch { return { h: null, t: null }; }
}

export function createHandler({
  env = () => process.env,
  fetchImpl = (...a) => fetch(...a),
  now = () => new Date(),
  rate = makeRate(),
  log = console,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

    const method = req.method || 'GET';
    if (method === 'OPTIONS') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(204).end(); }
    const isPost = method === 'POST';
    const asText = isPost && isOneClick(req);
    if (method !== 'GET' && !isPost) { res.setHeader('Allow', 'GET, POST, OPTIONS'); return send(res, 405, isPost, 'Method not allowed', PAGE_BAD); }

    const ip = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'unknown';
    if (!rate(ip)) return send(res, 429, asText, 'Too many requests', PAGE_ERR);

    const e = env();
    const secret = unsubSecret(e);
    if (!e.OPS_SUPABASE_URL || !e.OPS_SUPABASE_SERVICE_KEY || !secret) {
      log.error('[unsubscribe] server config missing');
      return send(res, 500, asText, 'Server error', PAGE_ERR);
    }

    const { h, t } = params(req);
    if (!verifyUnsub(h, t, secret)) return send(res, 400, asText, 'Invalid unsubscribe link', PAGE_BAD);
    if (!isPost) return send(res, 200, false, '', PAGE_CONFIRM); // GET: confirm page only, no write

    try {
      const r = await fetchImpl(`${e.OPS_SUPABASE_URL}/rest/v1/marketing_suppression?on_conflict=email_sha256`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: e.OPS_SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${e.OPS_SUPABASE_SERVICE_KEY}`,
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ email_sha256: h, at: now().toISOString(), source: 'unsubscribe' }),
      });
      if (!r.ok && r.status !== 409) {
        log.error('[unsubscribe] db error status', r.status); // status only: the body could echo the key
        return send(res, 500, asText, 'Server error', PAGE_ERR);
      }
    } catch {
      log.error('[unsubscribe] db request failed');
      return send(res, 500, asText, 'Server error', PAGE_ERR);
    }
    return send(res, 200, asText, 'Unsubscribed', PAGE_DONE);
  };
}

function send(res, status, asText, text, html) {
  res.status(status);
  if (asText) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(text); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
}

export default createHandler();
