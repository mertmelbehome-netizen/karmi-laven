# Karmi Laven — Klaviyo Setup (abandoned cart + email capture + personalisation)

The on-site code is already wired. You only need to (1) create the Klaviyo account,
(2) paste one key into the site, (3) build the popup form + abandoned-cart flow in
Klaviyo's dashboard (no code).

## 1. Create account + get the key
- Sign up at **klaviyo.com** (free up to 250 contacts / 500 emails/mo).
- **Account → Settings → API keys → Public API Key** (a 6-character "site/company ID").

## 2. Paste the key into the site
- In `index.html`, near the top of the script:
  ```js
  const ANALYTICS={ pixel:'1791961201982687', ga4:'', klaviyo:'' };
  ```
  Set `klaviyo:'XXXXXX'` (your Public API Key). Commit → Vercel redeploys. Done — tracking is live.

## 3. What the site already sends to Klaviyo (once the key is set)
| Event | Fires when | Used for |
|-------|-----------|----------|
| **Active on Site** | any visit (Klaviyo onsite JS) | who's browsing |
| **Viewed Product** | opens a colour modal | browse retargeting, personalisation |
| **Added to Cart** | adds a bracelet / stack | add-to-cart reminders |
| **Started Checkout** | clicks Checkout (`$value`, items, CheckoutURL) | **abandoned cart** trigger |

## 4. Email capture popup (no code)
- Klaviyo → **Sign-up Forms → Create Form → Popup**.
- Trigger: on load (e.g. 5s) or exit-intent; offer (e.g. "10% off first order").
- This captures the email and **cookies the profile** — so a later "Started Checkout"
  is tied to a known person, which is what makes abandoned-cart possible.

## 5. Abandoned cart flow (no code)
- Klaviyo → **Flows → Create Flow → Abandoned Cart** (or trigger off the **Started Checkout** metric).
- Timing e.g. email 1 at 1h, email 2 at 24h. Pull `CheckoutURL` / item names into the template.

## 6. (Optional later) identify on purchase
- After payment we could push `identify({$email})` server-side from the webhook so purchasers
  are matched even without filling the popup. Not required for v1.

## Notes
- All site events are **no-ops until `ANALYTICS.klaviyo` is set** — safe to ship now.
- Meta Pixel + CAPI keep running independently (Klaviyo is additive, not a replacement).
- Decision (2026-06-23): stay on the custom site + Klaviyo for Shopify-grade tracking/
  personalisation without migrating. Re-evaluate Shopify only when online hits steady daily volume.
