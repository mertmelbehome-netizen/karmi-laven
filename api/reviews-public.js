// Karmi Laven — public approved reviews for the homepage social-proof section.
// GET → { count, avg, reviews:[{customer_name,rating,title,body,product_bc,created_at}] }
// Reads only approved=true via the ops Supabase service key (server-side); never
// exposes the key to the browser. Cached at the edge for a minute.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) return res.status(200).json({ count: 0, avg: 0, reviews: [] });

  const sel = 'customer_name,rating,title,body,product_bc,created_at';
  const url = `${base}/rest/v1/reviews?select=${sel}&approved=eq.true&order=created_at.desc&limit=12`;
  // Separate exact count over the full approved set (not just the 12 returned).
  const countUrl = `${base}/rest/v1/reviews?select=rating&approved=eq.true`;

  try {
    const [r, rc] = await Promise.all([
      fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
      fetch(countUrl, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' } }),
    ]);
    const reviews = r.ok ? await r.json() : [];

    // avg + count across ALL approved rows (from the count query's body if small,
    // else from the content-range header for count and the returned ratings for avg).
    let count = reviews.length, avg = 0;
    const cr = rc.headers.get('content-range'); // e.g. "0-0/37"
    if (cr && cr.includes('/')) { const n = parseInt(cr.split('/')[1], 10); if (!isNaN(n)) count = n; }
    if (rc.ok) {
      const all = await rc.json().catch(() => []);
      if (Array.isArray(all) && all.length) avg = all.reduce((s, x) => s + (x.rating || 0), 0) / all.length;
    }
    if (!avg && reviews.length) avg = reviews.reduce((s, x) => s + (x.rating || 0), 0) / reviews.length;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ count, avg: Math.round(avg * 10) / 10, reviews });
  } catch (e) {
    return res.status(200).json({ count: 0, avg: 0, reviews: [] });
  }
}
