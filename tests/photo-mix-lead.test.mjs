// PHOTO-MIX RULE v1 trial (D-004, owner principle via Komuta; K&D yes with conditions, 26 Nov 2026).
//   cards.json optional `lead` (index into photos[], default 0): the card shows photos[lead] FIRST, then the rest in their
//   original order; photos[0] stays the main photo in the data. No lead = byte-identical card (tests/product-gallery golden).
//   K&D conditions: the AI label follows the LEAD image's own ai flag; every place that emits the card image switches to
//   the lead together (here: the grid/gift card and the bag thumbnail via BY[].img; Stripe, og:image and JSON-LD carry no
//   card image, pinned below); no size claim on plain-ground renders (data rule in tests/product-gallery).
//   Marketing R21: on a swapped card the wrist shot is slide 2.
// Checker: scripts/photo-mix.mjs (scene per lead image, 2-column phone grid order, neighbour / first-screen rules).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { report, failures, limits, solve, checkSeq, gridOrder, leadIdx, leadScene, OWNER_LEADS, TABS } from '../scripts/photo-mix.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SF = read('../js/storefront.js')
const HTML = read('../index.html')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { sfFamCard, sfPhotos, sfGallery, sfLeadIdx, sfLeadSrc };`)()
const CARDS = JSON.parse(read('../data/cards.json')).cards
const BY = Object.fromEntries(CARDS.map((c) => [c.barcode, c]))
const O = { line: { p: 800, html: '£8.00' }, badge: null, ship: '+ £1.49 UK delivery', full: false, dis: false, why: '' }
const slides = (h) => h.split('<div class="kl-slide"').slice(1)
const src = (s) => s.match(/<img src="([^"]+)"/)[1]
const card = (over = {}) => ({ barcode: 'G1', tab: 'bracelets', name: 'Rose', line: 'Beaded Bracelet', swatch: '#e7b', photo: '/img/fam/2000.jpg', photo_qc: true, ai_image: true,
  photos: [
    { src: '/img/fam/2000.jpg', type: 'main', alt: 'Rose, Beaded Bracelet', qc: true },
    { src: '/img/fam/2000_2.jpg', type: 'gallery', alt: 'Rose, close-up detail', qc: true, ai: true },
    { src: '/img/fam/1477.jpg', type: 'gallery', alt: 'Rose, photo 3', qc: true, ai: false },
  ], ...over })

// ---------- 1. render ----------

test('lead: photos[lead] is slide 1 (eager), then the rest in original order; dots, roles and card body as before', () => {
  const h = core.sfFamCard(card({ lead: 1 }), 'single', O), s = slides(h)
  assert.deepEqual(s.map(src), ['/img/fam/2000_2.jpg', '/img/fam/2000.jpg', '/img/fam/1477.jpg'])
  assert.match(s[0], /loading="eager"/); for (const x of s.slice(1)) assert.match(x, /loading="lazy" decoding="async"/)
  assert.deepEqual(s.map((x) => x.match(/alt="([^"]*)"/)[1]), ['Rose, close-up detail', 'Rose, Beaded Bracelet', 'Rose, photo 3'])
  assert.deepEqual(core.sfFamCard(card({ lead: 2 }), 'single', O).split('<div class="kl-slide"').slice(1).map(src), ['/img/fam/1477.jpg', '/img/fam/2000.jpg', '/img/fam/2000_2.jpg'])
  const plain = core.sfFamCard(card(), 'single', O)
  assert.equal(h.slice(h.indexOf('<div class="kl-dots">')), plain.slice(plain.indexOf('<div class="kl-dots">')), 'dots + body unchanged')
  assert.equal(h.length, plain.length, 'same markup, slides reordered')
})

test('K&D: the AI label follows the LEAD image\'s own ai flag; the main photo keeps its ai_image label in slide 2', () => {
  const ai = (c) => slides(core.sfFamCard(c, 'single', O)).map((x) => /<small class="kl-ai kl-ai-s">AI-styled image<\/small>/.test(x))
  assert.deepEqual(ai(card({ lead: 1 })), [true, true, false], 'AI close-up leads: labelled; AI main in slide 2: labelled')
  assert.deepEqual(ai(card({ lead: 2 })), [false, true, true], 'real photo leads: no label; main (ai_image) still labelled')
  assert.deepEqual(ai(card({ lead: 2, ai_image: false })), [false, false, true], 'real main photo in slide 2: no label')
  const noflag = card({ lead: 1, photos: card().photos.map((p, i) => (i === 1 ? { ...p, ai: undefined } : p)) })
  assert.deepEqual(ai(noflag), [true, true, false], 'lead without ai flag = labelled (never an unlabelled render)')
  assert.doesNotMatch(core.sfFamCard(card({ lead: 1 }), 'single', O), /<small class="kl-ai">AI-styled image<\/small>/, 'no card-level label on a carousel')
})

test('no / invalid lead = byte-identical card on every live card and state (lead 0, out of range, not qc, non-integer, no gallery)', () => {
  for (const c of CARDS) {
    const { lead, ...base } = c
    for (const st of ['sellable', 'single', 'cap', 'soldout', 'photo']) {
      const want = core.sfFamCard(base, st, O)
      for (const bad of [0, -1, 1.5, '1', 99, null]) assert.equal(core.sfFamCard({ ...base, lead: bad }, st, O), want, `${c.barcode} ${st} lead ${bad}`)
      if (base.photos && base.photos.length > 1) {
        const nq = base.photos.map((p, i) => (i === 1 ? { ...p, qc: false } : p))
        assert.equal(core.sfFamCard({ ...base, photos: nq, lead: 1 }, st, O), core.sfFamCard({ ...base, photos: nq }, st, O), `${c.barcode} ${st} lead on a non-QC photo`)
      }
    }
  }
  assert.equal(core.sfLeadIdx(card({ lead: 1, photo: '/img/fam/x.jpg' })), 0, 'photos[0] is not the main photo')
  assert.equal(core.sfLeadIdx(card({ lead: 1, photo_qc: false })), 0)
  assert.equal(core.sfLeadIdx({ ...card(), lead: 1, photos: [card().photos[1]] }), 0)
})

test('colour-tile state never shows the lead; the "photo" state stays a tile', () => {
  assert.doesNotMatch(core.sfFamCard(card({ lead: 1 }), 'photo', O), /<img /)
})

// ---------- 2. image identity: everything that emits the card image switches together ----------

test('image identity: sfLeadSrc = lead src (else photo); the bag thumbnail (BY[].img) uses it; nothing else emits a card image', () => {
  assert.equal(core.sfLeadSrc(card({ lead: 1 })), '/img/fam/2000_2.jpg')
  assert.equal(core.sfLeadSrc(card()), '/img/fam/2000.jpg')
  assert.equal(core.sfLeadSrc(card({ lead: 5 })), '/img/fam/2000.jpg')
  assert.equal(core.sfLeadSrc({ ...card(), photo: null, photo_qc: false, lead: 1 }), null)
  for (const c of CARDS) assert.equal(core.sfLeadSrc(c), c.lead ? c.photos[c.lead].src : c.photo, c.barcode)
  for (const c of CARDS.filter((x) => x.lead)) assert.equal(src(slides(core.sfFamCard(c, 'single', O))[0]), core.sfLeadSrc(c), 'card slide 1 = lead ' + c.barcode)
  assert.match(SF, /img: sfLeadSrc\(c\) \|\| '', family: true \}/, 'BY[].img (bag line thumbnail) = lead image')
  assert.doesNotMatch(SF.replace(/function sfLeadSrc[\s\S]*?\n  \}/, ''), /img: c\.photo/, 'no other family image path left on photos[0]')
  // Stripe line items carry no product image (name + price only); the webhook / e-mails emit no card image
  const CO = read('../api/checkout.js'), WH = read('../api/stripe-webhook.js')
  const pd = CO.match(/product_data: \{[^\n]*/)
  assert.ok(pd, 'Stripe line item product_data found'); assert.doesNotMatch(pd[0], /image/i, 'no product image on Stripe')
  for (const [f, t] of [['checkout', CO], ['stripe-webhook', WH]]) assert.doesNotMatch(t, /\bimages?\s*:|img\/fam|\.photo\b/, f)
  // og:image / twitter:image = the brand share image, JSON-LD (ProductCollection) has no image: not card images
  assert.match(HTML, /<meta property="og:image" content="https:\/\/www\.karmilaven\.com\/og-image\.jpg">/)
  assert.match(HTML, /<meta name="twitter:image" content="https:\/\/www\.karmilaven\.com\/og-image\.jpg">/)
  for (const ld of HTML.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)) assert.doesNotMatch(ld, /"image"/)
})

// ---------- 3. shipped data: the v1 trial assignment ----------

test('owner screenshot cards: 81004 / 81006 / 81013 lead with the close-up; 81009 (one photo) unchanged, no lead, no render', () => {
  for (const bc of OWNER_LEADS) {
    assert.equal(BY[bc].lead, 1, bc); assert.match(BY[bc].photos[1].alt, /close-up/, bc)
    const s = slides(core.sfFamCard(BY[bc], 'single', O))
    assert.deepEqual(s.map(src), [BY[bc].photos[1].src, BY[bc].photo], bc + ': close-up first, wrist shot slide 2 (R21)')
  }
  assert.equal(BY['81009'].lead, undefined); assert.ok(!BY['81009'].photos)
  assert.doesNotMatch(core.sfFamCard(BY['81009'], 'single', O), /kl-slide/)
})

test('every lead is a close-up of a KEEP20 card (index 1), on an AI main photo (rule c: a real photo never loses the lead)', () => {
  const leads = CARDS.filter((c) => c.lead !== undefined)
  assert.ok(leads.length >= 3)
  for (const c of leads) {
    assert.equal(c.lead, 1, c.barcode); assert.equal(leadIdx(c), 1, c.barcode)
    assert.equal(c.ai_image, true, c.barcode); assert.equal(leadScene(c), 'plain', c.barcode)
    assert.ok(['bracelets', 'necklaces'].includes(c.tab), c.barcode)
  }
})

test('checker on the shipped data: no fixable neighbouring worn leads, first screen >= 60 % where a close-up exists, every swap needed', () => {
  for (const t of TABS) {
    const rep = report(CARDS, t)
    assert.deepEqual(failures(rep), [], t)
    for (const p of rep.pairs) assert.equal(p.fixable, false, `${t}: ${p.a}+${p.b}`)
  }
  // data limits are known and listed (no close-up on either card; the v1 trial makes no new render)
  assert.deepEqual(report(CARDS, 'bracelets').pairs.map((p) => p.a + '+' + p.b), ['6009+6017'])
  assert.deepEqual(report(CARDS, 'necklaces').pairs.map((p) => p.a + '+' + p.b), ['7056+6091'])
  assert.ok(report(CARDS, 'bracelets').firstShare >= 0.6)
})

test('shipped leads = the solver\'s minimum swap set (owner cards forced)', () => {
  for (const t of TABS) {
    const want = solve(CARDS, t, OWNER_LEADS).lead
    const got = Object.fromEntries(CARDS.filter((c) => c.tab === t && c.lead).map((c) => [c.barcode, c.lead]))
    assert.deepEqual(got, want, t)
  }
})

test('the checker fails on two neighbouring wrist leads, a thin first screen, and an unneeded swap', () => {
  const W = (bc, extra = {}) => ({ barcode: bc, tab: 'bracelets', name: bc, line: 'L', photo: `/img/fam/${bc}.jpg`, photo_qc: true, ai_image: true,
    photos: [{ src: `/img/fam/${bc}.jpg`, qc: true }, { src: `/img/fam/${bc}_2.jpg`, alt: 'x, close-up detail', qc: true, ai: true }], ...extra })
  const P = (bc) => ({ ...W(bc), photos: undefined })   // wrist main, no close-up
  // two wrist leads side by side, one of them could swap -> fail
  let f = failures(report([W('1'), W('2'), P('3'), { ...W('4'), lead: 1 }], 'bracelets'))
  assert.ok(f.some((x) => /neighbouring worn leads 1 \(pos 0\) \+ 2 \(pos 1\)/.test(x)), f.join('\n'))
  // the same pair without any close-up = data limit, not a failure
  const lim = report([P('1'), P('2')], 'bracelets')
  assert.ok(!failures(lim).some((x) => /neighbouring/.test(x))); assert.ok(limits(lim).some((x) => /neither card has a close-up/.test(x)))
  // same column, next row (2-column grid) is a neighbour too
  assert.deepEqual(checkSeq(['wrist', 'plain', 'wrist', 'plain']).pairs, [[0, 2]])
  assert.deepEqual(checkSeq(['plain', 'wrist', 'wrist', 'plain']).pairs, [], 'diagonal (end of row -> start of next) is not a neighbour in v1')
  // a swap nobody needs (no worn neighbour either way, first screen already fine) fails
  f = failures(report([{ ...W('1'), lead: 1 }, P('2', {}), { ...W('3'), lead: 1 }, { ...W('4'), lead: 1 }, { ...W('5'), lead: 1 }], 'bracelets'))
  assert.ok(f.some((x) => /does not need to/.test(x)), f.join('\n'))
  // grid order: photo cards first, sellable tiles, then 'Photo coming' tiles; data order inside each
  const order = gridOrder([{ barcode: 't', tab: 'bracelets', photo: null }, { barcode: 's', tab: 'bracelets', photo: null, tile_sellable: true }, W('p')], 'bracelets')
  assert.deepEqual(order.map((c) => c.barcode), ['p', 's', 't'])
})

test('label: exactly one "AI-styled image" per shown image, inside the image area (single photo, carousel, lead); none in the card body', () => {
  for (const c of CARDS.filter((x) => x.photo && x.photo_qc && x.ai_image)) {
    const h = core.sfFamCard(c, 'single', O)
    assert.doesNotMatch(h.slice(h.indexOf('<div class="cbody">')), /AI-styled image/, c.barcode + ' no body label')
    const s = slides(h)
    if (!s.length) { assert.equal((h.match(/<small class="kl-ai kl-ai-s">AI-styled image<\/small><\/div>/g) || []).length, 1, c.barcode + ' single photo: one overlay label'); continue }
    for (const x of s) assert.equal((x.match(/AI-styled image/g) || []).length, 1, c.barcode + ' one label per slide (AI main + AI close-up)')
    if (c.lead) assert.match(s[0], /AI-styled image/, c.barcode + ' lead close-up (ai true) labelled')
  }
})
