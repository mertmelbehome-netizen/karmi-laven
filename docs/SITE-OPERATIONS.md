# Karmi Laven — Site Operations & Data Flow

How karmilaven.com actually works end-to-end, what data exists where, what's
instrumented, and the prioritised action plan for what to connect next.

_Last updated: 2026-06-23._

---

## 1. Architecture

- **Hosting:** Vercel (`karmi-laven.vercel.app`), custom domain `karmilaven.com` (CNAME).
- **Repo:** `mertmelbehome-netizen/karmi-laven`, branch **master**.
- **Frontend:** single static `index.html` (~1.7MB, base64 assets inline). No framework.
- **Serverless:** `api/checkout.js` (creates Stripe Checkout), `api/stripe-webhook.js`
  (post-payment: records order → ops v2 + analytics + owner push).
- **Catalog source of truth:** the `DATA` array inside `index.html` — 15 SKUs, each
  `{barcode, type, color_en, swatch, img, qty, price, pay}`. **Barcode = ops v2 barcode.**

## 2. Customer journey & events

| Step | What happens | Tracked (Meta Pixel) | Tracked (GA4) |
|------|--------------|----------------------|---------------|
| Land | `initAnalytics` | `PageView` | ⚠️ inactive (no GA4 id) |
| View colour | open modal | `ViewContent` | `view_item` |
| Add to bag | cart in `localStorage.klcart` | `AddToCart` | `add_to_cart` |
| Checkout | POST `/api/checkout` | `InitiateCheckout` | `begin_checkout` |
| Pay | Stripe Checkout (cards + Apple/Google Pay) | — | — |
| Success | redirect `/?checkout=success` → `firePurchaseIfSuccess()` | `Purchase` (deduped via eventId) | `purchase` |

- **Pricing:** multi-buy ladder by **total** bracelet count (1/2/3/5 = £2.99/5.50/7.50/12),
  least-cost DP. Free UK shipping ≥ £15 subtotal or 5+ bracelets.
- **Checkout (current):** each bracelet is its own Stripe line item `"{barcode} · {colour}"`,
  bundle total distributed across lines with exact-penny reconciliation; barcode breakdown
  also written to `session.metadata.items` / `items_named`.
- **Purchase dedup:** client `Purchase` and server CAPI share the same `eventId`
  (stored in `localStorage.klpending`).

## 3. Post-payment (webhook) — `checkout.session.completed`

1. **Records the order → ops v2** `online_orders` table (idempotent on `stripe_session_id`):
   customer, address, phone, per-barcode items + revenue, amount, status `paid`.
2. **Owner push** (best-effort) → ops v2 `/api/push/send`, deep-links to `/orders`.
3. **Meta CAPI** server-side `Purchase` (accurate, ad-blocker-proof).
4. **GA4 Measurement Protocol** server-side `purchase` (if env set).

Fulfilment is **manual** in ops v2 `/orders` ("Siparişi Tamamla") → `fn_online_sale_event`
decrements **WAT stockroom first, then display**, as an audited sale.

## 4. Data we have vs. don't

**Have:** completed orders (Stripe + ops v2 `online_orders`), completed-purchase analytics,
per-order barcode breakdown, customer email/phone/address (on paid orders).

**Don't have (gaps):**
- ❌ **Abandoned carts** — no capture of bags left before payment.
- ❌ **GA4 client analytics** — `ANALYTICS.ga4` is empty, so the on-site funnel isn't in GA4.
- ❌ **Email list** — no newsletter/marketing capture.
- ❌ **Live stock on site** — `DATA.qty` is hardcoded; sold-out colours aren't enforced → oversell risk.
- ❌ **Shipping/tracking email to customer** — relies on Stripe receipt only.
- ❌ **Refund sync** — Stripe refunds don't reverse the ops v2 sale.

## 5. Environment variables (Vercel → karmi-laven → Settings → Environment Variables)

| Key | Purpose |
|-----|---------|
| `STRIPE_SECRET` | Stripe API (checkout) |
| `STRIPE_WEBHOOK_SECRET` | verify webhook signature |
| `OPS_SUPABASE_URL` | ops v2 Supabase (record orders) |
| `OPS_SUPABASE_SERVICE_KEY` | ops v2 service role |
| `OPS_APP_URL` | ops v2 URL (owner push) |
| `META_PIXEL_ID` / `META_CAPI_TOKEN` | Meta CAPI |
| `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` | GA4 server-side |

## 6. Action plan (prioritised)

**P1 — quick wins**
1. **Abandoned cart + email capture + personalisation** — ✅ DECIDED: via **Klaviyo**
   (custom site, no Shopify migration). On-site events wired (Viewed Product / Added to
   Cart / Started Checkout). Remaining = paste Public API Key into `ANALYTICS.klaviyo`
   + build popup form & abandoned-cart flow in Klaviyo. See `KLAVIYO-SETUP.md`.
2. **GA4 on-site** — set `ANALYTICS.ga4` + confirm server `GA4_*` env → full funnel in GA4.

**P2 — revenue/ops**
3. **Live stock on site** — pull WAT availability from ops v2 (read-only endpoint) →
   hide/disable sold-out colours; stop overselling.
4. **Shipping email + tracking** — add `tracking_number` to `online_orders`; on
   "Siparişi Tamamla" send branded "order shipped" email (Zoho) to the customer.
5. **Refund sync** — Stripe `charge.refunded` webhook → ops v2 `refund` movement (stock back).

**P3 — growth**
6. **Newsletter capture** (footer email field) → list (Supabase/Zoho/Mailchimp).
7. **Online sales dashboard in ops v2** — summary of `online_orders` (now that data lands).
8. **Post-purchase upsell / reviews** request email.

See `SETUP-VERCEL.md` for the original Vercel/Stripe setup steps.

## 7. Product gallery (photos[], PR #93)

- A family card shows a swipe gallery only when `data/cards.json` gives it `photos[]` with 2+ entries,
  `photos[0].src === photo` and `photo_qc: true` (one photo or none = the plain card, byte-identical).
- Extra photos are `img/fam/<barcode>_2.jpg`, `_3.jpg` ... (web size, same 4/5 box as the main photo, each file
  under 150 KB; `tests/product-gallery.test.mjs` checks this). `node scripts/gen-cards.mjs <wave1_config.json>
  --photos <dir>` reads `<barcode>_N.jpg` from the same `--photos` dir and needs the item's `gallery_ai`
  (true/false); it throws without it.
- **Only photos that passed photo QC may be placed in the `--photos` folder.** gen-cards treats every file there
  as QC-passed (`qc: true`), so an unchecked file in that folder goes live as soon as the data is merged.
- `photos[0]` (the main photo) may omit `ai`: it is labelled from the card's `ai_image`. Every extra photo must
  carry `ai: true/false`; an AI-styled extra photo shows the "AI-styled image" label on its slide.
- Gradient cards use the same rule in the inline `DATA` (`DATA[].photos`, `photos[0].src === img`).

### 7a. Lead photo: PHOTO-MIX RULE v1 trial (D-004, 26 Nov 2026)

- Optional `lead` on a family card in `data/cards.json` = index into `photos[]` of the photo the card shows FIRST
  (default 0 = the main photo). Slides: the lead photo, then the rest in their original order; `photos[0]` stays
  the main photo in the data. No `lead` (or an invalid one) = the card is byte-identical to before.
- The "AI-styled image" label follows each image's own `ai` flag (the lead included); the main photo keeps its
  `ai_image` label wherever it sits. The bag line thumbnail uses the lead image too. Stripe line items, og:image and
  JSON-LD carry no card image, so nothing else changes. No size claim in a close-up's alt text.
- Rule (v1 trial, 2-column phone grid): (b) no two neighbouring cards (side by side, or one row down) lead with a
  worn shot (wrist / neck template); (c) a real photo keeps the lead; (a) >= 60 % of the first 8 cards lead with a
  non-worn image. Fewest swaps; the owner's Sparkle cards 81004 / 81006 / 81013 always lead with the close-up.
- `node scripts/photo-mix.mjs` prints the scene sequence per tab before/after; `--solve` prints the minimum swap set;
  `tests/photo-mix-lead.test.mjs` fails on a neighbouring worn pair that a close-up could fix, or an unneeded swap.
  From the wave-1 config, `gallery_lead` (>= 1) becomes `lead` in gen-cards.
- Known data limits (no close-up on either card; no new render in v1): bracelets 6009 + 6017, necklaces 7056 + 6091
  (necklaces first screen 4 of 7 non-worn). Measure: `funnel_events` add_to_cart per `product_bc`, lead cards vs the
  rest, the two weeks before vs after the deploy (the beacon has no field for the lead; no new table in v1).
