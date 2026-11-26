// Gradient Edit display names (26 Nov 2026): 1302 and 1310 both read "Light Champagne" although they are different
// pieces with the same bead shade (#ecdcc0): 1302 = champagne rondelles + pearl-look beads + glossy gold starfish;
// 1310 = champagne rondelles + 2 spotted cone shells + cream starfish (19_live_gradient_audit referee A/B + src photos).
// The colour bar, the bundle builder and the bag all key on color_en, so one name for two pieces meant the shopper
// could not pick (or tell apart in the bag) which one they get. Names on the 8 cards on sale must be unique.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GRADIENT } from '../api/_gradient.js'

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const DATA = JSON.parse(HTML.match(/const DATA=(\[[\s\S]*?\]), PRICE=/)[1])
const ON_SALE = ['1266', '1267', '1268', '1269', '1271', '1272', '1302', '1310']   // live 26 Nov (scripts/dev/serve.mjs GRAD_SELLABLE)

test('1302 / 1310 are told apart by their charm, same shade kept', () => {
  const by = Object.fromEntries(DATA.map((d) => [d.barcode, d]))
  assert.equal(by['1302'].color_en, 'Light Champagne Starfish')
  assert.equal(by['1310'].color_en, 'Light Champagne Shell')
  assert.equal(by['1302'].swatch, '#ecdcc0'); assert.equal(by['1310'].swatch, '#ecdcc0')
  assert.equal(GRADIENT['1302'], 'Light Champagne Starfish'); assert.equal(GRADIENT['1310'], 'Light Champagne Shell')   // Stripe line name
})

test('the 8 Gradient cards on sale have 8 different names (page and server)', () => {
  const names = ON_SALE.map((bc) => DATA.find((d) => d.barcode === bc).color_en)
  assert.equal(new Set(names).size, ON_SALE.length, names.join(', '))
  assert.equal(new Set(ON_SALE.map((bc) => GRADIENT[bc])).size, ON_SALE.length)
})
