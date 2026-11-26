// Site basics 1 (26 Nov 2026; plan research/KARMI_SITE_PLAN_2026-11.md items 1-2, rules research/KARMI_SITE_RULES_v2_2026-11.md
// R2', R8, R10, R12, R13; owner via Komuta: categories first, Gradient Edit tab last as 'Beaded', Bracelets the landing tab;
// Komuta D-001 / D-002). Presentation only: pricing, ladders, checkout and api/ are untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HTML = read('../index.html')
const SF = read('../js/storefront.js')
const PAGES = ['index.html', 'shipping-returns.html', 'terms.html', 'contact.html', 'privacy.html', 'review.html']
const visible = (h) => h.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const lay = new Function(`${LAYOUT}; return { SFL_TABS, SFL_CHIP, sfDefTab };`)()
const core = new Function(`${CORE}; return { SF_TABS, SF_CHIP, SF_TITLE, SF_SUBS };`)()

// ---------- one delivery wording (R2' / R6'): the engine frees at subtotal >= £30, so "free over £30" was wrong ----------
test('"free over" appears nowhere the shopper can read (pages, storefront.js, data files)', () => {
  const files = PAGES.map((p) => ['../' + p, read('../' + p)])
    .concat([['../js/storefront.js', SF], ['../js/christmas.js', read('../js/christmas.js')]])
    .concat(readdirSync(new URL('../data/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => ['../data/' + f, read('../data/' + f)]))
  for (const [name, src] of files) assert.doesNotMatch(src, /free over|orders over/i, name)
})

test('wherever a static text says "free" about delivery, the fee and the threshold ("£30 or more") are in the same block', () => {
  const lt = JSON.parse(read('../ladders.json')).shipping
  const fee = '£' + (lt.below_threshold_fee_pence / 100).toFixed(2), thr = 'free on orders of £' + lt.free_threshold_pence / 100 + ' or more'
  let n = 0
  for (const p of ['index.html', 'shipping-returns.html', 'terms.html']) {
    const v = visible(read('../' + p))
    const metas = [...v.matchAll(/<meta [^>]*content="([^"]*)"/g)].map((m) => m[1])
    const blocks = v.replace(/<meta [^>]*>/g, '').split(/<\/?(?:p|li|div|h\d|ul|section|details|summary|footer|header|main|nav|aside|article|script)\b[^>]*>/)
      .map((b) => b.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    for (const b of metas.concat(blocks)) {
      if (!/\bfree\b/i.test(b)) continue
      n++
      assert.ok(b.includes(fee), `${p}: fee missing next to "free": ${b.slice(0, 160)}`)
      assert.ok(b.toLowerCase().includes(thr), `${p}: threshold wording missing: ${b.slice(0, 160)}`)
    }
  }
  assert.ok(n >= 15, 'blocks checked: ' + n)
})

test("announcement bar: fee + free threshold in ONE sentence (R2'), one line on phones, dispatch part desktop-only", () => {
  assert.match(HTML, /<div class="announce"><span class="an-ship">Ships within 1–2 business days · <\/span><span data-kl="bar">£3\.99 UK delivery · free on orders of £30 or more<\/span><\/div>/)
  assert.match(HTML, /function barSentence\(\)\{ return \(SHIP\.freeP!==null&&!SHIP\.freeQty&&SHIP\.feeP>0\) \? gbpP\(SHIP\.feeP\)\+' UK delivery · free on orders of '\+gbpShort\(SHIP\.freeP\)\+' or more' : shipSentence\(\); \}/)
  assert.match(HTML, /document\.querySelectorAll\('\[data-kl="bar"\]'\)\.forEach\(e=>\{e\.textContent=barSentence\(\);\}\);/)
  assert.match(HTML, /@media\(max-width:620px\)\{\.announce, html\.kl-v2 \.announce\{letter-spacing:\.02em; text-transform:none\} \.announce \.an-ship\{display:none\}\}/)
  assert.doesNotMatch(HTML, /\.announce[^{]*\{[^}]*(?:text-overflow|white-space:nowrap)/, 'never cut the threshold off')
})

// ---------- product view (R8, R10, R12, R13) ----------
test('modal: add button + "14-day returns" link in one bar, pinned to the modal bottom on phones; photo capped at 45vh, 4:5 kept; button text 13 px', () => {
  assert.match(HTML, /<div class="madd-bar"><button class="madd" id="mAdd" data-kl-m1="madd">Add to bag<\/button><a class="mret" href="\/shipping-returns\.html#returns">14-day returns<\/a><\/div>/)
  assert.match(HTML, /\.modal \.madd\{font-family:'Jost'; font-weight:400; font-size:13px;/)
  assert.match(HTML, /\.modal \.mimg\{height:45vh; width:auto; max-width:100%; aspect-ratio:4\/5; justify-self:center\}/)
  assert.match(HTML, /\.modal \.madd-bar\{position:sticky; bottom:0;/)
  assert.match(HTML, /\.modal \.mret\{[^}]*min-height:44px; font-size:13px/)
  assert.match(HTML, /<img id="mImg" alt="product">/, 'gallery #97 hook kept')
  // the returns link lands on the real returns text, and the period it names is the page's own
  const SR = read('../shipping-returns.html')
  assert.match(SR, /<h2 id="returns">Returns &amp; Refunds<\/h2>/)
  assert.match(SR, /cancel your order within <b>14 days<\/b>/)
})

// ---------- menu (plan item 2 + owner 26 Nov 2026) ----------
test('tabs: Bracelets, Necklaces, Gifts first, the Gradient Edit last as "Beaded"; ids / hashes stay "gradient"', () => {
  assert.deepEqual(core.SF_TABS, ['bracelets', 'necklaces', 'gifts', 'hair', 'rings', 'gradient'])
  assert.deepEqual(lay.SFL_TABS, core.SF_TABS)
  assert.equal(core.SF_CHIP.gradient, 'Beaded'); assert.deepEqual(lay.SFL_CHIP, core.SF_CHIP)
  assert.deepEqual(core.SF_SUBS.gradient.map((x) => x.label), ['Beaded', 'Beaded Cobra'])
  assert.match(LAYOUT, /id="kltab-' \+ t \+ '" data-tab="' \+ t \+ '"/)
})

test('landing tab = Bracelets (All) when shown, else the Gradient Edit; deep links win', () => {
  assert.equal(lay.sfDefTab(['bracelets', 'necklaces', 'gifts', 'gradient'], ''), 'bracelets')
  assert.equal(lay.sfDefTab(['necklaces', 'gradient'], ''), 'gradient')
  assert.equal(lay.sfDefTab(['bracelets', 'gradient'], 'gradient'), 'gradient')
  assert.equal(lay.sfDefTab(['bracelets', 'necklaces', 'gradient'], 'necklaces'), 'necklaces')
  assert.equal(lay.sfDefTab(['bracelets', 'gradient'], 'rings'), 'bracelets', 'a hidden tab falls back to the landing tab')
  assert.match(SF, /setTab\(ph \? ph\.tab : landingTab\(\), false, ph \? ph\.sub : 'all'\);/)
  assert.match(HTML, /klSfL\.sfPreTab\(document, klSfL\.vis\);/, 'pre-paint: the landing panel is the one painted')
})

test('Hair / Rings chips: never painted from memory while loading (only the live answer shows them)', () => {
  assert.match(HTML, /\.filter\(function \(t\) \{ return t !== 'hair' && t !== 'rings'; \}\);/)
  const vis = new Function('localStorage', `var SFL_TABS = ${JSON.stringify(lay.SFL_TABS)}; var m = {}; try { m = JSON.parse(localStorage.getItem('kl_sf_tabs') || '{}') || {}; } catch (e) {}
    ${HTML.match(/  var vis = \(Array\.isArray[^\n]*/)[0]}
    return vis;`)
  const ls = (v) => ({ getItem: () => JSON.stringify({ v }) })
  assert.deepEqual(vis(ls(['gradient', 'bracelets', 'necklaces', 'hair', 'gifts', 'rings'])), ['gradient', 'bracelets', 'necklaces', 'gifts'])
  assert.deepEqual(vis({ getItem: () => null }), ['bracelets', 'necklaces', 'gifts', 'gradient'])
})

// ---------- Komuta D-002 / D-001 wording ----------
test('D-002: "Gradient" is not a visible word on the static pages (internal keys, ids, hashes and image paths stay)', () => {
  for (const p of PAGES) {
    const v = visible(read('../' + p)).replace(/(?:radial|linear)-gradient/g, '').replace(/\/img\/gradient\//g, '/img/x/')
      .replace(/(?:id|href|src|srcset|data-[a-z-]+|aria-controls|class)="[^"]*"/g, '')
    assert.doesNotMatch(v, /gradient/i, p)
  }
  assert.match(HTML, /<title>Karmi Laven — Bracelets &amp; Necklaces · Colour, worn softly<\/title>/)
  assert.equal(core.SF_TITLE.gradient, 'Beaded')
  assert.doesNotMatch(SF, /'The Gradient <em>Edit<\/em>'|See The Gradient Edit|stack it into the gradient/)
})

test('D-001: no "small studio" / "established retailer" claims; the factual line instead', () => {
  for (const p of PAGES) assert.doesNotMatch(read('../' + p), /small (?:uk )?(?:jewellery )?studio|established (?:uk )?retailer/i, p)
  assert.doesNotMatch(SF, /small (?:uk )?(?:jewellery )?studio|established (?:uk )?retailer/i)
  assert.match(read('../contact.html'), /Karmi Laven is from Melbe Home, with shops in Watford and Guildford\./)
  assert.match(HTML, /Karmi Laven is a UK brand with shops in Watford and Guildford, part of <b>Melbe Home UK Ltd<\/b>\./)
  // Komuta follow-up: no unprovable size/age description ('high-street', 'retailer') in visible text either; the
  // registered office address ('8 Turner Court, High Street, Berkhamsted') is a legal fact and stays
  for (const p of PAGES) {
    const v = visible(read('../' + p)).replace(/<[^>]+>/g, ' ').replace(/8 Turner Court, High Street, Berkhamsted/g, '')
    assert.doesNotMatch(v, /high[- ]street|retailer|established|studio/i, p)
  }
  assert.doesNotMatch(SF, /high[- ]street|retailer|established|studio/i)
  assert.match(HTML, /Part of <b>Melbe Home<\/b><small>A UK brand with shops in Watford and Guildford<\/small>/)
  assert.match(HTML, /14-day returns · A UK brand with shops in Watford and Guildford<\/div>/)
})

// Komuta follow-up (V-01 first-card rule): the longer delivery sentence must not squeeze the sticky button below its
// longest word (a11y.css min-width:44px allowed it: 'Shop Bracelets' overflowed at 64 px) and must not grow the bar over
// the first card's Add button (measured 375/390, Bracelets + Beaded: clearance >= origin/master on every view)
test('sticky bar: the button keeps min-content width on phones; the delivery text is not shortened', () => {
  assert.match(HTML, /@media\(max-width:840px\)\{\.stickybar \.sbtn\{min-width:min-content\} \.stickybar\{padding-top:6px; padding-bottom:calc\(6px \+ env\(safe-area-inset-bottom\)\)\} \.stickybar \.sp b\{font-size:18px; line-height:1\}\}/)
  // K&D #101: the 10+ condition beside the deal price >= 14 px (R1'/R6'); the delivery line may stay 12 px
  assert.match(HTML, /\.stickybar \.sp\{font-size:14px; color:var\(--ink\); line-height:1\.2\}/)
  assert.match(HTML, /\.stickybar \.sp \.dl\{display:block; font-size:12px;/)
  assert.doesNotMatch(HTML, /\.stickybar \.sbtn\{flex:0 0 auto/)
  assert.match(HTML, /<span class="dl" data-kl="fee1">\+ £3\.99 UK delivery, free on orders of £30 or more<\/span><\/div>\n  <button class="sbtn" id="stickyBtn"/)
})

// K&D #101 (6): first load at 375x812 / 390x844: the phone cookie banner ends below the first card's Add button and stays
// < 15% of the viewport (measured 103 px / 12.7% at 375, 88 px / 10.4% at 390; was 131 px, 16.1% / 15.5%). Reject and
// Accept: same size; the bottom-right help corner stays clear (buttons left, no 84 px right padding that wrapped the text)
test('cookie banner on phones: compact, equal buttons on the left, the notice keeps what / why / nothing before Accept', () => {
  assert.match(HTML, /html #cookie-banner\{ padding:5px 12px; gap:4px 8px; line-height:1\.25 \}/)
  assert.match(HTML, /html #cookie-banner \.cb-btns\{ justify-content:flex-start \}/)
  assert.match(HTML, /html #cookie-banner \.cb-btn\{ min-width:96px \}/)
  assert.match(HTML, /We use cookies \(Meta Pixel and Google Analytics\) to measure visits and purchases\. Nothing is loaded until you click Accept\. <a href="\/privacy\.html">Learn more<\/a>/)
  assert.match(HTML, /<button class="cb-btn" onclick="cookieChoice\(false\)">Reject<\/button>\s*<button class="cb-btn accept" onclick="cookieChoice\(true\)">Accept<\/button>/)
})

// K&D #101 (7): the product view's close button stays on screen while the view scrolls on phones (pinned top-right)
test('modal close button is pinned inside the scrolling product view on phones', () => {
  assert.match(HTML, /\.modal \.mclose\{position:sticky; top:6px; align-self:flex-end; margin:-20px -16px -24px 0; z-index:4; background:var\(--paper\); border-radius:50%\}/)
  assert.match(HTML, /<button class="mclose" onclick="closeModal\(\)" aria-label="Close">/)
})

// K&D #101 (9): the Beaded (Gradient) tab: /img/gradient/*.jpg are renders (19_live_gradient_audit), /img/tone/*.svg colour
// tiles. Live 26 Nov the tab sells 8: 1268 (render, referee-passed) + 7 colour tiles. Every render is labelled on every surface.
test('Beaded tab: every Gradient render carries the "AI-styled image" label (grid card, product view, hero); tiles do not', () => {
  assert.match(HTML, /function klAiImg\(d\)\{ return !!d&&typeof d\.img==='string'&&d\.img\.indexOf\('\/img\/gradient\/'\)===0; \}/)
  assert.match(HTML, /\$\{klAiImg\(d\)\?'<small class="kl-ai kl-ai-s"'\+\(isNew\?' style="left:auto;right:8px"':''\)\+'>AI-styled image<\/small>':''\}<span class="stk">/)
  assert.match(HTML, /if\(box&&!klModalPhotos\(d\)\.length&&klAiImg\(d\)\)\{ const a=document\.createElement\('small'\); a\.className='kl-ai kl-ai-s'; a\.textContent='AI-styled image'; box\.appendChild\(a\); \}/)
  assert.match(HTML, /<img id="heroImg" src="\/img\/gradient\/1268\.jpg"[^>]*><small class="kl-ai kl-ai-s">AI-styled image<\/small>/)
  const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
  for (const d of DATA) assert.ok(/^\/img\/(gradient|tone)\//.test(d.img), d.barcode + ': image is a render or a colour tile')
  const tile = DATA.filter((d) => d.img.startsWith('/img/tone/')).map((d) => d.barcode).sort()
  assert.deepEqual(tile, ['1266', '1267', '1269', '1271', '1272', '1302', '1310'], 'the 7 renders that failed the referees are colour tiles')
})
