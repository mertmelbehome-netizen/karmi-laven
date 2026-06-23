# Karmi Laven — CRO Plan (feat/cro-popup-funnel)

## Funnel Snapshot (owner data, 2026-06)

| Stage | Count | Rate |
|---|---|---|
| Content views | 60 | — |
| Add-to-cart | 46 | 77% view→cart |
| Initiated checkout | 3 | **6.5% cart→checkout** |
| Purchases | 3 | 100% checkout→purchase |

**The problem is entirely in the cart→checkout step.** 43 of 46 people who added to cart never reached checkout.

---

## Diagnosis — Top 3 Root Causes

### 1. `addToCart()` did NOT open the cart drawer (index.html:627)
`addToCart` called `toast('Added to bag')` — a 1.8-second micro-message — but never called `openCart()`. The cart drawer stayed closed. Users had no visual confirmation of what they added, no summary, and no obvious next step. They likely thought they were "saving for later" or didn't realise a cart existed.

**Fix shipped (this branch):** `addToCart` now calls `openCart()` immediately, surfacing the cart drawer with the item, price summary, and a prominent "Checkout" CTA.

### 2. Mobile sticky bar had NO cart/checkout shortcut (index.html:441)
The `.stickybar` (shown on all screens ≤840px — the majority of visitors on mobile) only offered "Build your bundle". After adding an item, users on mobile had no persistent call-to-action to proceed to checkout. The "Bag · 0" button at the top of the page is above the fold and requires scrolling back up.

**Fix shipped:** The sticky bar now shows a "View bag · N" button (accent colour, distinct from the bundle button) whenever the cart has items, and the price info updates to show item count + subtotal.

### 3. No persistent cart indicator after add (index.html:177, 314)
The "Bag · N" count in the nav updates (`updateBag()`), but on a long single-page scroll site, that nav element is no longer visible after the user scrolls past it. There was no floating cart badge, drawer auto-open, or persistent sticky indicator. Users who scrolled down to browse more products had no reminder that they had items in their cart.

**Fix shipped:** Stickybar dynamically reflects cart state (item count + subtotal) as a persistent visible CTA, and the cart opens immediately on add.

---

## Fixes Shipped in This Branch

| Fix | File | Change |
|---|---|---|
| Cart drawer auto-opens on add | `index.html:637` | `toast()` replaced with `openCart()` |
| Stickybar "View bag" CTA | `index.html:441-444` | Added `#stickyCart` button, hidden until cart has items |
| `updateBag()` syncs stickybar | `index.html:624-634` | Updates `#stickyN`, `#stickyInfo`, show/hides buttons |
| Email capture popup | `index.html` (inserted) | Exit-intent + 20s delay, 7-day freq cap, Klaviyo-gated |

---

## Email Popup — How It Works

- **Trigger:** desktop exit-intent (mouse leaves viewport top) OR 20-second delay (all devices) OR tab switch/hide
- **Frequency cap:** 7 days via `localStorage.klpop_shown` — does not re-show on every visit
- **Klaviyo gate:** if `ANALYTICS.klaviyo` is empty (current state), `klId()` and `kl()` are no-ops — popup captures UX but sends nothing. Activates automatically once a Klaviyo Public API Key is set.
- **On submit:** identifies user in Klaviyo + fires `Subscribed Popup` event (powers list-building flow); shows thank-you state for 2.5s then auto-closes
- **Design:** on-brand (Cormorant Garamond title, crystal aesthetic), bottom-sheet on mobile, dismissible via X or "No thanks"

---

## Prioritised CRO Backlog

### P0 — Shipped in this branch
- [x] Cart drawer opens immediately on add-to-bag
- [x] Persistent sticky "View bag" button on mobile
- [x] Email capture popup (exit-intent + delay)

### P1 — High impact, low effort (next sprint)
- [ ] **Abandoned-cart email flow (Klaviyo):** set `ANALYTICS.klaviyo` Public Key → build Klaviyo flow triggered by `Started Checkout` event with `CheckoutURL`. Already instrumented client-side. Expected: recover 10–20% of abandoned carts.
- [ ] **Trust signals below the CTA:** add a trust bar ("Secure checkout · Stripe · Royal Mail · Free returns") directly above the Checkout button in the cart footer. Currently only "Apple Pay & Google Pay at checkout" is shown.
- [ ] **Add-to-cart confirmation micro-animation:** pulse the bag count or briefly highlight the cart drawer tab on add.

### P2 — Medium effort, measurable impact
- [ ] **"You're £X away from free shipping" nudge in cart:** already in the cart footer, but not highlighted. Make the free-shipping threshold more prominent with an accent colour and progress bar.
- [ ] **Bundle upsell CTA in cart:** if cart has 1 item, show "Add 1 more bracelet and save £X (multi-buy)" inline. Increases AOV and reduces churn.
- [ ] **Social proof:** add a count badge ("47 people viewing", "14 sold today") or review widget. Crystal bracelets are impulse buys — social proof nudges decision.
- [ ] **Sticky checkout button at top of cart drawer:** on long carts (3+ items), the checkout button is below the fold of the drawer. Duplicate it at the top.

### P3 — Longer term / strategic
- [ ] **Klaviyo browse abandonment flow:** fire `Viewed Product` (already instrumented) → trigger email if user doesn't buy within 1 hour.
- [ ] **Post-purchase review request:** email 7 days after fulfilment. Feeds social proof above.
- [ ] **Multi-currency / EU expansion:** currently GB only. Meta Pixel is live → test EU ad sets once UK baseline is proven.
- [ ] **Persistent cart (cross-session):** `klcart` is already in `localStorage` — cart survives page refresh. Consider surfacing a "Welcome back — your bag is waiting" banner for returning visitors with items.

---

## How to Activate Klaviyo

1. Create a Klaviyo account at klaviyo.com
2. Go to Account → Settings → API Keys → copy the **Public API Key** (6-char company ID)
3. In `index.html`, set: `const ANALYTICS={ ..., klaviyo: 'YOUR_KEY' };`
4. In Klaviyo, create a **List** called "Karmi Laven Subscribers" and map the `Subscribed Popup` event to it
5. Build a **Flow** triggered by `Started Checkout` → send abandoned-cart email after 1 hour if no purchase
6. See `docs/KLAVIYO-SETUP.md` for the full step-by-step guide

---

*Branch: `feat/cro-popup-funnel` — do NOT merge to master without smoke-testing on a preview deploy.*
