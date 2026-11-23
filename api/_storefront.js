// api/_storefront.js — storefront feature flags (PR-2, 23 Nov 2026). Served to the page as `/api/stock` -> `storefront`.
//
// OFF BY DEFAULT. With these defaults the page behaves exactly as before PR-2: one Gradient Edit page, no category tabs,
// no family cards, no new styles, no extra request. The page loads /js/storefront.js + /data/cards.json ONLY when
// `families` is true (or, for the bag progress line, when ladders.json ui.progress_line is true).
//
// How to switch on (no code change):
//   - Vercel env var KARMI_STOREFRONT_FAMILIES=on  (set it for the Preview environment only to test on a preview URL;
//     for Production it is the opening switch, PR-3);
//   - or change DEFAULTS.families below (a commit + deploy).
// Rollback = unset the env var (or false here) and redeploy. No DB change, no price change.
//
// Plain JS on purpose: no JSON file read, nothing to add to vercel.json includeFiles, no import.meta (Vercel compiles
// api/*.js to CommonJS).

export const DEFAULTS = Object.freeze({
  families: false,      // category tabs (Gradient Edit · Bracelets · Necklaces · Hair) + family cards
  sold_out: 'last',     // with families on: sold-out cards stay visible at the end, marked "Sold out" ('hide' = today)
  refresh_s: 60,        // with families on: stock/caps refresh while the page is open (cap/sold-out without reload)
});

const ON = new Set(['1', 'on', 'true', 'yes']);
const OFF = new Set(['0', 'off', 'false', 'no']);

/** The flags the page gets. Unknown env values fall back to the default (never accidentally on). */
export function storefrontConfig(env = (typeof process !== 'undefined' && process.env) || {}) {
  const raw = String(env.KARMI_STOREFRONT_FAMILIES ?? '').trim().toLowerCase();
  const families = ON.has(raw) ? true : OFF.has(raw) ? false : DEFAULTS.families;
  const so = String(env.KARMI_STOREFRONT_SOLD_OUT ?? '').trim().toLowerCase();
  return {
    families,
    sold_out: so === 'hide' || so === 'last' ? so : DEFAULTS.sold_out,
    refresh_s: DEFAULTS.refresh_s,
  };
}
