// Public analytics ids for the storefront (21 Nov 2026). The page asks for them ONLY after the visitor
// pressed "Accept" in the cookie banner; nothing here sets a cookie or tracks anyone.
// Vercel env: GA4_MEASUREMENT_ID = "G-XXXXXXXXXX" (Google Analytics 4 web stream id). Empty or not in that
// shape -> ga4 is '' and the page loads no Google script at all.
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const raw = String(process.env.GA4_MEASUREMENT_ID || '').trim();
  const ga4 = /^G-[A-Z0-9]{4,16}$/.test(raw) ? raw : '';
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ ga4 });
}
