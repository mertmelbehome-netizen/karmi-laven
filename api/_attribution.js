// api/_attribution.js — where an order came from (Komuta 24 Nov 2026). Server-side cleaning shared by checkout.js
// (browser body -> Stripe session metadata) and stripe-webhook.js (metadata -> online_orders columns).
//
// The storefront sends { utm_source, utm_medium, utm_campaign, landing, referrer }:
//   - with cookie consent: the FIRST touch of the visit (kept in sessionStorage);
//   - without consent: nothing is stored on the device, only the checkout page's own URL params and document.referrer.
// Cleaning (mirrors the ops-v2 CHECK online_orders_utm_shape, migration 20261124110500):
//   utm_*         lower-case, spaces -> '-', only [a-z0-9_.-], max 100, empty -> null
//   landing_path  path only (no host, no query, no fragment), only [A-Za-z0-9/_.-], max 200, starts with '/'
//   referrer_host host only (never the URL), lower-case, [a-z0-9.-], max 253; our own host -> null (internal nav)
// No personal data is kept: no full URL, no query string of the referrer, no email.

const OWN_HOSTS = new Set(['karmilaven.com', 'www.karmilaven.com']);
const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'landing_path', 'referrer_host'];
// Stripe metadata keys (short, under Stripe's 40-char key limit)
const META = { utm_source: 'a_src', utm_medium: 'a_med', utm_campaign: 'a_cmp', landing_path: 'a_land', referrer_host: 'a_ref' };

function str(v, max = 2000) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function cleanUtm(v) {
  const s = str(v, 400).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_.-]/g, '').slice(0, 100);
  return s || null;
}

export function cleanPath(v) {
  let p = str(v, 1000).trim();
  if (!p) return null;
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { return null; }
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  p = p.replace(/[^A-Za-z0-9/_.-]/g, '').slice(0, 200);
  return p || null;
}

export function cleanHost(v) {
  let h = str(v, 1000).trim().toLowerCase();
  if (!h) return null;
  try { h = /^[a-z][a-z0-9+.-]*:\/\//.test(h) ? new URL(h).hostname : h.split('/')[0].split('?')[0]; } catch { return null; }
  h = h.replace(/:\d+$/, '').replace(/[^a-z0-9.-]/g, '').slice(0, 253);
  if (!h || OWN_HOSTS.has(h)) return null;
  return h;
}

/** Browser body.attribution -> cleaned fields (all null when nothing usable). */
export function fromBody(a) {
  const o = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  return {
    utm_source: cleanUtm(o.utm_source),
    utm_medium: cleanUtm(o.utm_medium),
    utm_campaign: cleanUtm(o.utm_campaign),
    landing_path: cleanPath(o.landing),
    referrer_host: cleanHost(o.referrer),
  };
}

/** Cleaned fields -> Stripe metadata entries (only the non-empty ones). */
export function toMetadata(attr) {
  const m = {};
  for (const k of KEYS) if (attr && attr[k]) m[META[k]] = attr[k];
  return m;
}

/** Stripe session -> online_orders fields, cleaned again (metadata is not trusted). Only non-null keys. */
export function fromSession(s) {
  const md = (s && s.metadata) || {};
  const raw = {
    utm_source: cleanUtm(md[META.utm_source]),
    utm_medium: cleanUtm(md[META.utm_medium]),
    utm_campaign: cleanUtm(md[META.utm_campaign]),
    landing_path: cleanPath(md[META.landing_path]),
    referrer_host: cleanHost(md[META.referrer_host]),
  };
  const out = {};
  for (const k of KEYS) if (raw[k]) out[k] = raw[k];
  return out;
}

export const ATTRIBUTION_KEYS = KEYS;
