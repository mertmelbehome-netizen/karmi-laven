// Product gallery (owner decision 24 Nov 2026, via Komuta + Online & Wholesale; shipped DORMANT).
// Spec: orchestrator/projects/2026-11-23_karmi-relaunch/morning_review/43_gallery (SPEC_AND_PILOT.md, SITE_AUDIT.md).
//   cards.json: optional photos [{src, type, alt, qc, ai}]; photos[0].src === photo; photo / photo_qc unchanged.
//   Family card with 2+ QC-passed photos = scroll-snap carousel (js/storefront.js sfGallery, KL-SF-CORE, pure);
//   Gradient modal with 2+ photos (DATA[].photos) = track + thumbs (desktop) / dots (<=620px) + tap to zoom.
//   One photo (or none) = byte-identical markup: pinned against the pre-gallery render (tests/fixtures/famcard-golden.json,
//   generated from origin/master f7a702f sfFamCard BEFORE this change: 75 cards x 5 states x 4 option sets, sha256).
// In this PR no card has a 2nd photo, so the live site does not change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const HTML = read('../index.html').replace(/\r\n/g, '\n')   // autocrlf checkouts
const SF = read('../js/storefront.js').replace(/\r\n/g, '\n')
const NOCAR = /data-kl-car>|kl-slide|kl-dot/   // a carousel (data-kl-card is every card's own hook)
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { sfFamCard, sfPhotos, sfGallery };`)()
const CARDS = JSON.parse(read('../data/cards.json')).cards
const GOLD = JSON.parse(read('./fixtures/famcard-golden.json'))
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 24)
const PHOTO_CAP = 150 * 1024   // same web-size cap as the hero photos (tests/families-m1)
const O = { line: { p: 800, html: '£8.00' }, badge: null, ship: '+ £1.49 UK delivery', full: false, dis: false, why: '' }
const count = (s, re) => (s.match(re) || []).length

/** data rules for one card's photos[]; [] = ok */
function photoErrors(c) {
  const e = []
  if (c.photos == null) return e
  if (!Array.isArray(c.photos)) return ['photos is not a list']
  if (c.photos.length && c.photos[0].src !== c.photo) e.push('photos[0].src !== photo')
  if (c.photos.length && !c.photo_qc) e.push('photos without a QC hero photo')
  c.photos.forEach((p, i) => {
    if (!p || typeof p.src !== 'string' || !p.src.startsWith('/img/')) { e.push(`photos[${i}] src`); return }
    if (typeof p.alt !== 'string' || !p.alt.trim()) e.push(`photos[${i}] alt`)
    if (typeof p.ai !== 'boolean') e.push(`photos[${i}] ai label flag`)
    if (typeof p.qc !== 'boolean') e.push(`photos[${i}] qc flag`)
    if (p.qc === true) {
      const u = new URL('..' + p.src, import.meta.url)
      if (!existsSync(u)) e.push(`photos[${i}] missing file ${p.src}`)
      else if (statSync(u).size > PHOTO_CAP) e.push(`photos[${i}] over ${PHOTO_CAP} bytes ${p.src}`)
    }
  })
  return e
}
const gal = (over = {}) => ({ barcode: 'G1', name: 'Rose', line: 'Beaded Bracelet', swatch: '#e7b', photo: '/img/fam/2000.jpg', photo_qc: true, ai_image: true,
  photos: [
    { src: '/img/fam/2000.jpg', type: 'hero', alt: 'Rose beaded bracelet, product only', qc: true, ai: true },
    { src: '/img/fam/2023.jpg', type: 'detail', alt: 'Rose bracelet, bead close-up', qc: true, ai: false },
    { src: '/img/fam/1477.jpg', type: 'wrist', alt: 'Rose bracelet on the wrist', qc: true, ai: true },
  ], ...over })

// ---------- 1. one photo = byte-identical to today ----------

test('single photo / no photos: sfFamCard output is byte-identical to the pre-gallery render (75 cards x 5 states x 4 options)', () => {
  assert.equal(Object.keys(GOLD.sha256_24).length, GOLD.inputs.length * GOLD.states.length * GOLD.opts.length)
  assert.ok(GOLD.inputs.length >= 70)
  let n = 0
  for (const c of GOLD.inputs) for (const st of GOLD.states) GOLD.opts.forEach((o, i) => {
    const k = c.barcode + '|' + st + '|' + i, want = GOLD.sha256_24[k]
    assert.equal(sha(core.sfFamCard(c, st, o)), want, 'as today ' + k)
    // photos[] that is empty, or holds only the hero photo, changes nothing
    assert.equal(sha(core.sfFamCard({ ...c, photos: [] }, st, o)), want, 'photos [] ' + k)
    if (c.photo) assert.equal(sha(core.sfFamCard({ ...c, photos: [{ src: c.photo, type: 'hero', alt: 'x', qc: true, ai: !!c.ai_image }] }, st, o)), want, 'one photo ' + k)
    n++
  })
  assert.equal(n, 1500)
})

test('live data: every card renders as a one-photo card (dormant: photos[] empty or missing everywhere)', () => {
  for (const c of CARDS) {
    assert.ok(c.photos == null || (Array.isArray(c.photos) && c.photos.length === 0), 'no gallery data yet ' + c.barcode)
    for (const st of ['sellable', 'single', 'cap', 'soldout', 'photo']) assert.doesNotMatch(core.sfFamCard(c, st, O), NOCAR, c.barcode + ' ' + st)
  }
  // Gradient DATA (inline in index.html) has no photos[] either
  assert.doesNotMatch(HTML.match(/const DATA=\[[^\n]*/)[0], /"photos"/)
})

// ---------- 2. multi-photo card ----------

test('multi-photo card: carousel roles, "n of N" slides, photo 1 eager / 2+ lazy, width+height on every img, dot buttons', () => {
  const h = core.sfFamCard(gal(), 'single', O)
  assert.match(h, /<div class="imgwrap kl-car" role="region" aria-roledescription="carousel" aria-label="Rose photos" tabindex="0" data-kl-car>/)
  assert.equal(count(h, /class="kl-slide" role="group" aria-roledescription="slide"/g), 3)
  for (const n of [1, 2, 3]) assert.match(h, new RegExp(`aria-label="${n} of 3"`))
  const imgs = h.match(/<img [^>]*>/g)
  assert.equal(imgs.length, 3)
  for (const im of imgs) assert.match(im, /width="400" height="500"/)
  assert.match(imgs[0], /loading="eager"/); assert.doesNotMatch(imgs[0], /lazy/)
  for (const im of imgs.slice(1)) assert.match(im, /loading="lazy" decoding="async"/)
  assert.deepEqual(imgs.map((im) => im.match(/alt="([^"]*)"/)[1]), ['Rose beaded bracelet, product only', 'Rose bracelet, bead close-up', 'Rose bracelet on the wrist'])
  assert.equal(count(h, /<button type="button" class="kl-dot" data-kl-dot="\d"/g), 3)
  for (const n of [1, 2, 3]) assert.match(h, new RegExp(`aria-label="Photo ${n} of 3"`))
  assert.equal(count(h, /aria-current="true"/g), 1)
  // card body, price and add button stay as on the one-photo card
  const one = core.sfFamCard({ ...gal(), photos: undefined }, 'single', O)
  assert.equal(h.slice(h.indexOf('<div class="cbody">')), one.slice(one.indexOf('<div class="cbody">')).replace('<small class="kl-ai">AI-styled image</small>', ''))
  assert.match(h, /data-kl-add data-bc="G1"/)
})

test('photos[0].src must equal photo; only qc:true entries show; no hero QC / colour-tile state = no gallery', () => {
  assert.equal(core.sfPhotos(gal()).length, 3)
  assert.equal(core.sfPhotos(gal()).map((p) => p.src)[0], gal().photo)
  assert.deepEqual(core.sfPhotos(gal({ photo: '/img/fam/2023.jpg' })), [], 'photos[0] is not the card photo')
  assert.deepEqual(core.sfPhotos(gal({ photo_qc: false })), [], 'hero photo not QC-passed')
  assert.deepEqual(core.sfPhotos(gal({ photo: null })), [])
  const ps = gal().photos.map((p, i) => (i === 1 ? { ...p, qc: false } : p))
  assert.deepEqual(core.sfPhotos(gal({ photos: ps })).map((p) => p.src), ['/img/fam/2000.jpg', '/img/fam/1477.jpg'], 'unchecked photo dropped')
  assert.deepEqual(core.sfPhotos(gal({ photos: [gal().photos[0], { ...gal().photos[1], qc: false }] })), [], 'one QC photo left = no gallery')
  assert.doesNotMatch(core.sfFamCard(gal(), 'photo', O), NOCAR, 'colour-tile state never shows photos')
  for (const st of ['sellable', 'cap', 'soldout']) assert.match(core.sfFamCard(gal(), st, O), NOCAR, st)
})

test('AI label per photo: one "AI-styled image" per AI photo, none on a real photo, no card-level label on a carousel', () => {
  const h = core.sfFamCard(gal(), 'single', O)
  const slides = h.split('<div class="kl-slide"').slice(1)
  assert.deepEqual(slides.map((s) => /<small class="kl-ai kl-ai-s">AI-styled image<\/small>/.test(s)), [true, false, true])
  assert.doesNotMatch(h, /<small class="kl-ai">AI-styled image<\/small>/)
  // ai flag missing: photo 1 follows the card's ai_image, later photos are labelled (never an unlabelled render)
  const noflag = gal({ ai_image: false, photos: gal().photos.map(({ ai, ...p }) => p) })
  assert.deepEqual(core.sfFamCard(noflag, 'single', O).split('<div class="kl-slide"').slice(1).map((s) => /AI-styled image/.test(s)), [false, true, true])
})

// ---------- 3. data rules ----------

test('cards.json photos[]: photos[0].src == photo, alt + ai + qc per entry, every qc file exists and is web-sized', () => {
  for (const c of CARDS) assert.deepEqual(photoErrors(c), [], c.barcode)
  // the rules catch bad data (the live file has none yet)
  assert.deepEqual(photoErrors(gal()), [])
  assert.ok(photoErrors(gal({ photo: '/img/fam/2023.jpg' })).includes('photos[0].src !== photo'))
  assert.ok(photoErrors(gal({ photos: [...gal().photos, { src: '/img/fam/9999_2.jpg', alt: 'x', qc: true, ai: true }] })).some((e) => /missing file/.test(e)))
  assert.ok(photoErrors(gal({ photos: [gal().photos[0], { src: '/img/fam/2023.jpg', alt: '', qc: true }] })).some((e) => /alt|ai label/.test(e)))
  assert.ok(photoErrors(gal({ photos: [{ ...gal().photos[0] }], photo_qc: false })).includes('photos without a QC hero photo'))
})

test('hair and rings: no photos, so no gallery in any state (no gallery image before 2-referee QC)', () => {
  const hr = CARDS.filter((c) => c.tab === 'hair' || c.tab === 'rings')
  assert.ok(hr.filter((c) => c.tab === 'hair').length >= 12 && hr.filter((c) => c.tab === 'rings').length >= 1)
  for (const c of hr) {
    assert.ok(!c.photos || c.photos.length === 0, 'no gallery photos ' + c.barcode)
    assert.deepEqual(core.sfPhotos(c), [])
    for (const st of ['sellable', 'single', 'cap', 'soldout', 'photo']) assert.doesNotMatch(core.sfFamCard(c, st, O), NOCAR, c.barcode + ' ' + st)
    // a gallery list on a hair/ring card without its QC hero photo still renders nothing
    assert.deepEqual(core.sfPhotos({ ...c, photos: gal().photos }), [], c.barcode)
  }
})

// ---------- 4. Gradient modal + page wiring ----------

test('modal: #mImg and the openModal(bc) card text unchanged (index.html parses them); gallery only with 2+ QC photos', () => {
  assert.equal(count(HTML, /<div class="mimg"><img id="mImg" alt="product"><\/div>/g), 1, 'static modal markup as before')
  assert.match(HTML, /<div class="imgwrap" onclick="openModal\('\$\{d\.barcode\}'\)">/)
  assert.match(HTML, /iw\.getAttribute\('onclick'\)\|\|''\)\.match\(\/'\(\[\^'\]\+\)'\/\)/, 'm1ApplyPage barcode parse')
  assert.match(HTML, /iw0\.getAttribute\('onclick'\)\|\|''\)\.match\(\/'\(\[\^'\]\+\)'\/\)/, 'applyAll barcode parse')
  assert.match(HTML, /mi\.src=d\.img\|\|''; mi\.alt=imgAlt\(d\); \}\n  klModalGallery\(d\);/)
  const klModalPhotos = new Function(HTML.match(/function klModalPhotos\(d\)\{[^\n]*\}/)[0] + '; return klModalPhotos;')()
  const P = [{ src: '/img/gradient/1074.jpg', qc: true }, { src: '/img/gradient/1074_2.jpg', qc: true }]
  assert.deepEqual(klModalPhotos({ img: '/img/gradient/1074.jpg' }), [])
  assert.deepEqual(klModalPhotos({ img: '/img/gradient/1074.jpg', photos: [P[0]] }), [])
  assert.deepEqual(klModalPhotos({ img: '/img/gradient/1074.jpg', photos: P }), P)
  assert.deepEqual(klModalPhotos({ img: '/img/gradient/1111.jpg', photos: P }), [], 'photos[0] must be the card image')
  assert.deepEqual(klModalPhotos({ img: '/img/gradient/1074.jpg', photos: [P[0], { ...P[1], qc: false }] }), [])
  const g = HTML.match(/function klModalGallery\(d\)\{[\s\S]*?\n\}\n/)[0]
  assert.match(g, /if\(!n\) return;/, 'one photo: back to the plain #mImg markup, nothing added')
  for (const re of [/'role','region'/, /'aria-roledescription','carousel'/, /'aria-roledescription','slide'/, /\(i\+1\)\+' of '\+n/, /'Photo '\+\(i\+1\)\+' of '\+n/,
    /im\.loading='lazy'/, /im\.width=1000; im\.height=1250/, /t\.width=56; t\.height=70; t\.loading='lazy'/, /kl-thumbs/, /kl-dots/, /tr\.scrollLeft=0/, /AI-styled image/])
    assert.match(g, re)
})

test('CSS + behaviour: 4/5 box, scroll-snap, no hover scale on carousels, thumbs desktop / dots <=620px, tap zoom, reduced motion, arrow keys', () => {
  assert.match(HTML, /\.kl-car\{position:relative; aspect-ratio:4\/5; overflow:hidden\}/)
  assert.match(HTML, /\.kl-track\{display:flex;[^}]*scroll-snap-type:x mandatory/)
  assert.match(HTML, /\.kl-slide\{[^}]*flex:0 0 100%;[^}]*scroll-snap-align:start/)
  assert.match(HTML, /\.card \.imgwrap\.kl-car img, \.card:hover \.imgwrap\.kl-car img\{transform:none; transition:none\}/)
  assert.match(HTML, /@media\(max-width:620px\)\{\.modal \.mimg \.kl-thumbs\{display:none\} \.modal \.mimg \.kl-dots\{display:flex\}\}/)
  assert.match(HTML, /\.kl-mgal \.kl-slide\.zoomed\{touch-action:pinch-zoom;/)
  assert.match(HTML, /\.kl-mgal \.kl-slide\.zoomed img\{transform:scale\(2\)\}/)
  assert.match(HTML, /@media \(prefers-reduced-motion: reduce\)\{\.kl-track\{scroll-behavior:auto\}/)
  assert.match(HTML, /behavior:still\(\)\?'auto':'smooth'/)
  assert.match(HTML, /e\.key!=='ArrowLeft'&&e\.key!=='ArrowRight'/)
  assert.match(HTML, /s\.classList\.toggle\('zoomed'\)/)
})

test('scope: no checkout / cart / price / api change rides on the gallery', () => {
  for (const f of ['checkout', 'stock', 'stripe-webhook']) assert.doesNotMatch(read(`../api/${f}.js`), /photos|kl-car|gallery/i, f)
  const fns = CORE.slice(CORE.indexOf('function sfPhotos('), CORE.indexOf('function sfFamCard('))
  assert.ok(fns.includes('function sfGallery('))
  assert.doesNotMatch(fns, /\b(document|window|navigator|location)\b/, 'gallery helpers in KL-SF-CORE stay pure')
})
