// SQL tests for db/20261122230000_karmi_online_caps.sql on an in-process Postgres (PGlite, dev dependency only).
// The ops tables the migration reads are stubbed with just the columns it uses. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const MIG = readFileSync(new URL('../db/20261122230000_karmi_online_caps.sql', import.meta.url), 'utf8')
const ROLLBACK = readFileSync(new URL('../db/20261122230000_karmi_online_caps_ROLLBACK.sql', import.meta.url), 'utf8')

const STUB = `
create role anon; create role authenticated; create role service_role;
create table products (id uuid primary key default gen_random_uuid(), category_name text);
create table product_barcodes (barcode text primary key, product_id uuid references products(id));
create table stock_levels (product_id uuid, store_id text, stockroom_count int);
create table online_orders (id uuid primary key default gen_random_uuid(), source text, stripe_session_id text,
  created_at timestamptz not null default now(), items jsonb, store_id text, status text);
create table pos_promotion_products (id bigserial primary key, store_id text, barcode text, list_price numeric,
  received_at timestamptz not null default now());
create table pos_daily_item_sales (store_id text, sale_date date, barcode text, qty numeric);
`

async function fresh() {
  const db = new PGlite()
  await db.exec(STUB)
  await db.exec(MIG)
  // Test-owned config: drop the seeded dates so the tests do not depend on today's date.
  await db.exec(`delete from karmi_online_window;
    update karmi_online_caps set period_start = now() - interval '1 day', period_end = null;`)
  return db
}

/** product in `category` with barcodes, WAT stockroom, WAT till price (null = none). Returns product id. */
async function product(db, { category = 'Stretch Charm Bracelet', barcodes, stockroom = 100, price = 5.99, priceAge = '0 hours' }) {
  const { rows: [{ id }] } = await db.query(`insert into products (category_name) values ($1) returning id`, [category])
  for (const bc of barcodes) await db.query(`insert into product_barcodes values ($1, $2)`, [bc, id])
  await db.query(`insert into stock_levels values ($1, 'WAT', $2)`, [id, stockroom])
  if (price != null) await db.query(`insert into pos_promotion_products (store_id, barcode, list_price, received_at)
    values ('WAT', $1, $2, now() - $3::interval)`, [barcodes[0], price, priceAge])
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
    to_char(limit_from at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') f, limit_orders, limit_units, limit_per_day
    from karmi_online_window where id = 'christmas_2026'`)
  assert.deepEqual(w, { c: '2026-12-16 00:00', f: '2026-12-13 00:00', limit_orders: 15, limit_units: 40, limit_per_day: false })
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
  // inside the 24 h before the window: short Stripe sessions; within 30 days: no recovery links
  const db2 = await fresh()
  await db2.exec(`insert into karmi_online_window (id, closes_at, limit_from, limit_orders, limit_units, closed_message, limit_message, set_by)
    values ('x', now() + interval '20 days', now() + interval '10 days', 15, 40, 'c', 'l', 't')`)
  const g = await reserve(db2, [], 1)
  assert.deepEqual([g.ok, g.short_session, g.recovery_ok], [true, false, false])
  await db2.exec(`update karmi_online_window set limit_from = now() + interval '40 days', closes_at = now() + interval '43 days'`)
  const g2 = await reserve(db2, [], 1)
  assert.deepEqual([g2.short_session, g2.recovery_ok], [false, true])
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
  assert.equal(defs.length, 12)
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
