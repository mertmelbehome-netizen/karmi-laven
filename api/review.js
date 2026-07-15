// Karmi Laven — collect a customer review.
// POST { order_id?, rating (1-5), title?, body, customer_name?, email?, product_bc?, photo?, hp? }
// Inserts into the shared ops Supabase `reviews` table with approved=false
// (owner moderates before it appears on site). No public read here.
// `photo` (optional) is a base64 data URL — uploaded to the public `review-photos`
// Storage bucket; the resulting public URL is stored in reviews.photo_url.
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

const PHOTO_BUCKET = 'review-photos';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // ~5MB
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Best-effort: upload a base64 data URL to Storage, return the public URL (or null).
// Any failure returns null — a photo problem must never block the text review.
async function uploadPhoto(base, key, dataUrl) {
  try {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
    if (!m) return null;
    const mime = m[1].toLowerCase();
    if (!/^image\//.test(mime) || !EXT[mime]) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;

    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${EXT[mime]}`;
    const up = await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET}/${name}`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000',
      },
      body: buf,
    });
    if (!up.ok) return null;
    return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${name}`;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) return res.status(500).json({ error: 'not configured' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }

  // Honeypot — bots fill hidden fields. Pretend success, drop silently.
  if (b.hp) return res.status(200).json({ ok: true });

  const rating = parseInt(b.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'rating must be 1–5' });

  const body = clip(b.body, 2000);
  if (!body || body.length < 2) return res.status(400).json({ error: 'review text required' });

  // Optional photo — upload is isolated + non-blocking. Failure ⇒ photo_url stays null.
  const photo_url = b.photo ? await uploadPhoto(base, key, b.photo) : null;

  const row = {
    order_id: clip(b.order_id, 120),
    customer_name: clip(b.customer_name, 80),
    email: clip(b.email, 160),
    rating,
    title: clip(b.title, 120),
    body,
    photo_url,
    product_bc: clip(b.product_bc, 60),
    approved: false,
  };

  try {
    const r = await fetch(`${base}/rest/v1/reviews`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: 'save failed', detail: t.slice(0, 200) }); }
  } catch (e) {
    return res.status(502).json({ error: 'save failed' });
  }

  // Best-effort owner push (mirrors webhook pattern). Non-fatal.
  const appUrl = process.env.OPS_APP_URL;
  if (appUrl) {
    fetch(`${appUrl}/api/push/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Yeni değerlendirme — Karmi Laven',
        detail: `${'★'.repeat(rating)} · ${row.customer_name || 'Anonim'}${row.title ? ` · ${row.title}` : ''}${photo_url ? ' · 📷' : ''} (onay bekliyor)`,
        severity: 'info', store_id: 'WAT', url: '/orders',
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
}
