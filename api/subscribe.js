// /api/subscribe.js — Email capture for the Karmi Laven popup.
//
// POST { email } → upserts into karmi_subscribers (shared ops v2 Supabase).
// Idempotent: duplicate email → 200 ok (no error surfaced to client).
// Service-role key is server-side only (Vercel env). Never exposed to the browser.
//
// Env vars (already set in the Vercel project from /api/stock.js):
//   OPS_SUPABASE_URL         — shared ops v2 Supabase project URL
//   OPS_SUPABASE_SERVICE_KEY — service-role key (bypasses RLS)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-process rate-limit: max 5 requests per IP per minute.
// Resets on cold-start (acceptable for serverless; protects hot paths).
const RATE = new Map(); // ip → { count, resetAt }
function checkRate(ip) {
  const now = Date.now();
  const window = 60_000;
  let r = RATE.get(ip);
  if (!r || now > r.resetAt) {
    r = { count: 0, resetAt: now + window };
    RATE.set(ip, r);
  }
  r.count++;
  return r.count <= 5;
}

export default async function handler(req, res) {
  // CORS pre-flight (for any cross-origin fetch from the same domain)
  res.setHeader('Access-Control-Allow-Origin', 'https://karmilaven.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }

  // Rate-limit by forwarded IP
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ ok: false, error: 'too many requests' });
  }

  // Parse body — Vercel @vercel/node parses JSON automatically
  const email = (typeof req.body?.email === 'string' ? req.body.email : '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'invalid email' });
  }

  const base = process.env.OPS_SUPABASE_URL;
  const key  = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    console.error('[subscribe] Supabase env vars not set');
    return res.status(500).json({ ok: false, error: 'server config error' });
  }

  try {
    // Upsert on lower(email) uniqueness — idempotent, no client-visible error on dup
    const r = await fetch(`${base}/rest/v1/karmi_subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        // PostgREST: on conflict do nothing (idempotent upsert)
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ email, source: 'popup' }),
    });

    if (!r.ok && r.status !== 409) {
      const body = await r.text();
      console.error('[subscribe] Supabase error', r.status, body);
      return res.status(500).json({ ok: false, error: 'db error' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[subscribe] fetch error', e);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
}
