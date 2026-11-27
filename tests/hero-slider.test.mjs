// Hero slider (families view, 27 Nov 2026). Mert: 'Üst şerit çok üstte; kayar galeri tarzı sistemde sayfada hero olmalı';
// 'Instant 70% on all orders with 10+ bu bizim en güçlü reklamımız'. Komuta: photo hero, V-01 (first card on the first
// screen) relaxed; the slide photos change later (WAT shoot): one img line per slide, checked here.
// Slide 1 = the 10+ offer (m1Texts().bar, from the table) + singles + delivery; slides 2-3 = a line/category + a link.
// Auto-advance 6 s with a visible Pause/Play (WCAG 2.2.2), held on hover/focus, stopped by touch / dot, off with
// prefers-reduced-motion. Old page (families off): the slider is not shown, the old top strip stays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { LADDERS, publicLadders } from '../api/_pricing.js'
import { pageFns } from './fixtures/page-snapshot.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html')
const CSS = read('../css/storefront.css')
const CARDS = JSON.parse(read('../data/cards.json')).cards
const HERO = HTML.match(/<section class="kl-hs" id="klHero"[\s\S]*?<\/section>/)[0]
const SLIDES = [...HERO.matchAll(/<div class="kl-slide kl-hs-s(\d)"([^>]*)>([\s\S]*?)\r?\n    <\/div>/g)].map((m) => ({ n: +m[1], attrs: m[2], body: m[3] }))
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

test('three slides, carousel semantics: region + roledescription + label, each slide a labelled group, 3 dots', () => {
  assert.equal(SLIDES.length, 3)
  assert.match(HERO, /^<section class="kl-hs" id="klHero" role="region" aria-roledescription="carousel" aria-label="[^"]+" data-kl-car>/)
  SLIDES.forEach((s, i) => assert.match(s.attrs, new RegExp(`role="group" aria-roledescription="slide" aria-label="${i + 1} of 3"`)))
  const dots = [...HERO.matchAll(/<button type="button" class="kl-dot" data-kl-dot="(\d)" aria-label="Slide (\d) of 3: [^"]+"/g)]
  assert.deepEqual(dots.map((d) => [+d[1], +d[2]]), [[0, 1], [1, 2], [2, 3]])
  assert.match(HERO, /data-kl-dot="0" aria-label="[^"]+" aria-current="true"/)
  // swipe = native scroll-snap on the shared track (index.html .kl-track / .kl-slide), arrow keys = klCar* (data-kl-car)
  assert.match(HERO, /<div class="kl-track"/)
  assert.match(HTML, /\.kl-track\{[^}]*scroll-snap-type:x mandatory/)
  assert.match(HTML, /const car=e\.target&&e\.target\.closest&&e\.target\.closest\('\[data-kl-car\]'\)/)
})

test('slide 1 = the 10+ offer from the table (m1Texts().bar) + singles + delivery on the same slide; no was / save / strike', () => {
  const s1 = SLIDES[0].body
  const T = pageFns(HTML, { ladders: publicLadders(LADDERS) }).m1Texts()
  assert.ok(s1.includes(`<p class="kl-hs-offer" data-kl-m1="bar">${T.bar}</p>`), 'static first paint = m1Texts().bar')
  assert.equal(text(T.bar), '70% off when you buy 10+ items From £1.50 each No code needed. Applied instantly.')
  const t = text(s1)
  for (const must of ['70% off', 'when you buy 10+ items', 'From £1.50 each', 'No code needed. Applied instantly.', 'Single pieces £5 / £8 / £13', '£3.99 UK delivery, free on orders of £30 or more']) assert.ok(t.includes(must), must)
  assert.doesNotMatch(s1, /<(s|del|strike)\b|line-through|\bwas\b|\bsave\b|instead of|\bRRP\b/i)
  assert.doesNotMatch(t, /\bInstant\b/, "Marketing's final text: 'Applied instantly', never 'Instant 70%'")
  // one offer on the page: the old first-screen price lines are gone from the families view
  assert.equal((HTML.match(/id="klHeroPrice"/g) || []).length, 1)
  assert.doesNotMatch(HTML.replace(/<script[\s\S]*?<\/script>/g, ''), /class="kl-hp-(l1|big|cond)"/)
})

test('slides 2-3: line / category name + a category deep link only (no price, no %, no was, no "Gradient")', () => {
  const hashes = []
  for (const s of SLIDES.slice(1)) {
    const t = text(s.body)
    assert.doesNotMatch(t, /£|%|\boff\b|\bwas\b|\bsave\b|gradient/i, t)
    const a = s.body.match(/<a class="kl-hs-a" href="#([a-z-]+)">Shop [^<]+<\/a>/); assert.ok(a, t)
    hashes.push(a[1])
  }
  assert.deepEqual(hashes, ['bracelets-sparkle', 'necklaces'])
  // the links are the storefront's own category hashes (js/storefront.js sfParseHash: '#<tab>-<sub>'; the click handler opens the tab)
  const SF = read('../js/storefront.js')
  assert.match(SF, /\{ k: 'sparkle', label: 'Sparkle Line'/)
  assert.match(SF, /var ph = t\.tagName === 'A' && href && href\.charAt\(0\) === '#' \? sfParseHash\(href\) : null;/)
  assert.doesNotMatch(HERO.replace(/<!--[\s\S]*?-->/g, ''), /gradient(?!\/)/i, "D-002: no 'Gradient' wording on the slides")
})

// JPEG size from the SOF marker
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return null
}

test('photos: one img line per slide (the only place to swap a photo), real width/height (CLS 0), slide 1 eager + high, 2-3 lazy', () => {
  const imgs = SLIDES.map((s) => { const m = s.body.match(/<img src="([^"]+)" width="(\d+)" height="(\d+)" (loading="(eager|lazy)")[^>]*alt="([^"]+)">/); assert.ok(m, s.body); return m })
  imgs.forEach((m, i) => {
    const f = new URL('..' + m[1], import.meta.url); assert.ok(existsSync(f), m[1])
    assert.deepEqual(jpegSize(readFileSync(f)), { w: +m[2], h: +m[3] }, m[1] + ': width/height = the file')
    assert.equal(m[5], i ? 'lazy' : 'eager', m[1])
    assert.equal((HERO.match(new RegExp(m[1].replace(/[./]/g, '\\$&'), 'g')) || []).length, 1, m[1] + ' named once in the slider')
  })
  assert.match(imgs[0][0], /fetchpriority="high"/)
  for (const m of imgs.slice(1)) assert.doesNotMatch(m[0], /fetchpriority/)
  // slide 1 = the live hero render (2-referee PASS, render audit 2); slides 2-3 = live card photos with photo_qc (no new image)
  assert.equal(imgs[0][1], '/img/gradient/1268.jpg')
  for (const m of imgs.slice(1)) {
    const c = CARDS.find((x) => x.photo === m[1]); assert.ok(c, m[1])
    assert.equal(c.photo_qc, true, m[1]); assert.ok(c.photos.find((p) => p.src === m[1] && p.qc === true), m[1])
  }
  assert.doesNotMatch(HERO, /AI-styled|kl-ai/, 'no per-image AI label (footer note, #120)')
})

// WCAG relative luminance / contrast
const lum = (hex) => { const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const over = (rgb, alpha, under) => '#' + rgb.map((v, i) => Math.round(alpha * v + (1 - alpha) * under[i]).toString(16).padStart(2, '0')).join('')

test('text over the photo: AA on the panel even over a black pixel (96% paper), sizes fixed per viewport (CLS 0, <= 45% of 812)', () => {
  const m = CSS.match(/\.kl-hs-panel\{[^}]*background:linear-gradient\(90deg, rgba\(255,254,251,\.96\) 0, rgba\(255,254,251,\.96\) 80%, rgba\(255,254,251,0\) 100%\)\}/)
  assert.ok(m, 'panel: 96% paper over the first 80% of its width')
  const worst = over([255, 254, 251], 0.96, [0, 0, 0])
  assert.ok(ratio('#34302a', worst) >= 7, 'ink ' + ratio('#34302a', worst))
  assert.ok(ratio('#6b6457', worst) >= 4.5, 'muted ' + ratio('#6b6457', worst))
  assert.ok(ratio('#faf7f1', '#34302a') >= 4.5, 'link button')
  // the text stays on the solid part: right padding (% of the slide) >= the fading end of the panel
  // (desktop 54% panel solid to 80%, tablet 62% / 80%, phone 68% / 86%)
  assert.match(CSS, /\.kl-hs-panel\{width:68%;[^}]*background:linear-gradient\(90deg, rgba\(255,254,251,\.96\) 0, rgba\(255,254,251,\.96\) 86%, rgba\(255,254,251,0\) 100%\)\}/)
  for (const [w, pad, solid] of [[54, 13, 0.8], [62, 12, 0.8], [68, 10, 0.86]]) {
    assert.match(CSS, new RegExp(`\\.kl-hs-panel\\{[^}]*width:${w}%;[^}]*padding:\\d+px ${pad}% `))
    assert.ok(pad >= w * (1 - solid) - 0.5, `${w}% panel, ${pad}% padding`)
  }
  assert.match(CSS, /\.kl-hs-offer \.bm-how\{display:block; font-size:15px; color:#6b6457/)
  const hs = [...CSS.matchAll(/\.kl-hs \.kl-track\{height:(\d+)px/g)].map((x) => +x[1])
  assert.deepEqual(hs, [380, 300, 232])   // desktop, tablet, phone
  assert.ok(hs[0] <= 420 && hs[2] <= 0.45 * 812 && hs[2] >= 200 && hs[2] <= 240)
  // Komuta 27 Nov (a): 'No code needed. Applied instantly.' shows on phones too (only the old strip hid it)
  const phone = CSS.match(/@media\(max-width:560px\)\{\r?\n  \/\* phone: edge to edge[\s\S]*?\r?\n\}/)[0]
  assert.doesNotMatch(phone, /bm-how\{[^}]*display:none/)
  assert.doesNotMatch(CSS, /\.kl-hs[^{]*\.bm-how\{[^}]*display:none/)
})

test('families view only: the slider is hidden on the old page; in the families view the old top strip and hero photo are off, the H1 stays (sr-only)', () => {
  assert.match(CSS, /\r?\n\.kl-hs\{display:none\}\r?\nhtml\.kl-v2 \.kl-hs\{display:block;/)
  assert.match(CSS, /\nhtml\.kl-v2 \.m1bar\{display:none\}/)
  assert.match(HTML, /<h1 class="fadein d1">Colour,<br> worn <em>softly<\/em>\.<\/h1>/)
  // the old page keeps its strip exactly (PR #121 text); one offer per view
  assert.match(HTML, /<div class="m1bar" data-kl-m1="bar">[^\n]*<\/div>\r?\n<div class="announce">/)
  // the slider sits under the logo row, before the H1 header; the chips go right under the slider (sfLayout)
  assert.match(HTML, /<\/nav>\r?\n\r?\n<!-- families view hero slider[\s\S]*?-->\r?\n<section class="kl-hs" id="klHero"[\s\S]*?<\/section>\r?\n\r?\n<header class="hero wrap">/)
  assert.match(HTML, /var top = q\('#klHero'\) \|\| q\('nav'\)/)
})

test('announce bar keeps only the delivery line', () => {
  const a = HTML.match(/<div class="announce">([\s\S]*?)<\/div>/)[1]
  assert.equal(text(a), 'Ships within 1–2 business days · £3.99 UK delivery · free on orders of £30 or more')
  assert.doesNotMatch(a, /%|10\+|From £/)
})

// ---------- auto-advance (KL-HS block run as-is on a stub page) ----------
const HS = HTML.match(/\/\*KL-HS-START\*\/([\s\S]*?)\/\*KL-HS-END\*\//)[1]
function rig({ reduce = false, v2 = true } = {}) {
  const ev = (o) => { o.on = {}; o.addEventListener = (t, f) => { (o.on[t] = o.on[t] || []).push(f) }; o.fire = (t, e = {}) => (o.on[t] || []).forEach((f) => f(e)); return o }
  const at = {}, mk = (a) => ({ attrs: a, setAttribute(k, v) { a[k] = String(v) }, getAttribute(k) { return a[k] } })
  const btn = ev(mk({})), tr = ev({ ...mk({}), children: [1, 2, 3], clientWidth: 375, scrollLeft: 0 })
  const car = ev({ querySelector: (s) => (s === '.kl-track' ? tr : s === '[data-kl-hs-play]' ? btn : null), contains: (x) => x === btn || x === tr })
  const timers = [], gone = []
  const win = { matchMedia: (q) => ({ matches: reduce && /reduce/.test(q) }), setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length }, clearTimeout: (id) => gone.push(id),
    klCarGo: (c, i) => { go.push(i); tr.scrollLeft = i * tr.clientWidth } }
  const go = []
  const doc = { hidden: false, getElementById: (id) => (id === 'klHero' ? car : null), documentElement: { classList: { contains: (c) => v2 && c === 'kl-v2' } } }
  const klHeroSlider = new Function(`${HS}; return klHeroSlider;`.replace(/try\{ window\.klHero=[^\n]*\n/, ''))()
  const api = klHeroSlider(win, doc)
  return { api, btn, tr, car, timers, go, win, doc, at }
}

test('auto-advance: every 6 s, wraps 3 -> 1, visible Pause/Play toggles it, aria-live off while it rotates', () => {
  const r = rig()
  assert.equal(r.btn.attrs['aria-label'], 'Pause slides'); assert.equal(r.btn.attrs['data-state'], 'playing'); assert.equal(r.tr.attrs['aria-live'], 'off')
  assert.equal(r.timers.at(-1).ms, 6000)
  r.timers.at(-1).f(); r.timers.at(-1).f(); r.timers.at(-1).f()
  assert.deepEqual(r.go, [1, 2, 0])
  r.btn.fire('click')
  assert.equal(r.btn.attrs['aria-label'], 'Play slides'); assert.equal(r.tr.attrs['aria-live'], 'polite')
  const n = r.go.length; r.api.tick(); assert.equal(r.go.length, n, 'paused: no move')
  r.btn.fire('click'); r.api.tick(); assert.equal(r.go.length, n + 1, 'play again')
  // static markup = paused state (true without JS); the icons swap by data-state
  assert.match(HERO, /<button type="button" class="kl-hs-play" data-kl-hs-play data-state="paused" aria-label="Play slides">/)
  assert.match(CSS, /\.kl-hs-play\[data-state="playing"\] \.i-play, \.kl-hs-play\[data-state="paused"\] \.i-pause\{display:none\}/)
})

test('auto-advance holds on hover / keyboard focus, stops for good on touch or a dot; never with reduced motion or off the families view', () => {
  let r = rig()
  r.car.fire('mouseenter'); r.api.tick(); assert.equal(r.go.length, 0, 'hover holds')
  r.car.fire('mouseleave'); r.api.tick(); assert.equal(r.go.length, 1)
  r.car.fire('focusin', { target: {} }); r.api.tick(); assert.equal(r.go.length, 1, 'focus inside holds')
  r.car.fire('focusout', { relatedTarget: null }); r.api.tick(); assert.equal(r.go.length, 2)
  r.tr.fire('touchstart'); r.api.tick(); assert.equal(r.go.length, 2, 'touch = the visitor took over')
  assert.equal(r.btn.attrs['aria-label'], 'Play slides')
  r = rig(); r.car.fire('click', { target: { closest: (s) => (s === '[data-kl-dot]' ? {} : null) } }); r.api.tick(); assert.equal(r.go.length, 0, 'dot press stops it')
  r = rig({ reduce: true }); r.api.tick(); assert.equal(r.go.length, 0)
  assert.equal(r.btn.attrs['aria-label'], 'Play slides'); assert.equal(r.api.state().stop, true)
  r = rig({ v2: false }); r.api.tick(); assert.equal(r.go.length, 0, 'old page: never moves')
  r = rig(); r.doc.hidden = true; r.api.tick(); assert.equal(r.go.length, 0, 'background tab: never moves')
})
