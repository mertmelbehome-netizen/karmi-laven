// SQL tests for db/20261123232000_karmi_families_prep.sql + db/manual/20261123232000_karmi_families_open.sql on an
// in-process Postgres (PGlite). The function bodies under test are the LIVE ones: the repo chain #34 → K-items is
// byte-identical to the live prosrc (CR-normalised md5, checked by the migration's own guard). Ops tables are stubbed
// as in caps-sql.test.mjs; the 42 cards are seeded from tests/fixtures/families-live-2026-11-23.json (live read,
// 23 Nov: category, existing family row / listed / unit_cap, WAT price, stockroom; other listed rows per family).
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { LADDERS, lineGroup, priceUnits, shippingFeeP } from '../api/_pricing.js'

const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const CHAIN = ['20261122230000_karmi_online_caps', '20261123090000_karmi_online_caps_f1_f3',
  '20261123120000_karmi_online_caps_n_items', '20261123150000_karmi_online_caps_k_items'].map((n) => rd(`../db/${n}.sql`))
const PREP = rd('../db/20261123232000_karmi_families_prep.sql')
const PREP_RB = rd('../db/20261123232000_karmi_families_prep_ROLLBACK.sql')
const OPEN = rd('../db/manual/20261123232000_karmi_families_open.sql')
const OPEN_RB = rd('../db/manual/20261123232000_karmi_families_open_ROLLBACK.sql')
const LIVE = JSON.parse(rd('./fixtures/families-live-2026-11-23.json'))
const withGroups = (sql, groups) => sql.replace(/array\['B', 'C', 'A'\]/, `array[${groups.map((g) => `'${g}'`).join(', ')}]`)

const STUB = `
create role anon; create role authenticated; create role service_role;
create table products (id uuid primary key default gen_random_uuid(), category_name text);
create table product_barcodes (barcode text primary key, product_id uuid references products(id));
create table stock_levels (product_id uuid, store_id text, stockroom_count int);
create table online_orders (id uuid primary key default gen_random_uuid(), source text, stripe_session_id text,
  created_at timestamptz not null default now(), items jsonb, store_id text, status text, fulfilment_note text);
create table pos_promotion_products (id bigserial primary key, store_id text, barcode text, list_price numeric,
  received_at timestamptz not null default now());
create table pos_daily_item_sales (store_id text, sale_date date, barcode text, qty numeric);
`
const FAM_CAT = { stretch_charm: 'Stretch Charm Bracelet', hair: 'Hair Clips', necklace_lux_stone: 'Necklace Lux Stone',
  stretch_double: 'Stretch Double Bracelet', diamond: 'Diamond Bracelet' }
const FNS = ['fn_karmi__state(text[])', 'fn_karmi_online_status(text[])', 'fn_karmi_checkout_reserve(uuid,jsonb,integer)']
const BASE_MD5 = ['d5fbac9f42f598025e16cd59e78fbbc7', '39834fbf2c5cd1d3282feeed048802b6', 'fa7bcc4ae4bb989955d162d85f0eca0a']

async function product(db, { category, bc, stockroom = 100, pricePence = null }) {
  const { rows: [{ id }] } = await db.query(`insert into products (category_name) values ($1) returning id`, [category])
  await db.query(`insert into product_barcodes values ($1, $2)`, [bc, id])
  await db.query(`insert into stock_levels values ($1, 'WAT', $2)`, [id, stockroom])
  if (pricePence != null) await db.query(`insert into pos_promotion_products (store_id, barcode, list_price)
    values ('WAT', $1, $2)`, [bc, pricePence / 100])
  return id
}

/** The live chain + the 42 cards as they are in the live DB today (+ the other listed rows per family). */
async function liveLike() {
  const db = new PGlite()
  await db.exec(STUB)
  for (const m of CHAIN) await db.exec(m)
  // test-owned dates (as caps-sql.test.mjs): no Christmas window, period open from yesterday
  await db.exec(`delete from karmi_online_window;
    update karmi_online_caps set period_start = now() - interval '1 day', period_end = null;`)
  for (const c of LIVE.cards) {
    const id = await product(db, { category: c.category, bc: c.bc, stockroom: c.wat_stockroom, pricePence: c.wat_price_pence })
    if (c.family) await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, source, set_by)
      values ($1, $2, $3, $4, 'live', 'live')`, [id, c.family, c.unit_cap, c.listed])
  }
  for (const c of LIVE.photo_coming) {
    const id = await product(db, { category: c.category, bc: c.bc, stockroom: c.wat_stockroom, pricePence: 599 })
    await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, source, set_by)
      values ($1, $2, $3, $4, 'live', 'live')`, [id, c.family, c.unit_cap, c.listed])
  }
  let n = 0
  const fillers = (fam) => LIVE.other_listed[fam] - LIVE.photo_coming.filter((c) => c.family === fam && c.listed).length
  for (const fam of Object.keys(LIVE.other_listed)) for (let i = 0; i < fillers(fam); i++) {
    const id = await product(db, { category: FAM_CAT[fam], bc: `F${++n}`, pricePence: 599 })
    await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, source, set_by)
      values ($1, $2, 10, true, 'live', 'live')`, [id, fam])
  }
  return db
}
const prepared = async () => { const db = await liveLike(); await db.exec(PREP); return db }

async function reserve(db, items, gradient = 0) {
  const { rows: [r] } = await db.query(`select fn_karmi_checkout_reserve($1::uuid, $2::jsonb, $3) as r`,
    [randomUUID(), JSON.stringify(items), gradient])
  return r.r
}
const status = async (db, bcs) => (await db.query(`select fn_karmi_online_status($1::text[]) as r`, [bcs])).rows[0].r
const md5s = async (db) => (await db.query(`select p.oid::regprocedure::text sig, md5(replace(prosrc, chr(13), '')) m
  from pg_proc p where p.oid::regprocedure::text = any ($1) order by array_position($1, p.oid::regprocedure::text)`, [FNS]))
  .rows.map((r) => r.m)
const snapshot = async (db) => ({
  caps: (await db.query(`select family, category_names, display_label, max_products, max_units, enabled
    from karmi_online_caps order by family`)).rows,
  products: (await db.query(`select pb.barcode, k.family, k.unit_cap, k.listed, k.display_name, k.source
    from karmi_online_products k join product_barcodes pb on pb.product_id = k.product_id order by pb.barcode`)).rows,
})
const CARD_BCS = LIVE.cards.map((c) => c.bc)
const PHOTO_COMING = ['2025', '2003', '2007', '2026', '2030', '0562', '1369']
const listedBy = async (db) => Object.fromEntries((await db.query(`select family, count(*) filter (where listed)::int n
  from karmi_online_products group by 1`)).rows.map((r) => [r.family, r.n]))
/** server pricing of a DB-admitted cart exactly as PR #47 /api/checkout does it (lineGroup -> priceUnits -> shipping) */
function charge(r, items) {
  const byBc = Object.fromEntries(r.lines.map((l) => [l.bc, l]))
  const units = items.flatMap((it) => Array.from({ length: it.qty }, () => ({ ladder: false, group: lineGroup(byBc[it.bc], LADDERS) })))
  const amount = priceUnits(units, LADDERS)
  return { amount, ship: shippingFeeP(amount, units.length, LADDERS) }
}

test('fixture: all 42 O&W cards exist live, 6093 is not a card, the live chain matches the base md5s', async () => {
  assert.equal(LIVE.cards.length, 42)
  assert.equal(new Set(CARD_BCS).size, 42)
  assert.ok(!CARD_BCS.includes('6093') && !CARD_BCS.includes('7010'))
  assert.ok(LIVE.cards.every((c) => c.category), 'every card barcode has a product')
  assert.deepEqual(Object.fromEntries(['A', 'B', 'C'].map((g) => [g, LIVE.cards.filter((c) => c.group === g).length])),
    { A: 7, B: 19, C: 16 })
  const db = await liveLike()
  assert.deepEqual(await md5s(db), BASE_MD5)
})

test('prep: rows, groups, listed, caps; every family stays CLOSED; price groups = ladders.json', async () => {
  const db = await prepared()
  const { rows } = await db.query(`select pb.barcode bc, k.family, k.online_group g, k.listed, k.unit_cap, k.source
    from karmi_online_products k join product_barcodes pb on pb.product_id = k.product_id where pb.barcode = any ($1)`, [CARD_BCS])
  assert.equal(rows.length, 42)
  const by = Object.fromEntries(rows.map((r) => [r.bc, r]))
  for (const c of LIVE.cards) {
    assert.equal(by[c.bc].g, c.group, c.bc)
    assert.equal(by[c.bc].listed, true, c.bc)
    if (c.family) assert.deepEqual([by[c.bc].family, by[c.bc].unit_cap], [c.family, c.unit_cap], `${c.bc} keeps its row`)
  }
  const created = rows.filter((r) => r.source.startsWith('families-prep')).map((r) => [r.bc, r.family, r.unit_cap])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  assert.deepEqual(created, [['2000', 'stretch_charm', 5], ['6002', 'stretch_bracelet', 40], ['6008', 'stretch_bracelet', 40],
    ['6009', 'stretch_bracelet', 40], ['6011', 'stretch_bracelet', 40], ['6017', 'stretch_bracelet', 53],
    ['6042', 'stretch_bracelet', 23], ['6058', 'stretch_bracelet', 40], ['6091', 'necklace_lux', 34],
    ['6095', 'necklace_lux', 26], ['7056', 'necklace_lux', 31], ['7058', 'necklace_lux', 55],
    ['80012', 'bangle', 34], ['80043', 'bangle', 15]])
  const caps = Object.fromEntries((await db.query(`select family, max_products, max_units, enabled from karmi_online_caps`))
    .rows.map((r) => [r.family, r]))
  assert.deepEqual(Object.values(caps).filter((c) => c.enabled), [], 'every family stays enabled=false')
  assert.deepEqual(Object.fromEntries(Object.entries(caps).map(([f, c]) => [f, c.max_products])),
    { diamond: 5, hair: 16, necklace_lux_stone: 20, stretch_charm: 30, stretch_double: 14,
      stretch_bracelet: 7, necklace_lux: 4, bangle: 2 })
  // only the 42 cards are listed: listed count per family = its card count (and no cap below it)
  const cardsPer = {}
  for (const c of LIVE.cards) { const f = by[c.bc].family; cardsPer[f] = (cardsPer[f] || 0) + 1 }
  assert.deepEqual(await listedBy(db), cardsPer)
  for (const [f, n] of Object.entries(cardsPer)) assert.ok(caps[f].max_products >= n, f)
  const pc = (await db.query(`select pb.barcode, k.listed from karmi_online_products k join product_barcodes pb
    on pb.product_id = k.product_id where pb.barcode = any ($1)`, [PHOTO_COMING])).rows
  assert.deepEqual(pc.filter((r) => r.listed), [], '"Photo coming" cards are unlisted')
  assert.equal(pc.length, 7)
  // display_name "<name> · <line>" on all 42; K-08 words / % / was never appear
  const dn = Object.fromEntries((await db.query(`select pb.barcode bc, k.display_name d from karmi_online_products k
    join product_barcodes pb on pb.product_id = k.product_id where pb.barcode = any ($1)`, [CARD_BCS])).rows.map((r) => [r.bc, r.d]))
  assert.equal(Object.values(dn).filter(Boolean).length, 42)
  for (const [bc, d] of Object.entries(dn)) {
    assert.match(d, /^[^·]+ · [^·]+$/, bc)
    assert.doesNotMatch(d, /\b(diamond|lux|stone|was)\b|%/i, bc)
    assert.ok(d.length <= 60, bc)
  }
  assert.equal(dn['6009'], 'Peach & Gold · Stretch Bracelet')
  assert.equal(dn['7058'], 'Mint Daisy · Bead Necklace')
  assert.equal(dn['81013'], 'Gold-tone Twin Butterfly · Sparkle Line')
  // undo record: every pre-existing row of the card families, with its previous listed / display_name
  const { rows: [u] } = await db.query(`select count(*)::int n, count(*) filter (where listed_before)::int listed,
    count(*) filter (where display_name_before is not null)::int named from karmi_families_prep_undo`)
  const fillersTotal = Object.keys(LIVE.other_listed).reduce((a, f) =>
    a + LIVE.other_listed[f] - LIVE.photo_coming.filter((c) => c.family === f && c.listed).length, 0)
  const pre = LIVE.cards.filter((c) => c.family).length + LIVE.photo_coming.length + fillersTotal
  assert.deepEqual(u, { n: pre, listed: 60 + LIVE.cards.filter((c) => c.listed).length, named: 0 })
  assert.deepEqual([caps.stretch_bracelet.max_units, caps.necklace_lux.max_units, caps.bangle.max_units], [3450, 1420, 654])
  const groups = (await db.query(`select online_group, single_pence, tier_each_pence, active from karmi_online_groups order by 1`)).rows
  assert.deepEqual(groups, Object.entries(LADDERS.groups).map(([g, v]) => ({ online_group: g, single_pence: v.single,
    tier_each_pence: v.tier_each, active: true })))
  // grants: service_role only
  const { rows: acl } = await db.query(`select has_function_privilege('anon', 'fn_karmi__state(text[])', 'execute') a,
    has_function_privilege('service_role', 'fn_karmi_checkout_reserve(uuid,jsonb,integer)', 'execute') s,
    has_table_privilege('anon', 'karmi_online_groups', 'select') t`)
  assert.deepEqual(acl[0], { a: false, s: true, t: false })
})

test('prep is idempotent (apply twice = same state, same bodies)', async () => {
  const db = await prepared()
  const one = [await snapshot(db), await md5s(db)]
  await db.exec(PREP)
  assert.deepEqual([await snapshot(db), await md5s(db)], one)
  assert.deepEqual(one[1], ['5ba5763a686c2bc5f49e271a637e2c9a', 'c6612bd15f4071697bd4f917c133b8f9', 'e9cb3e4846541a9fe2cdd2a6b9ceeb7b'], 'prep md5s named in the guard')
})

test('families CLOSED: nothing changes — status JSON identical, family line refused, Gradient-only cart unchanged', async () => {
  const db = await liveLike()
  const bcs = [...CARD_BCS, '1001', 'F1']
  const before = { s: await status(db, bcs), fam: await reserve(db, [{ bc: '1472', qty: 1 }]), grad: await reserve(db, [], 3) }
  await db.exec(PREP)
  const after = { s: await status(db, bcs), fam: await reserve(db, [{ bc: '1472', qty: 1 }]), grad: await reserve(db, [], 3) }
  assert.deepEqual(after.s, before.s)
  for (const bc of CARD_BCS) assert.deepEqual(after.s.items[bc], { sellable: 0, stock: after.s.items[bc].stock, price_pence: null }, bc)
  assert.deepEqual([after.fam.ok, after.fam.error, after.fam.items], [false, 'not_available', [{ bc: '1472', requested: 1, available: 0 }]])
  assert.deepEqual(after.fam, before.fam)
  delete before.grad.ref; delete after.grad.ref
  assert.deepEqual(after.grad, before.grad)
  assert.deepEqual(after.grad.lines, [])
  // Gradient prices come from ladders.json group B, untouched by the DB: 1 = 800, 3 = 2400, 10 = 2400
  const g = (n) => priceUnits(Array.from({ length: n }, () => ({ ladder: true })), LADDERS)
  assert.deepEqual([g(1), g(3), g(10)], [800, 2400, 2400])
})

test('after the manual OPEN (B+C+A): priced and unpriced B products both 800 + sellable; mixed 10+ cart = £24.90 + £3.99 delivery (under £30, owner 25 Nov 2026)', async () => {
  const db = await prepared()
  // an unpriced B product (no WAT till price) in an open family, grouped B
  const id = await product(db, { category: 'Stretch Charm Bracelet', bc: '1999', pricePence: null })
  await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, online_group, source, set_by)
    values ($1, 'stretch_charm', 10, true, 'B', 'test', 'test')`, [id])
  assert.equal((await status(db, ['1999'])).items['1999'].sellable, 0, 'still closed before the open')
  await db.exec(OPEN)
  await db.exec(OPEN) // idempotent
  const open = (await db.query(`select family from karmi_online_caps where enabled order by 1`)).rows.map((r) => r.family)
  assert.deepEqual(open, ['bangle', 'diamond', 'hair', 'necklace_lux', 'necklace_lux_stone', 'stretch_bracelet', 'stretch_charm', 'stretch_double'])
  const s = await status(db, ['1472', '1999', '6008', '81004'])
  assert.deepEqual(s.items['1472'], { sellable: 10, stock: 57, price_pence: 800, family: 'stretch_charm', online_group: 'B' }) // till 599 → group 800
  assert.deepEqual(s.items['1999'], { sellable: 10, stock: 97, price_pence: 800, family: 'stretch_charm', online_group: 'B' })
  assert.equal(s.items['6008'].price_pence, 500); assert.equal(s.items['6008'].online_group, 'A')
  assert.equal(s.items['81004'].price_pence, 1300); assert.equal(s.items['81004'].online_group, 'C')

  const cart = [{ bc: '6008', qty: 2 }, { bc: '6011', qty: 2 }, { bc: '1472', qty: 1 }, { bc: '1999', qty: 1 },
    { bc: '1849', qty: 1 }, { bc: '03010013', qty: 1 }, { bc: '81004', qty: 1 }, { bc: '80012', qty: 1 }] // 4A + 3B + 3C
  const r = await reserve(db, cart)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(Object.fromEntries(r.lines.map((l) => [l.bc, [l.online_group, l.price_pence]])), {
    '03010013': ['C', 1300], 1472: ['B', 800], 1849: ['B', 800], 1999: ['B', 800], 6008: ['A', 500], 6011: ['A', 500],
    80012: ['C', 1300], 81004: ['C', 1300] })
  assert.deepEqual(charge(r, cart), { amount: 4 * 150 + 3 * 240 + 3 * 390, ship: 399 })   // £24.90 < £30.00: a 10+ basket under £30 pays
  assert.equal(charge(r, cart).amount, 2490)
  // the checkout line names are the card display_names (Stripe line "{bc} · {name}"): no %, no "was"
  const names = Object.fromEntries(r.lines.map((l) => [l.bc, l.name]))
  assert.equal(names['6008'], 'Blush Daisy · Stretch Bracelet')
  assert.equal(names['03010013'], 'Blue Fish · Hair Claw')
  assert.equal(names['81004'], 'Gold-tone Swan · Sparkle Line')
  for (const l of r.lines) assert.doesNotMatch(`${l.bc} · ${l.name}`, /%|\bwas\b|\b(diamond|lux|stone)\b/i, l.bc)
  // a NON-card product in an opened family is not sold (unlisted by the prep): sellable 0, reserve refused
  const nc = await status(db, ['F1', '2003', '1369'])
  for (const bc of ['F1', '2003', '1369']) assert.deepEqual(nc.items[bc], { sellable: 0, stock: nc.items[bc].stock, price_pence: null }, bc)
  assert.equal((await reserve(db, [{ bc: '2003', qty: 1 }])).ok, false)
  // 1-item carts per group: single price + £3.99 delivery
  for (const [bc, single] of [['6002', 500], ['2000', 800], ['6159', 1300]]) {
    const one = await reserve(db, [{ bc, qty: 1 }])
    assert.equal(one.ok, true, bc)
    assert.deepEqual(charge(one, [{ bc, qty: 1 }]), { amount: single, ship: 399 }, bc)
  }
})

test('open B only: A + bangle-only C families stay closed; hair (B clips + C claws) opens as one family', async () => {
  const db = await prepared()
  await db.exec(withGroups(OPEN, ['B']))
  const open = (await db.query(`select family from karmi_online_caps where enabled order by 1`)).rows.map((r) => r.family)
  assert.deepEqual(open, ['hair', 'necklace_lux', 'stretch_charm'])
  const s = await status(db, ['1472', '6008', '80012', '03010013'])
  assert.equal(s.items['1472'].price_pence, 800)
  assert.deepEqual([s.items['6008'].sellable, s.items['80012'].sellable], [0, 0])
  assert.equal(s.items['03010013'].price_pence, 1300, 'a C claw in the shared hair family sells at C')
  // B-only cart of 10 = 10 x 240
  const cart = [{ bc: '1472', qty: 2 }, { bc: '2023', qty: 2 }, { bc: '1849', qty: 3 }, { bc: '7058', qty: 3 }]
  const r = await reserve(db, cart)
  assert.equal(r.ok, true)
  assert.deepEqual(charge(r, cart), { amount: 2400, ship: 399 })   // 10+ at £24.00 < £30.00 pays delivery
  assert.equal((await reserve(db, [{ bc: '6008', qty: 1 }])).ok, false)
  // unknown group / no listed product → refused, nothing changes
  await assert.rejects(db.exec(withGroups(OPEN, ['Z'])), /unknown or inactive/)
})

test('a product with NO group is still refused without a till price; with one, the DB admits it but M1 code finds no group', async () => {
  const db = await prepared()
  await db.exec(OPEN)
  // a hand-listed hair product with a till price but NO online_group (hair has 12 cards, max_products 16)
  const id = await product(db, { category: 'Hair Clips', bc: 'NG1', pricePence: 599 })
  await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, source, set_by)
    values ($1, 'hair', 10, true, 'test', 'test')`, [id])
  const s = await status(db, ['NG1'])
  assert.deepEqual(s.items.NG1, { sellable: 10, stock: 97, price_pence: 599, family: 'hair' })
  const ok = await reserve(db, [{ bc: 'NG1', qty: 1 }])
  assert.equal(ok.ok, true)
  assert.equal(ok.lines[0].online_group, null)
  assert.equal(lineGroup(ok.lines[0], LADDERS), null, 'hair is not in ladders.json family_groups → /api/checkout answers 503')
  await db.exec(`delete from pos_promotion_products where barcode = 'NG1'`)
  const r = await reserve(db, [{ bc: 'NG1', qty: 1 }])
  assert.deepEqual([r.ok, r.items], [false, [{ bc: 'NG1', requested: 1, available: 0 }]])
  assert.deepEqual((await status(db, ['NG1'])).items.NG1, { sellable: 0, stock: 96, price_pence: null })
})

test('pools mode switch: groups inactive → till price + no_price gate exactly as before', async () => {
  const db = await prepared()
  await db.exec(OPEN)
  await db.exec(`update karmi_online_groups set active = false`)
  const s = await status(db, ['1472'])
  assert.deepEqual(s.items['1472'], { sellable: 10, stock: 57, price_pence: 599, family: 'stretch_charm' })
  await db.exec(`delete from pos_promotion_products where barcode = '1472'`)
  assert.equal((await reserve(db, [{ bc: '1472', qty: 1 }])).ok, false)
})

test('manual close per group, then the prep ROLLBACK restores the live bodies and rows', async () => {
  const db = await liveLike()
  const before = await snapshot(db)
  await db.exec(PREP)
  await db.exec(OPEN)
  await db.exec(withGroups(OPEN_RB, ['A']))
  let open = (await db.query(`select family from karmi_online_caps where enabled order by 1`)).rows.map((r) => r.family)
  assert.ok(!open.includes('stretch_bracelet') && open.includes('stretch_charm'))
  await assert.rejects(db.exec(PREP_RB), /close the families first/)
  await db.exec(withGroups(OPEN_RB, ['B']))
  open = (await db.query(`select family from karmi_online_caps where enabled order by 1`)).rows.map((r) => r.family)
  assert.deepEqual(open, ['bangle', 'diamond', 'necklace_lux_stone', 'stretch_double'], 'closing B also closes hair (C claws)')
  await db.exec(OPEN_RB)
  await db.exec(OPEN_RB) // idempotent
  await db.exec(PREP_RB)
  assert.deepEqual(await md5s(db), BASE_MD5)
  const after = await snapshot(db)
  assert.deepEqual(after.products, before.products)
  assert.deepEqual(after.caps.map(({ family, max_products, max_units, enabled }) => ({ family, max_products, max_units, enabled })),
    before.caps.map(({ family, max_products, max_units, enabled }) => ({ family, max_products, max_units, enabled })))
  assert.equal((await db.query(`select to_regclass('karmi_online_groups') r`)).rows[0].r, null)
  assert.equal((await db.query(`select to_regclass('karmi_families_prep_undo') r`)).rows[0].r, null)
  assert.deepEqual(await listedBy(db), { hair: 16, stretch_charm: 30, necklace_lux_stone: 20, stretch_double: 12, diamond: 0 })
  await db.exec(PREP) // and it can be re-applied after a rollback
})

test('md5 guard: a live body that differs from the base refuses the whole file', async () => {
  const db = await liveLike()
  await db.exec(`create or replace function public.fn_karmi__state(p_barcodes text[])
    returns table(barcode text, product_id uuid, family text, reason text, price_pence integer, line_name text,
                  stock integer, cap_left integer, family_left integer)
    language sql stable security definer set search_path = public, pg_temp as $$ select null::text, null::uuid,
    null::text, 'x'::text, null::int, null::text, 0, 0, 0 $$`)
  await assert.rejects(db.exec(PREP), /differs from the one this file is based on/)
  assert.equal((await db.query(`select to_regclass('karmi_online_groups') r`)).rows[0].r, null)
})

test('only the 42 cards sell: the prep unlists exactly the 60 non-card rows, nothing outside the card families', async () => {
  const db = await liveLike()
  const before = (await db.query(`select product_id, family, listed from karmi_online_products`)).rows
  await db.exec(PREP)
  const after = Object.fromEntries((await db.query(`select product_id, listed from karmi_online_products`)).rows
    .map((r) => [r.product_id, r.listed]))
  const cardIds = new Set((await db.query(`select product_id from product_barcodes where barcode = any ($1)`, [CARD_BCS])).rows
    .map((r) => r.product_id))
  const unlisted = before.filter((r) => r.listed && !after[r.product_id])
  assert.equal(unlisted.length, 60)
  assert.ok(unlisted.every((r) => !cardIds.has(r.product_id)))
  const per = {}
  for (const r of unlisted) per[r.family] = (per[r.family] || 0) + 1
  assert.deepEqual(per, { stretch_charm: 24, hair: 8, necklace_lux_stone: 17, stretch_double: 11 })
  assert.equal(before.filter((r) => !r.listed && after[r.product_id]).length, 10)
  // the Gradient Edit is not a caps family: no caps row, no product row; its holds keep family 'gradient'
  assert.equal((await db.query(`select count(*)::int n from karmi_online_caps where family = 'gradient'`)).rows[0].n, 0)
  await db.exec(PREP) // re-run: the undo record keeps the FIRST run's values
  const { rows: [u] } = await db.query(`select count(*) filter (where listed_before)::int n from karmi_families_prep_undo`)
  assert.equal(u.n, 60 + LIVE.cards.filter((c) => c.listed).length)
})
