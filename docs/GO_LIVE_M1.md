# Go-live M1 (Mert's online price list) — runbook, PR-3 patch, rollback

Target: live by Thu 26 Nov 2026 night (ideally Wed 25). M1 runs on the EXISTING page (the Gradient Edit cards);
it does not wait for the family cards (PR-2 flag `families` stays OFF).

## What M1 is (ladders.json mode `cart_qty_groups`)
- Online single price per group: A £5.00 · **B £8.00 (Gradient Edit)** · C £13.00.
- 10 or more units in the bag (any mix, all groups counted together): EVERY unit pays its group's 10+ price:
  A £1.50 · **B £2.40** · C £3.90. 1–9 units pay the single price. No intermediate steps, **no cap** (Mert 23 Nov:
  a 3–9 unit bag is not capped at the 10-unit price; the 'capped' option was dropped and is not built).
- Delivery £1.49, free with 10+ units. No spend threshold. **Superseded 25 Nov 2026 (owner): £3.99 UK delivery, free when the basket paid (after the 10+ price) is >= £30.00; no item-count free delivery** (ladders.json shipping; tests/delivery-399-30.test.mjs). Delivery texts below are historical.
- Promotion codes and Stripe recovery links are off once the 10+ price applies (api/checkout.js).
- Page texts (S1, no %, no strike-through, no "save"): card `£8 each · £2.40 each when you buy 10 or more`,
  delivery `£1.49 UK delivery · free with 10+ items` (fee in the same text as every free claim, CMA209 §5.21).
- Cart line (Komuta rule 23 Nov; figure from THIS cart, cheapest group already in the cart, never a generic "£15"):
  - lower than the bag now → `Add N more (e.g. Crystal bracelets): your total becomes £X with free delivery`,
    at 9 units `Add 1 more: total drops to £X with free delivery`;
  - otherwise → `Add N more to unlock 10+ prices (from £x each) and free UK delivery`;
  - shown in the cart band AND in a box right above Secure Checkout (CTSI §20);
  - at 10+: `10+ price applied: £2.40 each` + `Promo codes can’t be used with the 10+ price.`

## Branches
| Branch | Base | Content | Live effect when merged |
|---|---|---|---|
| `feat/ladder-m1-on-master` | origin/master 49173ee (PR-2 #40 + perf #41) | engine mode, page M1 code (dormant), go-live-ready tests | **none** (ladders.json unchanged; old-vs-new page text equal, sha256 pin) |
| PR-3 = `docs/GO_LIVE_M1.patch` | the branch above | ladders.json → M1, page `M1_FALLBACK`, static texts, shipping-returns, terms | **M1 live** |
| `feat/ladder-m1-mert-list` | e62c431 (before PR-2) | same M1 work on the old base (kept, not for merge) | — |

## Steps (App-dev)
1. **Merge `feat/ladder-m1-on-master`** (PR, K&D). Nothing changes for customers. Smoke after deploy:
   `GET /api/stock` → `ladders.version = "live-2026-11-23"`, no `online_group` key; a 3-Gradient checkout still £7.50 +
   £1.49 (no purchase: stop at the Stripe page).
2. **Preview check of M1 before the switch** (Vercel preview of the branch, logged in):
   - `GET <preview>/api/stock?ladder=M1_mert_list&bc=<Gradient bc>` → `ladders.mode = "cart_qty_groups"`.
   - Open `<preview>/?ladder=M1_mert_list`: cards `£8 each · £2.40 each when you buy 10 or more`; cart 3 / 5 / 9 / 10.
   - `POST <preview>/api/checkout {"ladder":"M1_mert_list","dry_run":true,"items":[{"bc":"<G1>","qty":9},{"bc":"<G2>","qty":1}]}`
     → `amount_pence 2400`, `shipping_pence 0`. 8+1 → `7200`, `149`. (dry_run: no DB, no Stripe. Never call checkout
     on a preview without dry_run.)
3. **PR-3 = go-live**: on a branch from the merged master: `git am docs/GO_LIVE_M1.patch` (one commit), `npm test`
   (expected: all pass, the 5 pools-era static-text tests skip, the 3 M1 static-text tests run and pass), PR, K&D, merge.
   The patch was generated from and verified on `feat/ladder-m1-on-master` (`git apply --check` clean; tests 155 pass /
   5 skip / 0 fail with the patch applied).
4. **Smoke after the PR-3 deploy** (no purchase):
   - `GET /api/stock` → `ladders.mode = "cart_qty_groups"`, `version = "M1-2026-11-25"`.
   - Page first paint (before /api/stock answers) already shows £8 and `free with 10+ items` (M1_FALLBACK).
   - Cart 9 Gradient = £72.00 + £1.49 = £73.49, line `Add 1 more: total drops to £24.00 with free delivery`;
     10 = £24.00, delivery FREE, `10+ price applied: £2.40 each`. Stripe page (stop there): 10 × £2.40, free shipping,
     no promotion-code field.
   - `view-source:` has no `£2.99`, no `free from £12`, no `(or 5 items)` (meta, JSON-LD included).
5. **Outside the repo (owner/marketing, before the switch):** Klaviyo flows/emails, Instagram/GBP texts, Google
   Merchant feed, any printed card that says `£2.99` or `free from £12 (or 5 items)`. The repo has no email templates
   (api/ sends none with prices); Stripe shows only "Free UK shipping" / "UK standard shipping".
6. **Keep the PR-2 flag `families` OFF** under M1: js/storefront.js family cards price with the pools model and the
   WAT till price; they are not M1-aware yet (separate task).

## Rollback (≈ 2 min + deploy)
`git revert <PR-3 commit>` → PR/merge (or Vercel "Promote" of the previous production deployment for an instant
rollback). ladders.json returns to `live-2026-11-23`, the texts to `£2.99` / `free from £12 (or 5 items)`. Proven by tests:
the pools-table tests run against the frozen table `tests/fixtures/ladders.live-2026-11-23.json`, and
`tests/m1-page.test.mjs` pins the pools page output (sha256 17b7e873…, identical before and after the M1 code).
Open M1 sessions created before the rollback keep their Stripe prices (normal; at most 31 min).

## Texts: spend threshold → quantity threshold (repo grep, file:line)
Pattern: `free from £|free over £|or 5 items|5 or more items|£12\b|£2\.99|2\.99"`

**Before** (feat/ladder-m1-on-master = live master + dormant M1 code), customer-visible:
| File:line | Text | After PR-3 |
|---|---|---|
| index.html:451 | meta description `…from £2.99 … £1.49 UK delivery, free from £12 (or 5 items).` | `…£8 each · £2.40 each when you buy 10 or more (mix any shades)… £1.49 UK delivery · free with 10+ items.` |
| index.html:456 / 464 | og:title / twitter:title `…from £2.99` | `… · £8 each` |
| index.html:457 / 465 | og / twitter description `… free from £12 (or 5 items).` | `£1.49 UK delivery · free with 10+ items.` |
| index.html:476 | announce bar | `£1.49 UK delivery · free with 10+ items` |
| index.html:494–495 | hero `£2.99` + `+ £1.49 UK delivery · free from £12 or 5 items` | `£8` + `+ £1.49 UK delivery · free with 10+ items` |
| index.html:526 | bundle CTA `3 for £7.50 · 6 for £14.99 · …` | `Mix any shades · £8 each · £2.40 each when you buy 10 or more · £1.49 UK delivery · free with 10+ items` |
| index.html:543 | story strip `£2.99 each` | `£8 each · £2.40 each at 10+` |
| index.html:552, 596, 628 | FAQ ×2, footer | `£1.49 UK delivery · free with 10+ items` |
| index.html:581–582 (FAQ) | `How do multi-buy savings work? … 2 for £5.50 · 3 for £7.50 · 6 for £14.99` | `How does the 10+ price work? Every bracelet is £8 each. Put 10 or more items in your bag (mix any shades) and every item is £2.40 each, with free UK delivery. Under 10 items, UK delivery is £1.49. …` |
| index.html:671 | cart band fallback | `£1.49 UK delivery · free with 10+ items` |
| index.html:686 | sticky `Each £2.99` | `Each £8.00` |
| index.html:1401, 1409–1410, 1415 | JSON-LD description, lowPrice/highPrice 2.99, shipping description | `…£8 each or £2.40 each when you buy 10 or more.`, `8.00`, `£1.49 UK delivery · free with 10+ items` |
| shipping-returns.html:24 | `Free on orders of £12 or more, or of 5 or more items.` | `Free on orders of 10 or more items (any mix).` |
| terms.html:24 | `Price: £2.99 per bracelet.` | `Prices: £8.00 per bracelet; £2.40 per item when your order has 10 or more items (any mix). UK delivery £1.49, free on orders of 10 or more items.` |
| K-08 copy (index.html hero, FAQ ×2, modal) | `hand-strung on …` | `on a gold-tone chain …` |

**After PR-3** (only non-customer-visible lines remain): code comments in api/_gradient.js:1, api/_pricing.js:21–22,
api/checkout.js:12, db/20261122230000_karmi_online_caps.sql:23, index.html:695 / 958 (comments, the pools fallback
literal used only on rollback), index.html:1097 (the regex that REPLACES old texts), js/storefront.js:66 (comment),
docs/SITE-OPERATIONS.md:31 (internal doc: update with the go-live). With M1 on, the page also rewrites any remaining
old sentence at runtime (meta + JSON-LD included, `m1ApplyMeta`), and `tests/delivery.test.mjs` fails the build if a
spend-threshold text or `£2.99` is left in the shipped HTML / shipping-returns / terms.

## DB part (SQL text only — NOT executed; needed only when non-Gradient families go online)
All families in `karmi_online_caps` are `enabled = false` today, so the Gradient-only M1 does **not** need this
migration. **The Gradient Edit is NOT a row of `karmi_online_products`** (it is priced by barcode, api/_gradient.js, and
its group comes from ladders.json `gradient_group: "B"`); inserting Lux Bracelet / Lux Cobra rows would route them
through the caps checkout path — do not. Read-only check 23 Nov: 0 Lux rows in `karmi_online_products`.

Group mapping for the existing rows (by category): Stretch Charm Bracelet, Hair Clips → B; Hair Claws, Necklace Lux
Stone, Stretch Double Bracelet, Diamond Bracelet → C. "Stretch Bracelet" (A), "Necklace Lux" (B) and "Bangle" (C) have
no rows yet (K-046 open: which products).

Migration `db/<YYYYMMDDHHMMSS>_karmi_online_group.sql` (re-runnable):
```sql
begin;
alter table public.karmi_online_products add column if not exists online_group text null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'karmi_online_products_online_group_chk') then
    alter table public.karmi_online_products add constraint karmi_online_products_online_group_chk
      check (online_group is null or online_group ~ '^[A-Z]$');
  end if;
end $$;
comment on column public.karmi_online_products.online_group is
  'M1 online price group (ladders.json groups, e.g. A/B/C). NULL = not priced in mode cart_qty_groups (checkout 503).';
update public.karmi_online_products k set online_group = m.g
  from (values ('Stretch Charm Bracelet','B'), ('Hair Clips','B'), ('Hair Claws','C'), ('Necklace Lux Stone','C'),
               ('Stretch Double Bracelet','C'), ('Diamond Bracelet','C')) as m(cat, g), public.products p
 where p.id = k.product_id and p.category_name = m.cat and k.online_group is null;

create or replace function public.fn_karmi_online_status(p_barcodes text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_win jsonb; v_open boolean; v_items jsonb;
begin
  if cardinality(coalesce(p_barcodes, '{}'::text[])) > 200 then
    return jsonb_build_object('error', 'too_many_barcodes');
  end if;
  v_win := fn_karmi__window(0, 0);
  v_open := coalesce((v_win->>'ok')::boolean, false);
  select coalesce(jsonb_object_agg(s.barcode, jsonb_build_object(
           'sellable', case when v_open and s.reason is null then least(s.stock, s.cap_left, s.family_left) else 0 end,
           'stock', case when s.product_id is null then 0 else s.stock end,
           'price_pence', case when s.reason is null then s.price_pence end,
           'online_group', (select k.online_group from karmi_online_products k where k.product_id = s.product_id))), '{}'::jsonb)
    into v_items
    from fn_karmi__state(p_barcodes) s;
  return jsonb_build_object('window', jsonb_build_object('open', v_open, 'message', v_win->>'message'),
                            'items', v_items);
end $$;

create or replace function public.fn_karmi_checkout_reserve(p_ref uuid, p_items jsonb, p_gradient_units int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_grad int := coalesce(p_gradient_units, 0);
  v_units int; v_win jsonb; v_short jsonb; v_lines jsonb; v_capped boolean; v_short_session boolean;
  c_hold constant interval := interval '40 minutes';   -- Stripe session lives 31 min (min allowed 30)
  c_na constant text := 'Not available online right now';
begin
  if p_ref is null or jsonb_typeof(v_items) <> 'array' or v_grad < 0 or v_grad > 99 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Serialise every admission: the count below and the hold insert happen with no other checkout in between.
  perform pg_advisory_xact_lock(hashtext('karmi_online_checkout'));

  if exists (select 1 from karmi_online_holds h where h.ref = p_ref) then
    return jsonb_build_object('ok', false, 'error', 'bad_request', 'message', 'duplicate ref');
  end if;

  create temp table if not exists _karmi_req (bc text primary key, qty int not null) on commit drop;
  truncate pg_temp._karmi_req;
  insert into pg_temp._karmi_req (bc, qty)
  select btrim(e->>'bc'), sum(case when (e->>'qty') ~ '^\s*\d{1,2}\s*$' then (e->>'qty')::int else 0 end)
    from jsonb_array_elements(v_items) e
   where coalesce(btrim(e->>'bc'), '') <> ''
   group by 1;
  delete from pg_temp._karmi_req where qty <= 0;

  select coalesce(sum(qty), 0)::int + v_grad into v_units from pg_temp._karmi_req;
  if v_units < 1 or v_units > 99 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_capped := exists (select 1 from pg_temp._karmi_req);

  v_win := fn_karmi__window(v_units, 1);
  if not (v_win->>'ok')::boolean then
    return v_win;
  end if;
  v_short_session := v_capped or coalesce((v_win->>'short_session')::boolean, true);

  create temp table if not exists _karmi_state on commit drop as
    select s.*, 0 as qty from fn_karmi__state('{}'::text[]) s limit 0;
  truncate pg_temp._karmi_state;
  insert into pg_temp._karmi_state
  select s.*, r.qty from pg_temp._karmi_req r join fn_karmi__state(array(select bc from pg_temp._karmi_req)) s on s.barcode = r.bc;

  -- product-level (all barcodes of one product share its cap and stock) and family-level totals
  select jsonb_agg(jsonb_build_object(
           'bc', s.barcode, 'requested', s.qty,
           'available', case when s.reason is null then least(s.stock, s.cap_left, s.family_left) else 0 end)
           order by s.barcode)
    into v_short
    from pg_temp._karmi_state s
   where s.reason is not null
      or (select sum(x.qty) from pg_temp._karmi_state x where x.product_id = s.product_id) > least(s.stock, s.cap_left)
      or (select sum(x.qty) from pg_temp._karmi_state x where x.family = s.family) > s.family_left;
  if v_short is not null then
    return jsonb_build_object('ok', false, 'error', 'not_available', 'message', c_na, 'items', v_short);
  end if;

  insert into karmi_online_holds (ref, product_id, family, qty, expires_at, short_session)
  select p_ref, s.product_id, s.family, s.qty, now() + c_hold, v_short_session from pg_temp._karmi_state s;
  if v_grad > 0 then
    insert into karmi_online_holds (ref, product_id, family, qty, expires_at, short_session)
    values (p_ref, null, 'gradient', v_grad, now() + c_hold, v_short_session);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bc', s.barcode, 'product_id', s.product_id, 'family', s.family,
                                               'price_pence', s.price_pence, 'name', s.line_name,
                                               'online_group', (select k.online_group from karmi_online_products k
                                                                where k.product_id = s.product_id)) order by s.barcode),
                  '[]'::jsonb)
    into v_lines from pg_temp._karmi_state s;

  return jsonb_build_object('ok', true, 'ref', p_ref, 'lines', v_lines,
                            'short_session', v_short_session,
                            'recovery_ok', not v_capped and coalesce((v_win->>'recovery_ok')::boolean, false));
end $$;
commit;
```
Rollback `db/<same>_karmi_online_group_ROLLBACK.sql`:
```sql
begin;
-- previous bodies (db/20261122230000 status, db/20261123090000 reserve)
create or replace function public.fn_karmi_online_status(p_barcodes text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_win jsonb; v_open boolean; v_items jsonb;
begin
  if cardinality(coalesce(p_barcodes, '{}'::text[])) > 200 then
    return jsonb_build_object('error', 'too_many_barcodes');
  end if;
  v_win := fn_karmi__window(0, 0);
  v_open := coalesce((v_win->>'ok')::boolean, false);
  select coalesce(jsonb_object_agg(s.barcode, jsonb_build_object(
           'sellable', case when v_open and s.reason is null then least(s.stock, s.cap_left, s.family_left) else 0 end,
           'stock', case when s.product_id is null then 0 else s.stock end,
           'price_pence', case when s.reason is null then s.price_pence end)), '{}'::jsonb)
    into v_items
    from fn_karmi__state(p_barcodes) s;
  return jsonb_build_object('window', jsonb_build_object('open', v_open, 'message', v_win->>'message'),
                            'items', v_items);
end $$;

create or replace function public.fn_karmi_checkout_reserve(p_ref uuid, p_items jsonb, p_gradient_units int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_grad int := coalesce(p_gradient_units, 0);
  v_units int; v_win jsonb; v_short jsonb; v_lines jsonb; v_capped boolean; v_short_session boolean;
  c_hold constant interval := interval '40 minutes';   -- Stripe session lives 31 min (min allowed 30)
  c_na constant text := 'Not available online right now';
begin
  if p_ref is null or jsonb_typeof(v_items) <> 'array' or v_grad < 0 or v_grad > 99 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Serialise every admission: the count below and the hold insert happen with no other checkout in between.
  perform pg_advisory_xact_lock(hashtext('karmi_online_checkout'));

  if exists (select 1 from karmi_online_holds h where h.ref = p_ref) then
    return jsonb_build_object('ok', false, 'error', 'bad_request', 'message', 'duplicate ref');
  end if;

  create temp table if not exists _karmi_req (bc text primary key, qty int not null) on commit drop;
  truncate pg_temp._karmi_req;
  insert into pg_temp._karmi_req (bc, qty)
  select btrim(e->>'bc'), sum(case when (e->>'qty') ~ '^\s*\d{1,2}\s*$' then (e->>'qty')::int else 0 end)
    from jsonb_array_elements(v_items) e
   where coalesce(btrim(e->>'bc'), '') <> ''
   group by 1;
  delete from pg_temp._karmi_req where qty <= 0;

  select coalesce(sum(qty), 0)::int + v_grad into v_units from pg_temp._karmi_req;
  if v_units < 1 or v_units > 99 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_capped := exists (select 1 from pg_temp._karmi_req);

  v_win := fn_karmi__window(v_units, 1);
  if not (v_win->>'ok')::boolean then
    return v_win;
  end if;
  v_short_session := v_capped or coalesce((v_win->>'short_session')::boolean, true);

  create temp table if not exists _karmi_state on commit drop as
    select s.*, 0 as qty from fn_karmi__state('{}'::text[]) s limit 0;
  truncate pg_temp._karmi_state;
  insert into pg_temp._karmi_state
  select s.*, r.qty from pg_temp._karmi_req r join fn_karmi__state(array(select bc from pg_temp._karmi_req)) s on s.barcode = r.bc;

  -- product-level (all barcodes of one product share its cap and stock) and family-level totals
  select jsonb_agg(jsonb_build_object(
           'bc', s.barcode, 'requested', s.qty,
           'available', case when s.reason is null then least(s.stock, s.cap_left, s.family_left) else 0 end)
           order by s.barcode)
    into v_short
    from pg_temp._karmi_state s
   where s.reason is not null
      or (select sum(x.qty) from pg_temp._karmi_state x where x.product_id = s.product_id) > least(s.stock, s.cap_left)
      or (select sum(x.qty) from pg_temp._karmi_state x where x.family = s.family) > s.family_left;
  if v_short is not null then
    return jsonb_build_object('ok', false, 'error', 'not_available', 'message', c_na, 'items', v_short);
  end if;

  insert into karmi_online_holds (ref, product_id, family, qty, expires_at, short_session)
  select p_ref, s.product_id, s.family, s.qty, now() + c_hold, v_short_session from pg_temp._karmi_state s;
  if v_grad > 0 then
    insert into karmi_online_holds (ref, product_id, family, qty, expires_at, short_session)
    values (p_ref, null, 'gradient', v_grad, now() + c_hold, v_short_session);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bc', s.barcode, 'product_id', s.product_id, 'family', s.family,
                                               'price_pence', s.price_pence, 'name', s.line_name) order by s.barcode),
                  '[]'::jsonb)
    into v_lines from pg_temp._karmi_state s;

  return jsonb_build_object('ok', true, 'ref', p_ref, 'lines', v_lines,
                            'short_session', v_short_session,
                            'recovery_ok', not v_capped and coalesce((v_win->>'recovery_ok')::boolean, false));
end $$;
alter table public.karmi_online_products drop constraint if exists karmi_online_products_online_group_chk;
alter table public.karmi_online_products drop column if exists online_group;
commit;
```
Code side is ready: api/checkout.js uses `line.online_group` first (else ladders.json `family_groups`), api/stock.js
serves `online_group[bc]` in M1 mode and marks a product without a group as not sellable (fail closed).
Tests to add with the migration (tests/caps-sql.test.mjs, pglite): column + check, re-run safe, status/reserve return
`online_group`, rollback restores the previous function bodies.

## Komuta kararları (23-24 Kas) — go-live kontrol maddeleri
- [ ] **families bayrağı KAPALI:** M1 altında `KARMI_STOREFRONT_FAMILIES` OFF (prod + preview); aile kartları M1 fiyat tablosundan okuyana kadar (PR-3) açılmaz (`js/storefront.js` aile kartlarını eski fiyatlıyor). Doğrula: prod `/api/stock` → `storefront.families === false`.
- [ ] **M1 kapısı = CMA209 + K-02 + 'M1 öncesine göre yeni FAIL yok' (regresyon 0).** Canlıda zaten FAIL olan 6 erişilebilirlik maddesi M1'i bloklamaz (ayrı PR, hedef Cum 27).
- [ ] **STOK ŞARTI (go-live günü):** satılabilir kart/adet sayısı (stockroom − tampon 3, stil başına tavan dahil) en az 6 stil ≥10 adet VE toplam ≥150 → değilse £8 tekli + 10'lu sepet satışı pratikte durdurur; Mert'e götür.
- [ ] **İzleme listesi (ilk 2 hafta):** 4–9 ürünlü sipariş sayısı, iade, destek mesajı (9→10 fiyat uçurumu şikâyeti).
