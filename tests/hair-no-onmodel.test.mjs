// Owner 23 Nov 2026: "hair claws ve clips on model oturmamis" - the on-model (worn in hair) renders for Hair Clips and
// Hair Claws are withdrawn. No hair card carries a photo until a product-only image passes 2 referees (or a real photo);
// with no sellable hair card the Hair tab is hidden (storefront sfVisibleTabs). Re-adding a hair photo = a new reviewed PR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const CARDS = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards
const HAIR = ['1849', '1850', '1854', '1859', '1863', '1864', '1865', '03010002', '03010009', '03010013', '03010025', '03010035']

test('hair: no on-model render on any hair card, files gone', () => {
  const hair = CARDS.filter((c) => c.tab === 'hair')
  assert.ok(hair.length >= 12)
  for (const c of hair) { assert.equal(c.photo, null, c.barcode); assert.equal(c.photo_qc, false, c.barcode); assert.ok(!c.ai_image, c.barcode) }
  for (const bc of HAIR) assert.equal(existsSync(new URL(`../img/fam/${bc}.jpg`, import.meta.url)), false, bc)
})
