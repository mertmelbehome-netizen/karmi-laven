// Hero price block (families view, 25_hero_price): the big figure is the LOWEST 10+ price among the groups on sale,
// computed from the served ladders table (never a literal), with its condition, the single prices and the delivery line
// in the same block; no 'save', no strike-through, no was-price, no %. The static first-paint text = the table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LADDERS, publicLadders, priceUnits } from '../api/_pricing.js'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
const SFJS = readFileSync(new URL('../js/storefront.js', import.meta.url), 'utf8')
const RAW = JSON.parse(readFileSync(new URL('../ladders.json', import.meta.url), 'utf8'))
const LAYOUT = HTML.match(/\/\*KL-SF-LAYOUT-START\*\/([\s\S]*?)\/\*KL-SF-LAYOUT-END\*\//)[1]
const { sfHeroPrice, sfHeroPriceApply } = new Function(`${LAYOUT}; return { sfHeroPrice, sfHeroPriceApply };`)()
const SERVED = publicLadders(LADDERS)
const BLOCK = HTML.match(/<div class="kl-hp" id="klHeroPrice">([\s\S]*?)<\/div><\/div>\r?\n/)[0]
const clone = (o) => JSON.parse(JSON.stringify(o))
const money = (p) => (p % 100 === 0 ? '£' + p / 100 : '£' + (p / 100).toFixed(2))

test('hero price = the lowest 10+ price of the served table, its condition and the single prices (no literal)', () => {
  for (const t of [SERVED, RAW]) {
    const gs = Object.values(t.groups)
    const h = sfHeroPrice(t)
    assert.equal(h.big, money(Math.min(...gs.map((g) => g.tier_each))))
    assert.equal(h.cond, `when you buy any ${t.cart_qty_tier.from}+ items`)
    assert.equal(h.singles, 'Single pieces ' + [...new Set(gs.map((g) => g.single))].sort((a, b) => a - b).map(money).join(' / '))
    assert.equal(h.from, new Set(gs.map((g) => g.tier_each)).size > 1, "'from' exactly when the 10+ prices differ")
  }
  assert.deepEqual(sfHeroPrice(SERVED), { from: true, big: '£1.50', cond: 'when you buy any 10+ items', singles: 'Single pieces £5 / £8 / £13' })
})

test('change the table -> the hero text changes (price, threshold, groups on sale)', () => {
  const t = clone(SERVED)
  t.groups.A.tier_each = 120; t.groups.C.single = 1500; t.cart_qty_tier.from = 12
  assert.deepEqual(sfHeroPrice(t), { from: true, big: '£1.20', cond: 'when you buy any 12+ items', singles: 'Single pieces £5 / £8 / £15' })
  // only the groups on sale count: Gradient (B) alone -> £2.40, no 'from', one single price
  assert.deepEqual(sfHeroPrice(SERVED, ['B']), { from: false, big: '£2.40', cond: 'when you buy any 10+ items', singles: 'Single piece £8' })
  assert.equal(sfHeroPrice(SERVED, ['B', 'C']).big, '£2.40')
  assert.equal(sfHeroPrice(SERVED, ['B', 'Z']).big, '£2.40', 'an unknown group is ignored')
  // other modes (pools / old live table): no block
  assert.equal(sfHeroPrice({ ...clone(SERVED), mode: 'pools' }), null)
  assert.equal(sfHeroPrice(null), null)
})

test('the headline price is genuinely available: 10 of the cheapest group cost exactly 10 x the big figure', () => {
  const lo = Object.entries(LADDERS.groups).sort((a, b) => a[1].tier_each - b[1].tier_each)[0]
  const units = Array.from({ length: SERVED.cart_qty_tier.from }, () => ({ group: lo[0] }))
  assert.equal(money(priceUnits(units) / units.length), sfHeroPrice(SERVED).big)
})

// re-pinned 24 Nov 2026 on purpose (Komuta, CMA: a 'from' price must be available on what is shown): the hero is PER TAB;
// re-pinned 26 Nov 2026 on purpose (owner: categories first): the first paint is the landing tab = Bracelets (All), whose
// cards span every group ('from £1.50 each when you buy any 10+ items', 'Single pieces £5 / £8 / £13')
test('static first-paint block = sfHeroPrice(ladders.json, every group = Bracelets All) + the delivery sentence (no text change, no layout jump)', () => {
  const h = sfHeroPrice(RAW, Object.keys(RAW.groups))
  assert.deepEqual(h, { from: true, big: '£1.50', cond: 'when you buy any 10+ items', singles: 'Single pieces £5 / £8 / £13' })
  const l1 = (h.from ? '<span class="kl-hp-from">from</span> ' : '') + `<b class="kl-hp-big">${h.big}<small> each</small></b> <span class="kl-hp-cond">${h.cond}</span>`
  assert.ok(BLOCK.includes(`<div class="kl-hp-l1">${l1}</div>`), BLOCK)
  assert.ok(BLOCK.includes(`<div class="kl-hp-single">${h.singles}</div>`), BLOCK)
  const s = RAW.shipping
  const dl = money(s.below_threshold_fee_pence) + ' UK delivery' + (s.free_at_qty && s.free_at_qty.enabled ? ` · free with any ${s.free_at_qty.qty}+ items` : s.free_threshold_pence ? `, free on orders of £${s.free_threshold_pence % 100 ? (s.free_threshold_pence / 100).toFixed(2) : s.free_threshold_pence / 100} or more` : '')
  assert.ok(BLOCK.includes(`<div class="kl-hp-dlv" data-kl="ship">${dl}</div>`), 'delivery line in the block, kept live by applyShipTexts')
  // the block sits in the hero, right after the hero line
  assert.match(HTML, /data-kl-m1="herop">[^\n]*<\/p>\r?\n(?:\s*<!--[\s\S]*?-->\r?\n)?\s*<div class="kl-hp" id="klHeroPrice">/)
})

test('condition, singles and delivery are in the SAME block as the big price; no save / strike-through / was / %', () => {
  for (const c of ['kl-hp-big', 'kl-hp-cond', 'kl-hp-single', 'kl-hp-dlv']) assert.ok(BLOCK.includes(`class="${c}"`), c)
  const txt = BLOCK.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  for (const bad of [/save/i, /\bwas\b/i, /%/, /off\b/i, /instead of/i]) assert.doesNotMatch(txt, bad)
  assert.doesNotMatch(BLOCK, /<(s|del|strike)\b/i)
  const css = CSS.split('\n').filter((l) => /kl-hp/.test(l)).join('\n')
  assert.doesNotMatch(css, /line-through/)
  // the generated texts too, for every table shape the page can get
  for (const t of [SERVED, RAW]) for (const v of Object.values(sfHeroPrice(t))) assert.doesNotMatch(String(v), /save|was|%|off\b/i)
})

test('sfHeroPriceApply writes the same nodes; hidden for a non-M1 table', () => {
  const el = (cls) => ({ className: cls, innerHTML: '', textContent: '' })
  const l1 = el('kl-hp-l1'), s = el('kl-hp-single')
  const b = { hidden: false, querySelector: (q) => (q === '.kl-hp-l1' ? l1 : q === '.kl-hp-single' ? s : null) }
  const doc = { getElementById: (id) => (id === 'klHeroPrice' ? b : null) }
  sfHeroPriceApply(doc, SERVED, ['B'])
  assert.equal(l1.innerHTML, '<b class="kl-hp-big">£2.40<small> each</small></b> <span class="kl-hp-cond">when you buy any 10+ items</span>')
  assert.equal(s.textContent, 'Single piece £8'); assert.equal(b.hidden, false)
  sfHeroPriceApply(doc, SERVED, null)
  assert.match(l1.innerHTML, /^<span class="kl-hp-from">from<\/span> <b class="kl-hp-big">£1\.50/)
  sfHeroPriceApply(doc, { mode: 'pools' }, null); assert.equal(b.hidden, true)
})

test('wiring: M1 page update + storefront renderTabs refresh the block; groups on sale only after the family stock', () => {
  assert.match(HTML, /function m1ApplyPage\(\)\{\r?\n  klHeroPriceApply\(\);/)
  // per tab (24 Nov): the groups of the active tab's cards; unknown yet on a non-Gradient landing (26 Nov: Bracelets) =
  // keep the first-paint text; unknown on the Gradient tab = its group; [] = no block
  assert.match(HTML, /let keys=typeof window\.klTabGroups==='function'\?window\.klTabGroups\(\):null; if\(!keys&&window\.__klSfPre&&document\.documentElement\.getAttribute\('data-kl-tab'\)!=='gradient'\) return; if\(!keys&&t\) keys=\[t\.gradient_group\];/)
  assert.match(SFJS, /window\.klTabGroups = function \(\) \{/)
  assert.equal(sfHeroPrice(SERVED, []), null, 'a tab with no 10+ piece (Rings) shows no 10+ block')
  assert.match(SFJS, /if \(ok && FAM\.length\) window\.__klGroupsKnown = true;/)
  assert.match(SFJS, /window\.klHeroPriceApply\(\)/)
})

test('layout rules (BENCHMARK HP-1/HP-3): big >= 2x condition, condition >= 14 px, singles smaller than the condition', () => {
  const px = (re) => [...CSS.matchAll(re)].map((m) => Number(m[1]))
  const big = px(/\.kl-hp-big\{font-size:(\d+)px/g), cond = px(/\.kl-hp-cond\{font-size:(\d+)px/g), single = px(/\.kl-hp-single\{font-size:(\d+)px/g)
  assert.equal(big.length, 2); assert.equal(cond.length, 2)   // desktop + phone
  big.forEach((b, i) => { assert.ok(b >= 2 * cond[i], `big ${b} vs condition ${cond[i]}`); assert.ok(cond[i] >= 14); assert.ok(single[i] < cond[i] && single[i] >= 13) })
  assert.match(CSS, /\.kl-hp\{display:none\}\r?\nhtml\.kl-v2 \.kl-hp\{display:block/, 'families view only; the old page keeps its own hero price line')
})

test('phone family tabs: one-line hero price (singles line hidden; each card shows its single price + condition) so V-01 holds with the sub-chip row', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../css/storefront.css', import.meta.url), 'utf8')
  const sf = readFileSync(new URL('../js/storefront.js', import.meta.url), 'utf8')
  assert.match(css, /html\.kl-v2\[data-kl-tab\]:not\(\[data-kl-tab="gradient"\]\) \.kl-hp-single\{display:none\}/)
  assert.match(sf, /document\.documentElement\.setAttribute\('data-kl-tab', tab\);/)
})
