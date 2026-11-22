// SQL tests for db/20261122230000_karmi_online_caps.sql on an in-process Postgres (PGlite, dev dependency only).
// The ops tables the migration reads are stubbed with just the columns it uses. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const MIG = readFileSync(new URL('../db/20261122230000_karmi_online_caps.sql', import.meta.url), 'utf8')
const ROLLBACK = readFileSync(new URL('../db/20261122230000_karmi_online_caps_ROLLBACK.sql', import.meta.url), 'utf8')
const MIG2 = readFileSync(new URL('../db/20261123090000_karmi_online_caps_f1_f3.sql', import.meta.url), 'utf8')
const ROLLBACK2 = readFileSync(new URL('../db/20261123090000_karmi_online_caps_f1_f3_ROLLBACK.sql', import.meta.url), 'utf8')

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

async function fresh() {
  const db = new PGlite()
  await db.exec(STUB)
  await db.exec(MIG)
  await db.exec(MIG2)
  // Test-owned config: drop the seeded dates so the tests do not depend on today's date.
  await db.exec(`delete from karmi_online_window;
    update karmi_online_caps set period_start = now() - interval '1 day', period_end = null;`)
  return db
}

/** product in `category` with barcodes, WAT stockroom, WAT till price on EVERY barcode (null = none; wave-1 config:
 *  sub-barcodes carry the same WAT single price). Returns product id. */
async function product(db, { category = 'Stretch Charm Bracelet', barcodes, stockroom = 100, price = 5.99, priceAge = '0 hours' }) {
  const { rows: [{ id }] } = await db.query(`insert into products (category_name) values ($1) returning id`, [category])
  for (const bc of barcodes) await db.query(`insert into product_barcodes values ($1, $2)`, [bc, id])
  await db.query(`insert into stock_levels values ($1, 'WAT', $2)`, [id, stockroom])
  if (price != null) for (const bc of barcodes) await db.query(`insert into pos_promotion_products (store_id, barcode, list_price, received_at)
    values ('WAT', $1, $2, now() - $3::interval)`, [bc, price, priceAge])
  return id
}

async function configure(db, pid, { family = 'stretch_charm', cap = 10, listed = true, name = null } = {}) {
  await db.query(`insert into karmi_online_products (product_id, family, unit_cap, listed, display_name, source, set_by)
    values ($1, $2, $3, $4, $5, 'test', 'test')`, [pid, family, cap, listed, name])
}

const open = (db, family = 'stretch_charm', extra = '') =>
  db.exec(`update karmi_online_caps set enabled = true ${extra} where family = '${family}'`)

async function reserve(db, items, gradient = 0, ref = randomUUID()) {
  const { rows: [r] } = await db.query(`select fn_karmi_checkout_reserve($1::uuid, $2::jsonb, $3) as r`,
    [ref, JSON.stringify(items), gradient])
  return { ...r.r, ref }
}
async function status(db, bcs) {
  const { rows: [r] } = await db.query(`select fn_karmi_online_status($1::text[]) as r`, [bcs])
  return r.r
}

test('seed: wave-1 families carry the O&W numbers, all CLOSED (enabled=false); Diamond 0 products; Christmas row', async () => {
  const db = new PGlite()
  await db.exec(STUB)
  await db.exec(MIG)
  const { rows } = await db.query(`select family, max_products, max_units, enabled from karmi_online_caps order by family`)
  assert.deepEqual(rows, [
    { family: 'diamond', max_products: 0, max_units: 356, enabled: false },
    { family: 'hair', max_products: 16, max_units: 485, enabled: false },
    { family: 'necklace_lux_stone', max_products: 20, max_units: 149, enabled: false },
    { family: 'stretch_charm', max_products: 30, max_units: 547, enabled: false },
    { family: 'stretch_double', max_products: 14, max_units: 92, enabled: false },
  ])
  const { rows: [w] } = await db.query(`select to_char(closes_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') c,
    to_char(limit_from at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') f, limit_orders, limit_units, limit_per_day,
    to_char(recovery_off_from at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') r
    from karmi_online_window where id = 'christmas_2026'`)
  assert.deepEqual(w, { c: '2026-12-16 00:00', f: '2026-12-13 00:00', limit_orders: 15, limit_units: 40, limit_per_day: false, r: '2026-12-13 00:00' })
  // 200 per-product caps in the migration text (merch v2), 1 738 units
  const vals = [...MIG.matchAll(/^\s+\('([^']+)', '([a-z_]+)', (\d+)\)/gm)]
  assert.equal(vals.length, 200)
  assert.equal(vals.reduce((a, m) => a + Number(m[3]), 0), 1738)
  assert.ok(vals.some((m) => m[1] === '1358' && m[2] === 'stretch_double'), 'pilot 7081 replaced by 1358')
  assert.ok(!vals.some((m) => m[1] === '7081'), '7081 is unpriced and must not be seeded')
})

test('a new family is charged its WAT single price; line name is server-side (display_label / display_name)', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['6001'], price: 5.99 })
  const b = await product(db, { barcodes: ['6002'], price: 5.99 })
  await configure(db, a)
  await configure(db, b, { name: 'Stretch Charm — Rose' })
  await open(db)
  const r = await reserve(db, [{ bc: '6001', qty: 2 }, { bc: '6002', qty: 1 }])
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines.map((l) => [l.bc, l.price_pence, l.name]),
    [['6001', 599, 'Stretch Charm Bracelet'], ['6002', 599, 'Stretch Charm — Rose']])
  assert.equal(r.short_session, true)
  assert.equal(r.recovery_ok, false)
  const s = await status(db, ['6001'])
  assert.equal(s.items['6001'].price_pence, 599)
})

test('fail CLOSED: unknown barcode, no config row, family off, not listed, no / stale / ambiguous WAT price', async () => {
  const db = await fresh()
  const listed = await product(db, { barcodes: ['7001'] }); await configure(db, listed)
  const unlisted = await product(db, { barcodes: ['7002'] }); await configure(db, unlisted, { listed: false })
  await product(db, { barcodes: ['7003'] }) // no karmi_online_products row
  const noPrice = await product(db, { barcodes: ['7004'], price: null }); await configure(db, noPrice)
  const stale = await product(db, { barcodes: ['7005'], priceAge: '4 days' }); await configure(db, stale)
  const amb = await product(db, { barcodes: ['7006', '7007'] }); await configure(db, amb)
  await db.exec(`insert into pos_promotion_products (store_id, barcode, list_price) values ('WAT', '7007', 3.99)`)

  // family still disabled (seed default): even the fully configured product is refused
  let r = await reserve(db, [{ bc: '7001', qty: 1 }])
  assert.equal(r.ok, false); assert.equal(r.error, 'not_available'); assert.equal(r.message, 'Not available online right now')
  assert.equal((await status(db, ['7001'])).items['7001'].sellable, 0)

  await open(db)
  assert.equal((await reserve(db, [{ bc: '7001', qty: 1 }])).ok, true)
  for (const bc of ['9999', '7002', '7003', '7004', '7005', '7006']) {
    r = await reserve(db, [{ bc, qty: 1 }])
    assert.equal(r.ok, false, bc)
    assert.deepEqual(r.items, [{ bc, requested: 1, available: 0 }], bc)
    const st = (await status(db, [bc])).items[bc]
    assert.equal(st.sellable, 0, bc)
    assert.equal(st.price_pence, null, bc)
  }
  // no config row for the family at all → the product cannot even be configured, and is not sellable
  await assert.rejects(db.query(`insert into karmi_online_products (product_id, family, unit_cap, source, set_by)
    values ($1, 'no_such_family', 5, 't', 't')`, [listed]))
  // a refused cart leaves no hold behind
  const { rows: [{ n }] } = await db.query(`select count(*)::int n from karmi_online_holds where product_id <> $1`, [listed])
  assert.equal(n, 0)
})

test('caps are cumulative: sold (any status but cancelled/refunded) + open holds + cart <= unit cap; family max_units', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['8001', '8001b'] }) // multi-barcode: one cap for the product
  const b = await product(db, { barcodes: ['8002'] })
  await configure(db, a, { cap: 6 }); await configure(db, b, { cap: 10 })
  await open(db, 'stretch_charm', ', max_units = 9')
  // 2 already sold and dispatched (fulfilment does not lower the counter), 5 cancelled (ignored)
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id) values
    ('karmilaven', 'dispatched', 'WAT', '[{"bc":"8001","qty":2}]', 'cs_old'),
    ('karmilaven', 'cancelled',  'WAT', '[{"bc":"8001","qty":5}]', 'cs_cxl')`)
  let r = await reserve(db, [{ bc: '8001b', qty: 3 }])           // 2 sold + 3 = 5 <= 6
  assert.equal(r.ok, true)
  r = await reserve(db, [{ bc: '8001', qty: 1 }, { bc: '8001b', qty: 1 }]) // 2 + 3 held + 2 = 7 > 6
  assert.equal(r.ok, false)
  assert.deepEqual(r.items.map((i) => [i.bc, i.available]), [['8001', 1], ['8001b', 1]])
  // family: 2 sold + 3 held = 5 of 9 → product b may take 4, not 5
  assert.equal((await reserve(db, [{ bc: '8002', qty: 5 }])).ok, false)
  const ok4 = await reserve(db, [{ bc: '8002', qty: 4 }])
  assert.equal(ok4.ok, true)
  assert.equal((await status(db, ['8002'])).items['8002'].sellable, 0)
  // releasing a hold gives the units back; a paid hold is counted once (as the order), never twice
  await db.query(`select fn_karmi_checkout_release($1::uuid)`, [ok4.ref])
  assert.equal((await status(db, ['8002'])).items['8002'].sellable, 4)
  const r2 = await reserve(db, [{ bc: '8002', qty: 2 }])
  await db.query(`select fn_karmi_checkout_attach($1::uuid, 'cs_new')`, [r2.ref])
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id)
    values ('karmilaven', 'paid', 'WAT', '[{"bc":"8002","qty":2}]', 'cs_new')`)
  assert.equal((await status(db, ['8002'])).items['8002'].sellable, 2) // 9 − 2 − 3 − 2
  assert.equal((await db.query(`select fn_karmi_checkout_release($1::uuid) n`, [r2.ref])).rows[0].n, 0, 'paid hold is never released')
  // expired holds no longer count
  await db.exec(`update karmi_online_holds set expires_at = now() - interval '1 second'`)
  assert.equal((await status(db, ['8001'])).items['8001'].sellable, 4) // cap 6 − 2 sold − 0 held = 4; family 9 − 4 sold = 5
})

test('concurrent checkouts cannot exceed the cap (advisory-locked reserve; 12 parallel calls, cap 5)', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['9001'] })
  await configure(db, a, { cap: 5 })
  await open(db)
  const results = await Promise.all(Array.from({ length: 12 }, () => reserve(db, [{ bc: '9001', qty: 1 }])))
  assert.equal(results.filter((r) => r.ok).length, 5)
  const { rows: [{ q }] } = await db.query(`select sum(qty)::int q from karmi_online_holds where product_id = $1`, [a])
  assert.equal(q, 5)
  // the function takes the lock before counting (single-connection PGlite cannot race; this guards the code path)
  assert.match(MIG, /perform pg_advisory_xact_lock\(hashtext\('karmi_online_checkout'\)\);\s+if exists \(select 1 from karmi_online_holds/)
})

test('stock: WAT stockroom − buffer − paid − holds, product-level; "stock" is real stock, not the cap', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['9101'], stockroom: 8 })
  await configure(db, a, { cap: 2 })
  await open(db)
  const s = (await status(db, ['9101'])).items['9101']
  assert.deepEqual([s.sellable, s.stock], [2, 5]) // cap binds the bag; "Only N left" would read stock 5, never 2
  assert.equal((await reserve(db, [{ bc: '9101', qty: 3 }])).ok, false)
})

test('variety: a family can never list more than max_products; lowering below the listed count is refused', async () => {
  const db = await fresh()
  await db.exec(`update karmi_online_caps set max_products = 2 where family = 'hair'`)
  const ids = []
  for (let i = 0; i < 3; i++) ids.push(await product(db, { category: i ? 'Hair Claws' : 'Hair Clips', barcodes: ['H' + i] }))
  await configure(db, ids[0], { family: 'hair' })
  await configure(db, ids[1], { family: 'hair' })
  await assert.rejects(configure(db, ids[2], { family: 'hair' }), /max_products/)
  await configure(db, ids[2], { family: 'hair', listed: false })
  await assert.rejects(db.exec(`update karmi_online_caps set max_products = 1 where family = 'hair'`), /unlist/)
  // wrong category for the family is refused
  const x = await product(db, { category: 'Necklace Lux Stone', barcodes: ['N1'] })
  await assert.rejects(configure(db, x, { family: 'hair', listed: false }), /not in family/)
})

test('reselect: priced + cap >= 3 + WAT stockroom > 0, ranked by 28-day WAT+GUI sales, first max_products', async () => {
  const db = await fresh()
  await db.exec(`update karmi_online_caps set max_products = 2 where family = 'stretch_double'`)
  const cat = 'Stretch Double Bracelet'
  const p1 = await product(db, { category: cat, barcodes: ['D1'] })
  const p2 = await product(db, { category: cat, barcodes: ['D2'] })
  const p3 = await product(db, { category: cat, barcodes: ['D3'] })
  const noPrice = await product(db, { category: cat, barcodes: ['D4'], price: null })
  const smallCap = await product(db, { category: cat, barcodes: ['D5'] })
  const noStock = await product(db, { category: cat, barcodes: ['D6'], stockroom: 0 })
  for (const [p, cap] of [[p1, 10], [p2, 10], [p3, 10], [noPrice, 10], [smallCap, 2], [noStock, 10]]) await configure(db, p, { family: 'stretch_double', cap, listed: false })
  await db.exec(`insert into pos_daily_item_sales values ('WAT', current_date - 1, 'D2', 9), ('GUI', current_date - 2, 'D3', 5),
    ('WAT', current_date - 3, 'D4', 50), ('WAT', current_date - 3, 'D5', 50), ('WAT', current_date - 3, 'D6', 50),
    ('WAT', current_date - 40, 'D1', 99)`)
  const { rows: [{ n }] } = await db.query(`select fn_karmi_online_reselect('stretch_double') n`)
  assert.equal(n, 2)
  const { rows } = await db.query(`select product_id from karmi_online_products where listed order by product_id`)
  assert.deepEqual(rows.map((r) => r.product_id).sort(), [p2, p3].sort())
})

test('Christmas: after the cut-off every checkout is refused with the configured message (Gradient too)', async () => {
  const db = await fresh()
  await db.exec(`insert into karmi_online_window (id, closes_at, closed_message, limit_message, set_by)
    values ('x', now() - interval '1 minute', 'Closed for Christmas.', 'Limit.', 't')`)
  const r = await reserve(db, [], 2)
  assert.deepEqual([r.ok, r.error, r.message], [false, 'closed', 'Closed for Christmas.'])
  const s = await status(db, [])
  assert.deepEqual(s.window, { open: false, message: 'Closed for Christmas.' })
  // reopen_at in the past → open again
  await db.exec(`update karmi_online_window set reopen_at = now() - interval '1 second'`)
  assert.equal((await reserve(db, [], 1)).ok, true)
})

test('Christmas: 13–15 Dec style limit — total orders and units incl. open holds and Gradient units', async () => {
  const db = await fresh()
  await db.exec(`insert into karmi_online_window (id, closes_at, limit_from, limit_orders, limit_units, closed_message, limit_message, set_by)
    values ('x', now() + interval '2 days', now() - interval '1 hour', 3, 8, 'Closed.', 'Christmas limit reached.', 't')`)
  // one order already paid in the window (3 units), one before the window (ignored)
  await db.exec(`insert into online_orders (source, status, store_id, items, created_at) values
    ('karmilaven', 'paid', 'WAT', '[{"bc":"1074","qty":3}]', now() - interval '30 minutes'),
    ('karmilaven', 'dispatched', 'WAT', '[{"bc":"1074","qty":9}]', now() - interval '3 hours')`)
  assert.equal((await reserve(db, [], 6)).ok, false, '3 + 6 units > 8')
  assert.equal((await reserve(db, [], 4)).ok, true) // order 2, units 7
  const r = await reserve(db, [], 2)               // units 9 > 8
  assert.deepEqual([r.ok, r.error, r.message], [false, 'limit_reached', 'Christmas limit reached.'])
  assert.equal((await reserve(db, [], 1)).ok, true) // order 3, units 8
  assert.equal((await reserve(db, [], 1)).error, 'limit_reached') // order 4 > 3
  assert.equal((await status(db, [])).window.open, false)
})

test('recovery_off_from: a session created before it (12 Dec) gets a recovery link, one created from it (13 Dec) does not', async () => {
  const db = await fresh()
  // "12 Dec": recovery_off_from is still 1 day ahead
  await db.exec(`insert into karmi_online_window (id, closes_at, limit_from, limit_orders, limit_units, recovery_off_from, closed_message, limit_message, set_by)
    values ('x', now() + interval '4 days', now() + interval '1 day', 15, 40, now() + interval '1 day', 'c', 'l', 't')`)
  const before = await reserve(db, [], 1)
  assert.deepEqual([before.ok, before.recovery_ok, before.short_session], [true, true, true]) // 24 h before the window: short session
  // "13 Dec": recovery_off_from has passed
  await db.exec(`update karmi_online_window set recovery_off_from = now() - interval '1 minute', limit_from = now() - interval '1 minute'`)
  const after = await reserve(db, [], 1)
  assert.deepEqual([after.ok, after.recovery_ok], [true, false])
  // a capped product never gets recovery
  const a = await product(db, { barcodes: ['R1'] }); await configure(db, a); await open(db)
  await db.exec(`update karmi_online_window set recovery_off_from = now() + interval '1 day'`)
  assert.equal((await reserve(db, [{ bc: 'R1', qty: 1 }])).recovery_ok, false)
})

test('late order (e.g. via an old recovery link) is FLAGGED for manual handling, never refunded or cancelled', async () => {
  const db = await fresh()
  await db.exec(`insert into karmi_online_window (id, closes_at, limit_from, limit_orders, limit_units, closed_message, limit_message, set_by)
    values ('x', now() + interval '2 days', now() - interval '2 hours', 2, 40, 'c', 'l', 't')`)
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id, created_at, fulfilment_note) values
    ('karmilaven', 'paid', 'WAT', '[{"bc":"1074","qty":2}]', 'cs_a', now() - interval '90 minutes', null),
    ('karmilaven', 'paid', 'WAT', '[{"bc":"1074","qty":1}]', 'cs_b', now() - interval '60 minutes', null),
    ('karmilaven', 'paid', 'WAT', '[{"bc":"1111","qty":1}]', 'cs_c', now() - interval '30 minutes', 'gift wrap')`)
  const flag = async (sid) => (await db.query(`select fn_karmi_flag_late_order($1) r`, [sid])).rows[0].r
  assert.equal((await flag('cs_b')).flagged, false, 'order 2 of 2 is within the total')
  const c = await flag('cs_c')
  assert.equal(c.flagged, true)
  assert.match(c.reason, /beyond the Christmas limit \(3 orders/)
  await flag('cs_c') // idempotent
  let { rows: [o] } = await db.query(`select status, fulfilment_note from online_orders where stripe_session_id = 'cs_c'`)
  assert.equal(o.status, 'paid', 'no refund / cancel')
  assert.equal(o.fulfilment_note.match(/FLAG manual check/g).length, 1)
  assert.ok(o.fulfilment_note.startsWith('gift wrap | FLAG manual check (no auto-refund): beyond'))
  // paid after the cut-off
  await db.exec(`update karmi_online_window set closes_at = now() - interval '10 minutes', limit_from = now() - interval '3 hours'`)
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id) values ('karmilaven', 'paid', 'WAT', '[{"bc":"1074","qty":1}]', 'cs_late')`)
  const late = await flag('cs_late')
  assert.equal(late.flagged, true)
  assert.match(late.reason, /after the Christmas cut-off/)
  ;({ rows: [o] } = await db.query(`select status from online_orders where stripe_session_id = 'cs_late'`))
  assert.equal(o.status, 'paid')
  assert.equal((await flag('cs_unknown')).flagged, false)
})

test('per-day option counts from London midnight', async () => {
  const db = await fresh()
  await db.exec(`insert into karmi_online_window (id, closes_at, limit_from, limit_orders, limit_per_day, closed_message, limit_message, set_by)
    values ('x', now() + interval '3 days', now() - interval '3 days', 1, true, 'c', 'l', 't')`)
  await db.exec(`insert into online_orders (source, status, store_id, items, created_at) values
    ('karmilaven', 'paid', 'WAT', '[{"bc":"1074","qty":1}]', (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London') - interval '1 minute')`)
  assert.equal((await reserve(db, [], 1)).ok, true)
  assert.equal((await reserve(db, [], 1)).ok, false)
})

test('security: RLS on, browser roles have no table rights and cannot execute; service_role can', async () => {
  const db = await fresh()
  const { rows } = await db.query(`select relname, relrowsecurity from pg_class where relname like 'karmi_online_%' and relkind = 'r' order by 1`)
  assert.deepEqual(rows.map((r) => [r.relname, r.relrowsecurity]), [
    ['karmi_online_caps', true], ['karmi_online_holds', true], ['karmi_online_products', true], ['karmi_online_window', true]])
  const { rows: defs } = await db.query(`select proname, prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where proname like 'fn_karmi%'`)
  assert.equal(defs.length, 17)
  for (const d of defs) { assert.equal(d.prosecdef, true, d.proname); assert.match(d.cfg, /search_path=public, pg_temp/, d.proname) }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query(`select * from karmi_online_caps`), /permission denied/)
    await assert.rejects(db.query(`select fn_karmi_online_status('{}')`), /permission denied/)
    await assert.rejects(db.query(`select fn_karmi_checkout_reserve(gen_random_uuid(), '[]', 1)`), /permission denied/)
    await assert.rejects(db.query(`select fn_karmi__state('{}')`), /permission denied/)
    await db.exec(`reset role`)
  }
  await db.exec(`set role service_role`)
  assert.equal((await db.query(`select (fn_karmi_online_status('{}')->'window'->>'open')::boolean o`)).rows[0].o, true)
  await db.exec(`reset role`)
})

test('rollback removes every object', async () => {
  const db = await fresh()
  await db.exec(ROLLBACK)
  const { rows } = await db.query(`select (select count(*)::int from pg_proc where proname like 'fn_karmi%') f,
    (select count(*)::int from pg_class where relname like 'karmi_online_%') t`)
  assert.deepEqual(rows[0], { f: 0, t: 0 })
})

// ───────────────────────────── F1 / F3 (K&D review of PR #34, 23 Nov) ─────────────────────────────

const holdsExpire = (db, ref) => db.query(`update karmi_online_holds set expires_at = now() - interval '1 minute' where ref = $1`, [ref])

test('F1 late webhook: hold expired, Stripe session complete, no order yet → still counted, second buyer refused', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['L1'] })
  await configure(db, a, { cap: 2 })
  await open(db)
  const first = await reserve(db, [{ bc: 'L1', qty: 2 }])
  assert.equal(first.ok, true)
  assert.equal(first.short_session, true)
  await db.query(`select fn_karmi_checkout_attach($1::uuid, 'cs_paid')`, [first.ref])
  await holdsExpire(db, first.ref) // 40 min later: the buyer paid at minute 20, the webhook has not arrived
  // outcome not known yet: the attached short hold keeps counting (PR #34 freed it here → 4 sold vs cap 2)
  let r = await reserve(db, [{ bc: 'L1', qty: 1 }])
  assert.deepEqual([r.ok, r.error], [false, 'not_available'])
  assert.equal((await status(db, ['L1'])).items['L1'].sellable, 0)
  // the resolver asks Stripe: complete → keeps counting until the order row exists
  const { rows: chk } = await db.query(`select fn_karmi_holds_to_check(10) sid`)
  assert.deepEqual(chk.map((x) => x.sid), ['cs_paid'])
  await db.query(`select fn_karmi_checkout_resolve('cs_paid', 'complete')`)
  assert.equal((await db.query(`select count(*)::int n from fn_karmi_holds_to_check(10)`)).rows[0].n, 0, 'asked once')
  assert.equal((await db.query(`select fn_karmi_checkout_release($1::uuid) n`, [first.ref])).rows[0].n, 0, 'a complete hold is never released')
  r = await reserve(db, [{ bc: 'L1', qty: 1 }])
  assert.equal(r.ok, false, 'second buyer refused while the order row is missing')
  // the late webhook finally writes the order: counted once, as the order
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id)
    values ('karmilaven', 'paid', 'WAT', '[{"bc":"L1","qty":2}]', 'cs_paid')`)
  const { rows: [{ n }] } = await db.query(`select count(*)::int n from fn_karmi__open_holds()`)
  assert.equal(n, 0)
  assert.equal((await reserve(db, [{ bc: 'L1', qty: 1 }])).ok, false)
  assert.deepEqual((await db.query(`select fn_karmi_cap_overshoot('cs_paid') r`)).rows[0].r, { over: [] }, 'exactly at cap: no alarm')
})

test('F1: webhook marks the hold complete before the order is written; Stripe "expired" frees it; unattached holds still expire', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['L2'] })
  await configure(db, a, { cap: 2 })
  await open(db)
  // checkout could not attach (no session id on the hold); the webhook completes it by ref
  const w = await reserve(db, [{ bc: 'L2', qty: 1 }])
  assert.equal((await db.query(`select fn_karmi_checkout_complete($1::uuid, 'cs_w') n`, [w.ref])).rows[0].n, 1)
  await holdsExpire(db, w.ref)
  assert.equal((await status(db, ['L2'])).items['L2'].sellable, 1, 'complete hold counts past expiry')
  // abandoned session: Stripe says expired → released
  const x = await reserve(db, [{ bc: 'L2', qty: 1 }])
  await db.query(`select fn_karmi_checkout_attach($1::uuid, 'cs_x')`, [x.ref])
  await holdsExpire(db, x.ref)
  assert.equal((await status(db, ['L2'])).items['L2'].sellable, 0)
  assert.equal((await db.query(`select fn_karmi_checkout_resolve('cs_x', 'expired') n`)).rows[0].n, 1)
  assert.equal((await status(db, ['L2'])).items['L2'].sellable, 1)
  assert.equal((await db.query(`select fn_karmi_checkout_resolve('cs_w', 'expired') n`)).rows[0].n, 0, 'expired never frees a complete hold')
  // a hold with no Stripe session at all still expires by the clock (nothing can be paid)
  const y = await reserve(db, [{ bc: 'L2', qty: 1 }])
  await holdsExpire(db, y.ref)
  assert.equal((await status(db, ['L2'])).items['L2'].sellable, 1)
  // a non-short Gradient-only hold (no Christmas window) keeps the old clock expiry
  const g = await reserve(db, [], 2)
  assert.equal(g.short_session, false)
  await db.query(`select fn_karmi_checkout_attach($1::uuid, 'cs_g')`, [g.ref])
  await holdsExpire(db, g.ref)
  assert.equal((await db.query(`select count(*)::int n from fn_karmi__open_holds() where family = 'gradient'`)).rows[0].n, 0)
  assert.equal((await db.query(`select count(*)::int n from fn_karmi_holds_to_check(10)`)).rows[0].n, 0)
})

test('F1 overshoot alarm: sold + held over the product cap and the family cap is reported for that order', async () => {
  const db = await fresh()
  const a = await product(db, { barcodes: ['O1'] })
  const b = await product(db, { barcodes: ['O2'] })
  await configure(db, a, { cap: 2 }); await configure(db, b, { cap: 5 })
  await open(db, 'stretch_charm', ', max_units = 4')
  // residual case: a webhook so late that the hold had no session to wait for → the cap was sold twice
  await db.exec(`insert into online_orders (source, status, store_id, items, stripe_session_id) values
    ('karmilaven', 'paid', 'WAT', '[{"bc":"O1","qty":2}]', 'cs_one'),
    ('karmilaven', 'paid', 'WAT', '[{"bc":"O1","qty":2},{"bc":"O2","qty":1}]', 'cs_two')`)
  const { rows: [{ r }] } = await db.query(`select fn_karmi_cap_overshoot('cs_two') r`)
  assert.deepEqual(r.over, [
    { kind: 'family', family: 'stretch_charm', cap: 4, sold: 5, held: 0 },
    { kind: 'product', family: 'stretch_charm', product_id: a, cap: 2, sold: 4, held: 0 },
  ])
  // product b is within its own cap → not listed; unknown session → nothing
  assert.deepEqual((await db.query(`select fn_karmi_cap_overshoot('cs_none') r`)).rows[0].r, { over: [] })
  // status floors at 0 and cannot show the overshoot; the alarm is what makes it visible
  assert.equal((await status(db, ['O1'])).items['O1'].sellable, 0)
})

test('F3: a product with ANY barcode lacking a valid current WAT price is not sellable', async () => {
  const db = await fresh()
  await open(db)
  const good = await product(db, { barcodes: ['P1', 'P1b'] })            // both barcodes £5.99 → sellable
  const missing = await product(db, { barcodes: ['P2', 'P2b'], price: null })
  await db.exec(`insert into pos_promotion_products (store_id, barcode, list_price) values ('WAT', 'P2', 5.99)`) // P2b: no WAT row
  const stale = await product(db, { barcodes: ['P3', 'P3b'], price: null })
  await db.exec(`insert into pos_promotion_products (store_id, barcode, list_price, received_at) values
    ('WAT', 'P3', 5.99, now()), ('WAT', 'P3b', 5.99, now() - interval '4 days')`)       // P3b: only an old price
  const zero = await product(db, { barcodes: ['P4', 'P4b'], price: null })
  await db.exec(`insert into pos_promotion_products (store_id, barcode, list_price) values ('WAT', 'P4', 5.99), ('WAT', 'P4b', 0)`)
  for (const p of [good, missing, stale, zero]) await configure(db, p)
  assert.equal((await reserve(db, [{ bc: 'P1b', qty: 1 }])).ok, true)
  for (const bc of ['P2', 'P2b', 'P3', 'P3b', 'P4', 'P4b']) {
    const r = await reserve(db, [{ bc, qty: 1 }])
    assert.deepEqual([r.ok, r.error, r.message], [false, 'not_available', 'Not available online right now'], bc)
    const st = (await status(db, [bc])).items[bc]
    assert.deepEqual([st.sellable, st.price_pence], [0, null], bc)
  }
  // reselect never lists it either
  await db.exec(`update karmi_online_products set listed = false`)
  await db.query(`select fn_karmi_online_reselect('stretch_charm')`)
  const { rows } = await db.query(`select product_id from karmi_online_products where listed`)
  assert.deepEqual(rows.map((x) => x.product_id), [good])
})

test('F1/F3 migration: apply twice (idempotent), rollback → PR #34 functions, re-apply, full rollback', async () => {
  const db = new PGlite()
  await db.exec(STUB)
  await db.exec(MIG)
  const snap = async () => (await db.query(`select p.proname, md5(replace(pg_get_functiondef(p.oid), chr(13), '')) d, array_to_string(p.proacl, ',') acl
    from pg_proc p where proname like 'fn_karmi%' order by 1`)).rows
  const cols = async () => (await db.query(`select column_name from information_schema.columns
    where table_name = 'karmi_online_holds' order by ordinal_position`)).rows.map((r) => r.column_name)
  const before = await snap()
  await db.exec(MIG2)
  const once = await snap()
  await db.exec(MIG2)
  assert.deepEqual(await snap(), once, 'second apply changes nothing')
  assert.equal(once.length, 17)
  assert.ok((await cols()).includes('completed_at'))
  await db.exec(ROLLBACK2)
  assert.deepEqual(await snap(), before, 'rollback restores the PR #34 functions exactly')
  assert.ok(!(await cols()).includes('completed_at') && !(await cols()).includes('short_session'))
  await db.exec(MIG2)
  assert.deepEqual(await snap(), once, 're-apply after rollback')
  await db.exec(ROLLBACK2)
  await db.exec(ROLLBACK)
  const { rows } = await db.query(`select (select count(*)::int from pg_proc where proname like 'fn_karmi%') f,
    (select count(*)::int from pg_class where relname like 'karmi_online_%') t`)
  assert.deepEqual(rows[0], { f: 0, t: 0 })
  // the PR #34 rollback alone also removes the F1/F3 functions
  await db.exec(MIG); await db.exec(MIG2); await db.exec(ROLLBACK)
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname like 'fn_karmi%'`)).rows[0].n, 0)
})
