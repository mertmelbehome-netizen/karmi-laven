// api/_unsub.js — shared helpers for the email unsubscribe link (server-side only; never shipped to the browser).
//
// The link never carries the email address. It carries:
//   h = sha256(lower(trim(email))) as 64 lowercase hex — the SAME form as public.marketing_suppression.email_sha256
//       (the table has CHECK email_sha256 ~ '^[0-9a-f]{64}$'; one existing 'objection' row matches a karmi_subscribers
//       address hashed this way, so this is the form already in use);
//   t = HMAC-SHA256(key, 'unsub:' + h) as hex, truncated to 32 chars (128 bits).
//
// Key choice (docs/UNSUBSCRIBE.md):
//   1. env KARMI_UNSUB_SECRET, if set (decoupled from the database key; recommended long-term);
//   2. otherwise a ONE-WAY derived key: HMAC-SHA256(key = OPS_SUPABASE_SERVICE_KEY, msg = 'karmi-unsub-v1').
//      Nothing in the link or token reveals the service key (HMAC is one-way), the service key itself is never used as
//      a token, and the derived key never leaves the server. No new Vercel env step is needed.
//   If the service key rotates (and KARMI_UNSUB_SECRET is not set), old links stop verifying; the mailto: fallback in
//   List-Unsubscribe still works.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const UNSUB_BASE = 'https://karmilaven.com';
export const UNSUB_MAILTO = 'mailto:hello@karmilaven.com?subject=unsubscribe';
export const KEY_LABEL = 'karmi-unsub-v1';
export const HASH_RE = /^[0-9a-f]{64}$/;
export const TOKEN_RE = /^[0-9a-f]{32}$/;

/** sha256(lower(trim(email))) as lowercase hex. */
export function emailHash(email) {
  return createHash('sha256').update(String(email ?? '').trim().toLowerCase(), 'utf8').digest('hex');
}

/** The HMAC key: KARMI_UNSUB_SECRET, else one-way derived from the service key, else null (not configured). */
export function unsubSecret(env = process.env) {
  const own = typeof env.KARMI_UNSUB_SECRET === 'string' ? env.KARMI_UNSUB_SECRET.trim() : '';
  if (own) return Buffer.from(own, 'utf8');
  const svc = env.OPS_SUPABASE_SERVICE_KEY;
  if (!svc) return null;
  return createHmac('sha256', svc).update(KEY_LABEL, 'utf8').digest();
}

/** Token for a hash: HMAC-SHA256(secret, 'unsub:' + hash) hex, first 32 chars. */
export function unsubToken(hash, secret) {
  if (!secret || !secret.length) throw new Error('unsubscribe secret not configured');
  return createHmac('sha256', secret).update('unsub:' + hash, 'utf8').digest('hex').slice(0, 32);
}

/** Constant-time check of a (hash, token) pair. False on any malformed input. */
export function verifyUnsub(hash, token, secret) {
  if (typeof hash !== 'string' || typeof token !== 'string') return false;
  if (!HASH_RE.test(hash) || !TOKEN_RE.test(token) || !secret || !secret.length) return false;
  const want = Buffer.from(unsubToken(hash, secret), 'utf8');
  const got = Buffer.from(token, 'utf8');
  return want.length === got.length && timingSafeEqual(want, got);
}

/** https://karmilaven.com/api/unsubscribe?h=<hash>&t=<token> — the email never appears in the URL. */
export function unsubUrl(email, secret, base = UNSUB_BASE) {
  const h = emailHash(email);
  return `${String(base).replace(/\/+$/, '')}/api/unsubscribe?h=${h}&t=${unsubToken(h, secret)}`;
}

/** RFC 2369 + RFC 8058 headers for one recipient. */
export function listUnsubscribeHeaders(email, secret, base = UNSUB_BASE) {
  return {
    'List-Unsubscribe': `<${unsubUrl(email, secret, base)}>, <${UNSUB_MAILTO}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Footer line for the email body (HTML and plain text). */
export function unsubFooterHtml(url) {
  const u = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `You're receiving this because you signed up for Karmi Laven emails. <a href="${u}">Unsubscribe</a> at any time, or email <a href="mailto:hello@karmilaven.com">hello@karmilaven.com</a>.`;
}
export function unsubFooterText(url) {
  return `You're receiving this because you signed up for Karmi Laven emails. Unsubscribe: ${url} (or email hello@karmilaven.com).`;
}
