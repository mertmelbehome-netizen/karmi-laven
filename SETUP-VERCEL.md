# Karmi Laven — Vercel (combined checkout + accurate ROI)

Moving hosting to Vercel unlocks: ONE combined cart checkout (multi-colour, free-over-£30 shipping)
and SERVER-SIDE conversion tracking (Meta CAPI + GA4) = accurate ROI.

## 1. Connect repo
- vercel.com → New Project → Import GitHub repo **mertmelbehome-netizen/karmi-laven** → Deploy.
- (Static index.html is served as-is; the /api functions become live endpoints.)

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)
| Key | Value |
|-----|-------|
| STRIPE_SECRET | sk_test_… (then sk_live_… when going live) |
| STRIPE_WEBHOOK_SECRET | whsec_… (from step 4) |
| META_PIXEL_ID | your pixel id |
| META_CAPI_TOKEN | Events Manager → Conversions API → access token |
| GA4_MEASUREMENT_ID | G-XXXXXXX |
| GA4_API_SECRET | GA4 → Admin → Data Streams → Measurement Protocol API secrets |

## 3. Point domain to Vercel
- Vercel → Project → Domains → add **karmilaven.com** + **www**.
- In Namecheap Advanced DNS, replace the GitHub records with what Vercel shows
  (typically: A @ → 76.76.21.21 ; CNAME www → cname.vercel-dns.com).

## 4. Stripe webhook (for server-side Purchase)
- Stripe → Developers → Webhooks → Add endpoint → **https://karmilaven.com/api/stripe-webhook**
- Event: **checkout.session.completed** → save the **Signing secret** → put in STRIPE_WEBHOOK_SECRET.

## 5. Client-side IDs (in index.html)
- Set `const ANALYTICS={ pixel:'…', ga4:'G-…' }` near the top of the script (Pixel + GA4 client events).
- Server-side (webhook) + client Pixel use the same event id where possible → deduped.

## Result
- Cart "Checkout" → /api/checkout → one Stripe session with all items + correct shipping.
- On payment → webhook fires Purchase to Meta + GA4 (accurate, ad-blocker-proof) +
  client also fires Purchase on the /?checkout=success redirect.
- Full funnel: ViewContent → AddToCart → InitiateCheckout → Purchase, with revenue/ROI in Ads Manager + GA4.
