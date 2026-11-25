# Accessibility pass, WCAG 2.2 AA (25 Nov 2026)

K&D's gate-level FAILs on the storefront (font size, contrast, small tap targets, unnamed controls, reduced motion; K&D M1 review 24 Nov)
were the same on master and are blocking debt for the 30 Nov relaunch. This PR closes them. Display, CSS and ARIA only: no price,
`api/*`, `ladders.json`, checkout, cart logic or JS behaviour is touched (the only JS edit is the inline "Shop by colour" scroll, which now
asks `prefers-reduced-motion` first).

## What changed

| Where | What |
|---|---|
| `css/a11y.css` (new, linked last in `<head>`) | contrast tokens, 44 px targets, control borders, reduced-motion rule, bag footer clearance |
| `index.html` | every `font-size` below 12 px raised to 12 px (54 declarations); `aria-label` on the close buttons, the cart "-" button and the e-mail pop-up input; one inline link colour; `a11y.css` link |
| `css/storefront.css` | 7 `font-size` declarations raised to 12 px; mobile announce bar padding / tracking retuned so the first card still ends above the sticky bar |
| `tests/a11y.test.mjs` (new), `tests/storefront-nav.test.mjs` | pins for the rules above; the announce-bar pin follows the new values |
| `scripts/dev/a11y_measure.py` (new) | the browser measurer used for the tables below |

Rules used (from K&D's audits): text >= 12 px everywhere (K-04, 70 %-off checklist #10); card price line >= 14 px (V-11); text contrast
>= 4.5:1 (large text >= 3:1); outlined control borders >= 3:1 (WCAG 1.4.11); tap targets >= 44 x 44 CSS px (V-08; WCAG 2.5.8 asks 24);
every control has a name (V-15); `prefers-reduced-motion` (V-25).

Colour note for the owner: the small-text tokens are the darker variants that `html.kl-v2` already used (`--soft #6b6457`,
`--accent #8a5f58`, `--gold-text #7d5f2a`), now applied to the whole page and to gold text (it was 2.9:1 on the cream). Large decorative
gold (script signature, icons) follows the same token. This is a visible, small colour change and can be tuned in `css/a11y.css`.

## How it was measured

`py -3 scripts/dev/a11y_measure.py http://127.0.0.1:PORT/` against `node scripts/dev/serve.mjs --port PORT` (fixture `/api/stock`, no DB):
flag OFF = no `--families`; flag ON = `--families`. Chromium (Playwright), viewports 390 x 844 and 1280 x 800. States walked: home, every
family tab (flag ON), product modal, bundle, bag with 9 items ("Add 1 more ..."); while a dialog is open only that dialog is measured.

* text size and contrast: computed style of every visible text node; WCAG luminance formula; text over a photo or gradient is measured on
  the real pixels (glyphs hidden, centre of the box, worst 10 % of pixels);
* tap targets: `getBoundingClientRect()` of every link, button, input, select, tab; links inside a sentence are exempt (WCAG 2.5.8 inline
  exception) and counted apart (4 on the old page, 24 with families, all under 24 px but inline);
* names: aria-labelledby / aria-label / label / text / img alt / title;
* reduced motion: a fresh context with `reduced_motion='reduce'`; any transition, animation (with delay) or `scroll-behavior:smooth`;
* help bubble: the bubble itself is not in this repo (no chat widget in the code; the one K&D saw on the trial deploy is third-party), so a
  56 x 56 fixed circle 16 px from the bottom-right corner is injected and intersected with every text line and control of the open bag
  and of the cookie banner.

K&D's own tools (`kd_karmi_pct_a11y.py`, `kd_karmi_bag_line_a11y.py`) give the same numbers on both builds for the 70 % texts (>= 12 px,
>= 5.4:1) and the bag line goes from 5.55:1 to 6.75:1.

## Before / after

#### Relaunch flag OFF (old page), 390 x 844

| Item | Before | After |
|---|---|---|
| 1 min text size | 7px (div.ql) | 12px (div.cb-text) |
| 1 text below floor (12 px; card price 14 px) | 74 | 0 |
| 2 min text contrast (needs 4.5; large 3) | 2.39 (span.note); over photo min 2.87 | 5.09 (div.k); over photo min 5.63 |
| 2 text failing contrast | 98 | 0 |
| 2 min border contrast of outlined controls (needs 3) | 1.27 | 3.15 |
| 3 smallest tap target (needs 44x44) | 11px (btn.ci-x 41x11) | 44px (btn.cb-btn 79.2x44) |
| 3 targets under 44 px (distinct) | 24 | 0 |
| 4 unnamed controls | 4 | 0 |
| 4 glyph-only names (-, x) | 13 | 0 |
| 5 reduced motion | not OK (94 rules) | OK |
| 6 help bubble overlaps the bag / cookie banner | YES (5 lines/controls) | no |

#### Relaunch flag OFF (old page), 1280 x 800

| Item | Before | After |
|---|---|---|
| 1 min text size | 8px (div.ql) | 12px (btn.cb-btn) |
| 1 text below floor (12 px; card price 14 px) | 67 | 0 |
| 2 min text contrast (needs 4.5; large 3) | 2.39 (span.note); over photo min 2.32 | 5.09 (div.k); over photo min 5.63 |
| 2 text failing contrast | 97 | 0 |
| 2 min border contrast of outlined controls (needs 3) | 1.27 | 3.15 |
| 3 smallest tap target (needs 44x44) | 11px (btn.ci-x 41x11) | 44px (btn.cb-btn 91.2x44) |
| 3 targets under 44 px (distinct) | 24 | 0 |
| 4 unnamed controls | 4 | 0 |
| 4 glyph-only names (-, x) | 13 | 0 |
| 5 reduced motion | not OK (94 rules) | OK |
| 6 help bubble overlaps the bag / cookie banner | YES (3 lines/controls) | no |

#### Relaunch flag ON (families view), 390 x 844

| Item | Before | After |
|---|---|---|
| 1 min text size | 7px (div.ql) | 12px (div.cb-text) |
| 1 text below floor (12 px; card price 14 px) | 254 | 0 |
| 2 min text contrast (needs 4.5; large 3) | 3.09 (span.note); over photo min 3.44 | 4.77 (div.announce); over photo min 4.90 |
| 2 text failing contrast | 9 | 0 |
| 2 min border contrast of outlined controls (needs 3) | 1.27 | 3.15 |
| 3 smallest tap target (needs 44x44) | 21px (btn.nudge-add 58.2x21) | 44px (btn.cb-btn 79.2x44) |
| 3 targets under 44 px (distinct) | 1 | 0 |
| 4 unnamed controls | 0 | 0 |
| 4 glyph-only names (-, x) | 1 | 0 |
| 5 reduced motion | not OK (85 rules) | OK |
| 6 help bubble overlaps the bag / cookie banner | YES (4 lines/controls) | no |

#### Relaunch flag ON (families view), 1280 x 800

| Item | Before | After |
|---|---|---|
| 1 min text size | 8px (div.ql) | 12px (btn.cb-btn) |
| 1 text below floor (12 px; card price 14 px) | 247 | 0 |
| 2 min text contrast (needs 4.5; large 3) | 3.09 (span.note); over photo min 3.45 | 4.77 (div.announce); over photo min 4.90 |
| 2 text failing contrast | 9 | 0 |
| 2 min border contrast of outlined controls (needs 3) | 1.27 | 3.15 |
| 3 smallest tap target (needs 44x44) | 18.4px (a 120.5x18.4) | 44px (btn.cb-btn 91.2x44) |
| 3 targets under 44 px (distinct) | 31 | 0 |
| 4 unnamed controls | 0 | 0 |
| 4 glyph-only names (-, x) | 1 | 0 |
| 5 reduced motion | not OK (86 rules) | OK |
| 6 help bubble overlaps the bag / cookie banner | YES (3 lines/controls) | no |


## Not fixed / limits

* `contact.html`, `privacy.html`, `terms.html`, `shipping-returns.html`, `review.html` are not part of this pass (the storefront page and its
  dialogs are); `contact.html` still has 11 px text.
* The real help bubble is not in this repo, so its true size and position are an assumption (56 px, 16 px from the corner, the common size).
  If it is bigger the clearance in `.cart-foot` (76 px) is the one number to change.
* Non-text contrast was measured for the borders of outlined controls only; the thin hairline between sections is decoration and was left.
* The measurer cannot see states that need real stock or real photos (sold-out cards, 2-photo carousels); the carousel dots / thumbs rules
  are in the CSS and pinned by the test, not measured.
