// Bangle + Sparkle Line 13 (owner go-ahead 26 Nov 2026: "13 gorsel yayina alinsin"; images as they are, each labelled
// 'AI-styled image'; morning_review/47_bangle_sparkle_final). Data only: the cards stay dormant until the DB lists them
// (karmi_online_products listed + max_products, online_group C), because the page shows a family card only when /api/stock
// prices it (no price = 'hidden' state, never 'Sold out').
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { PRODUCT_ONLY_MAIN, sceneAt } from '../scripts/photo-mix.mjs'
import { FORBIDDEN } from '../scripts/gen-cards.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const CARDS = JSON.parse(read('../data/cards.json')).cards
const SF = read('../js/storefront.js')
const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1]
const core = new Function(`${CORE}; return { sfState, sfSubOf };`)()
const BANGLE = ['80030', '80028', '80047', '80034', '80011', '80016', '80022', '80024']
const SPARKLE = ['81026', '81056', '81049', '81038', '81025']
const WRIST = ['80047', '81056', '81038', '81025', '81026']

test('13 new cards: live Bangle / Sparkle schema, one AI-styled photo each, web-sized, Bracelets tab sub-chips', () => {
  const by = Object.fromEntries(CARDS.map((c) => [c.barcode, c]))
  for (const bc of [...BANGLE, ...SPARKLE]) {
    const c = by[bc], fam = BANGLE.includes(bc) ? 'Bangle' : 'Sparkle Line'
    assert.ok(c, bc)
    assert.deepEqual(Object.keys(c), ['barcode', 'tab', 'family', 'line', 'name', 'swatch', 'photo', 'photo_qc', 'ai_image'], bc)
    assert.equal(c.tab, 'bracelets'); assert.equal(c.family, fam); assert.equal(c.line, fam)
    assert.equal(c.photo, `/img/fam/${bc}.jpg`); assert.equal(c.photo_qc, true); assert.equal(c.ai_image, true)
    assert.match(c.swatch, /^#[0-9a-f]{6}$/)
    assert.ok(statSync(new URL('..' + c.photo, import.meta.url)).size <= 150 * 1024, bc)
    assert.equal(core.sfSubOf('bracelets', c.line), fam === 'Bangle' ? 'bangle' : 'sparkle', bc)
    assert.doesNotMatch(c.name, FORBIDDEN, bc)
    assert.doesNotMatch(c.name, /crystal|\blux\b|diamond|\bstone\b|designed|hand-strung|best|finest|premium|bangle bracelet/i, bc)
    assert.equal(sceneAt(c, 0), WRIST.includes(bc) ? 'wrist' : 'plain', bc + ' photo-mix scene')
  }
  const names = CARDS.map((c) => c.name).filter((n) => !/^(Charm|Sparkle|Rough-Cut Look|White|Brown)$/.test(n))   // ring style labels + older repeats
  for (const bc of [...BANGLE, ...SPARKLE]) assert.equal(names.filter((n) => n === by[bc].name).length, 1, 'unique name ' + by[bc].name)
  for (const bc of BANGLE.concat(SPARKLE).filter((b) => !WRIST.includes(b))) assert.ok(PRODUCT_ONLY_MAIN.includes(bc), bc)
  for (const bc of WRIST) assert.ok(!PRODUCT_ONLY_MAIN.includes(bc), bc)
})

test('dormant until listed: no price from /api/stock = hidden (not sold out); priced + sellable = on sale', () => {
  assert.equal(core.sfState({ priceP: null, photoOk: true, sellable: 0, stock: 0, badge: false }), 'hidden')
  assert.equal(core.sfState({ priceP: null, photoOk: true, sellable: 0, stock: 30, badge: false }), 'hidden')
  assert.ok(['sellable', 'single'].includes(core.sfState({ priceP: 1300, photoOk: true, sellable: 5, stock: 5, badge: false })))
})
