-- Karmi families PREP (23 Nov 2026, command centre: open B + C + A later; O&W card list, 42 styles, photo_qc=true).
-- Applies on top of #34 (20261122230000), #35 (20261123090000), N-items (20261123120000) and K-items (20261123150000).
-- Lives in the OPS Supabase (shared with ops-v2), like the other db/ files. Apply with apply_ddl, as ONE transaction
-- (-1 / ON_ERROR_STOP), so a refused guard leaves nothing half-applied. Idempotent (apply twice = same state).
-- Rollback: db/20261123232000_karmi_families_prep_ROLLBACK.sql
-- Stamp 20261123232000: assigned centrally (later than this repo's 20261123150000 and every ops-v2 stamp up to 231000).
--
-- FAMILIES STAY CLOSED. This file never sets karmi_online_caps.enabled = true; the 3 new families are created
-- enabled=false. Opening is a separate, owner-chosen step: db/manual/20261123232000_karmi_families_open.sql.
--
-- What it does
--   1. karmi_online_groups (NEW): the M1 online price groups (ladders.json M1-2026-11-25, mode cart_qty_groups):
--      A 500 / 150, B 800 / 240, C 1300 / 390 pence (single / each at 10+). active = the DB prices a grouped product
--      from its group (M1). Pools mode (code rolled back to a pools table) = `update karmi_online_groups set
--      active = false`: every product falls back to the WAT till price exactly as before this file.
--   2. karmi_online_products.online_group (NEW column, FK to karmi_online_groups).
--   3. fn_karmi__state: under an ACTIVE group the price is the group single price, so 'no_price' no longer blocks a
--      product WITH a group (the till price is not needed). A product with no group (or an inactive group) keeps the
--      WAT till price and the 'no_price' gate. Every other gate (family_closed, not_listed, over_variety, caps,
--      stock) is unchanged and still comes first. Signature unchanged.
--   4. fn_karmi_online_status: an item that passes every gate also carries family + online_group (PR #47 /api/stock
--      reads it.online_group). Closed / refused items are byte-for-byte as before.
--   5. fn_karmi_checkout_reserve: each admitted line also carries online_group (PR #47 checkout lineGroup()).
--   6. Families: new stretch_bracelet (A, 3,450 units), necklace_lux (B "Bead Necklace", 1,420), bangle (C, 654);
--      unit caps from merch 05_caps_new_categories (orchestrator/projects/2026-11-23_karmi-relaunch/morning_review).
--      max_products of stretch_charm / hair / diamond is raised ONLY to what the listed cards need.
--   7. The 42 cards: a karmi_online_products row each (13 new), online_group set, listed = true (1472, the 4 unlisted
--      Hair Claws and the 5 Sparkle Line styles were listed=false). Existing unit_cap / display_name are kept.
--      Every card barcode must exist in products with the family's category (else the whole file is refused).
-- Base bodies: pg_get_functiondef on the live DB, 23 Nov 2026 (md5 guard below; CR-normalised so a CRLF checkout of
-- the repo chain matches the LF live text).

-- ───────────────────────────── guards: K-items applied, live bodies are the ones this file is based on ─────────────
do $$
declare
  r record;
begin
  if to_regprocedure('public.fn_karmi_paid_unrecorded_due(interval, int)') is null then
    raise exception 'karmi families prep: apply db/20261123150000_karmi_online_caps_k_items.sql first';
  end if;
  for r in
    select * from (values
      ('public.fn_karmi__state(text[])',                    'd5fbac9f42f598025e16cd59e78fbbc7', '5ba5763a686c2bc5f49e271a637e2c9a'),
      ('public.fn_karmi_online_status(text[])',             '39834fbf2c5cd1d3282feeed048802b6', 'c6612bd15f4071697bd4f917c133b8f9'),
      ('public.fn_karmi_checkout_reserve(uuid,jsonb,integer)', 'fa7bcc4ae4bb989955d162d85f0eca0a', 'e9cb3e4846541a9fe2cdd2a6b9ceeb7b')
    ) v(sig, base_md5, prep_md5)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception 'karmi families prep: % is missing', r.sig;
    end if;
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(r.sig))
       not in (r.base_md5, r.prep_md5) then
      raise exception 'karmi families prep: live body of % differs from the one this file is based on (md5 %); re-read it with pg_get_functiondef and rebase',
        r.sig, (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(r.sig));
    end if;
  end loop;
end $$;

-- ───────────────────────────── 1. price groups (M1) ─────────────────────────────
create table if not exists public.karmi_online_groups (
  online_group    text primary key check (online_group ~ '^[A-Z]$'),
  label           text not null,
  single_pence    int  not null check (single_pence > 0),
  tier_each_pence int  not null check (tier_each_pence > 0 and tier_each_pence <= single_pence),
  active          boolean not null default true,
  ladders_version text not null,
  set_by          text not null,
  updated_at      timestamptz not null default now()
);
comment on table public.karmi_online_groups is
  'Karmi M1 online price groups (= ladders.json groups). active: the DB prices a grouped product from its group '
  '(no till price needed). All inactive = pools mode (WAT till price, no_price gate). Change together with ladders.json.';

insert into public.karmi_online_groups (online_group, label, single_pence, tier_each_pence, ladders_version, set_by)
values ('A', 'Stretch Bracelet', 500, 150, 'M1-2026-11-25', 'command centre 2026-11-23 (K-046)'),
       ('B', 'Gradient Edit, Stretch Charm, Hair Clips, Necklace Lux', 800, 240, 'M1-2026-11-25', 'command centre 2026-11-23 (K-046)'),
       ('C', 'Sparkle Line, Hair Claws, Charm Necklace, Stretch Double, Bangle', 1300, 390, 'M1-2026-11-25', 'command centre 2026-11-23 (K-046)')
on conflict (online_group) do nothing;

alter table public.karmi_online_groups enable row level security;
-- No policies on purpose (as #34): browser roles see nothing; service_role bypasses RLS.
revoke all on table public.karmi_online_groups from public, anon, authenticated;
grant select, insert, update, delete on table public.karmi_online_groups to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ops_reader') then
    execute 'grant select on table public.karmi_online_groups to ops_reader';
  end if;
end $$;

-- ───────────────────────────── 2. per-product group ─────────────────────────────
alter table public.karmi_online_products
  add column if not exists online_group text references public.karmi_online_groups(online_group) on update cascade;

-- ───────────────────────────── 3. fn_karmi__state: group price lifts no_price ─────────────────────────────
-- Live body + (a) kp.grp_pence = single price of the product's ACTIVE group, (b) price = coalesce(group, WAT till).
CREATE OR REPLACE FUNCTION public.fn_karmi__state(p_barcodes text[])
 RETURNS TABLE(barcode text, product_id uuid, family text, reason text, price_pence integer, line_name text, stock integer, cap_left integer, family_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with req as (
    select distinct btrim(b) as bc from unnest(coalesce(p_barcodes, '{}'::text[])) b where btrim(b) <> ''
  ), kp as (
    select r.bc, pb.product_id as pid, k.family, k.unit_cap, k.listed, k.display_name,
           c.enabled, c.max_products, c.max_units, c.period_start, c.period_end, c.category_names,
           c.display_label, c.stock_buffer, c.price_max_age,
           g.single_pence as grp_pence   -- M1: the product's ACTIVE online group sets the price (no till price needed)
      from req r
      left join product_barcodes pb on pb.barcode = r.bc
      left join karmi_online_products k on k.product_id = pb.product_id
      left join karmi_online_caps c on c.family = k.family
      left join karmi_online_groups g on g.online_group = k.online_group and g.active
  ), holds as (
    select * from fn_karmi__open_holds()
  ), fam as (
    select distinct kp.family, kp.period_start, kp.period_end, kp.category_names from kp where kp.family is not null
  ), sold_pf as (
    select fam.family, s.product_id as pid, sum(s.qty)::int as q
      from fam
      cross join lateral fn_karmi__sold_lines(fam.period_start) s
      join products p on p.id = s.product_id
     where p.category_name = any (fam.category_names)
       and (fam.period_end is null or s.created_at < fam.period_end)
     group by 1, 2
  ), paid as (   -- paid-but-not-fulfilled orders are still in the WAT stockroom (same rule as api/_stock-lib.js)
    select pb.product_id as pid, sum(case when (it->>'qty') ~ '^\s*\d{1,4}\s*$' then (it->>'qty')::int else 0 end)::int as q
      from online_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
      join product_barcodes pb on pb.barcode = btrim(it->>'bc')
     where o.status = 'paid' and o.store_id = 'WAT'
     group by 1
  ), listed_n as (
    select k.family, count(*)::int as n from karmi_online_products k where k.listed group by 1
  )
  select kp.bc,
         kp.pid,
         kp.family,
         case
           when kp.pid is null then 'unknown_barcode'
           when kp.family is null then 'not_configured'
           when not kp.enabled then 'family_closed'
           when now() < kp.period_start or (kp.period_end is not null and now() >= kp.period_end) then 'family_closed'
           when not kp.listed then 'not_listed'
           when coalesce(ln.n, 0) > kp.max_products then 'over_variety'
           when coalesce(kp.grp_pence, fn_karmi__wat_price_pence(kp.pid, kp.price_max_age)) is null then 'no_price'
         end,
         coalesce(kp.grp_pence, fn_karmi__wat_price_pence(kp.pid, kp.price_max_age)),
         coalesce(nullif(btrim(kp.display_name), ''), kp.display_label),
         greatest(0, coalesce(sl.stockroom_count, 0) - coalesce(kp.stock_buffer, 3) - coalesce(pd.q, 0)
                     - coalesce((select sum(h.qty) from holds h where h.product_id = kp.pid), 0))::int,
         greatest(0, coalesce(kp.unit_cap, 0)
                     - coalesce((select sum(x.q) from sold_pf x where x.pid = kp.pid), 0)
                     - coalesce((select sum(h.qty) from holds h where h.product_id = kp.pid), 0))::int,
         greatest(0, coalesce(kp.max_units, 0)
                     - coalesce((select sum(x.q) from sold_pf x where x.family = kp.family), 0)
                     - coalesce((select sum(h.qty) from holds h where h.family = kp.family), 0))::int
    from kp
    left join stock_levels sl on sl.product_id = kp.pid and sl.store_id = 'WAT'
    left join paid pd on pd.pid = kp.pid
    left join listed_n ln on ln.family = kp.family
$function$;

-- ───────────────────────────── 4. fn_karmi_online_status: + family / online_group on sellable items ─────────────
CREATE OR REPLACE FUNCTION public.fn_karmi_online_status(p_barcodes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           'price_pence', case when s.reason is null then s.price_pence end)
           -- M1 (PR #47 /api/stock): only an item that passed every gate names its family and ACTIVE online group
           || case when s.reason is null
                   then jsonb_strip_nulls(jsonb_build_object('family', s.family, 'online_group', g.online_group))
                   else '{}'::jsonb end), '{}'::jsonb)
    into v_items
    from fn_karmi__state(p_barcodes) s
    left join karmi_online_products k on k.product_id = s.product_id
    left join karmi_online_groups g on g.online_group = k.online_group and g.active;
  return jsonb_build_object('window', jsonb_build_object('open', v_open, 'message', v_win->>'message'),
                            'items', v_items);
end $function$;

-- ───────────────────────────── 5. fn_karmi_checkout_reserve: + online_group on each line ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_karmi_checkout_reserve(p_ref uuid, p_items jsonb, p_gradient_units integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                               -- M1 (PR #47 lineGroup): the product's ACTIVE online group, else null
                                               'online_group', (select g.online_group from karmi_online_products k
                                                                  join karmi_online_groups g
                                                                    on g.online_group = k.online_group and g.active
                                                                 where k.product_id = s.product_id))
                            order by s.barcode),
                  '[]'::jsonb)
    into v_lines from pg_temp._karmi_state s;

  return jsonb_build_object('ok', true, 'ref', p_ref, 'lines', v_lines,
                            'short_session', v_short_session,
                            'recovery_ok', not v_capped and coalesce((v_win->>'recovery_ok')::boolean, false));
end $function$;

-- grants: identical to #34 (service_role only)
revoke all on function public.fn_karmi__state(text[]), public.fn_karmi_online_status(text[]),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int)
  from public, anon, authenticated;
grant execute on function public.fn_karmi__state(text[]), public.fn_karmi_online_status(text[]),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int)
  to service_role;

-- ───────────────────────────── 6 + 7. families and the 42 cards (all families stay CLOSED) ─────────────────────────
do $$
declare
  c_src constant text := 'families-prep 2026-11-23 (O&W cards, merch 05 caps)';
  v_ref record;
  v_bad text;
begin
  -- new families copy the wave-1 period / buffer / price age from stretch_charm (one Christmas period for all)
  select period_start, period_end, stock_buffer, price_max_age into v_ref
    from karmi_online_caps where family = 'stretch_charm';
  if not found then
    raise exception 'karmi families prep: family stretch_charm missing (apply #34 first)';
  end if;
  insert into karmi_online_caps (family, category_names, display_label, max_products, max_units, enabled,
                                 period_start, period_end, stock_buffer, price_max_age, note, set_by)
  values
    ('stretch_bracelet', array['Stretch Bracelet'], 'Stretch Bracelet', 7, 3450, false,
     v_ref.period_start, v_ref.period_end, v_ref.stock_buffer, v_ref.price_max_age,
     'group A; max_units = merch 05 family cap', c_src),
    ('necklace_lux', array['Necklace Lux'], 'Bead Necklace', 4, 1420, false,
     v_ref.period_start, v_ref.period_end, v_ref.stock_buffer, v_ref.price_max_age,
     'group B; max_units = merch 05 family cap', c_src),
    ('bangle', array['Bangle Bracelet'], 'Bangle Bracelet', 2, 654, false,
     v_ref.period_start, v_ref.period_end, v_ref.stock_buffer, v_ref.price_max_age,
     'group C; max_units = merch 05 family cap', c_src)
  on conflict (family) do nothing;

  -- the 42 cards: barcode, family, group, unit_cap for the 14 NEW rows (merch 05 per-style cap; 2000 = merch 06 newcap)
  create temp table _kfp_cards (bc text primary key, family text not null, grp text not null, new_cap int)   -- null = row exists today, keep its unit_cap
    on commit drop;
  insert into _kfp_cards values
    -- A · Stretch Bracelet
    ('6002', 'stretch_bracelet', 'A', 40), ('6008', 'stretch_bracelet', 'A', 40), ('6009', 'stretch_bracelet', 'A', 40),
    ('6011', 'stretch_bracelet', 'A', 40), ('6017', 'stretch_bracelet', 'A', 53), ('6042', 'stretch_bracelet', 'A', 23),
    ('6058', 'stretch_bracelet', 'A', 40),
    -- B · Stretch Charm
    ('2023', 'stretch_charm', 'B', null), ('2040', 'stretch_charm', 'B', null), ('1468', 'stretch_charm', 'B', null),
    ('1470', 'stretch_charm', 'B', null), ('1472', 'stretch_charm', 'B', null), ('1474', 'stretch_charm', 'B', null),
    ('1477', 'stretch_charm', 'B', null), ('2000', 'stretch_charm', 'B', 5),
    -- B · Hair Clips (family hair)
    ('1849', 'hair', 'B', null), ('1850', 'hair', 'B', null), ('1854', 'hair', 'B', null), ('1859', 'hair', 'B', null),
    ('1863', 'hair', 'B', null), ('1864', 'hair', 'B', null), ('1865', 'hair', 'B', null),
    -- B · Necklace Lux "Bead Necklace" (6093 left out: photo FAIL)
    ('7058', 'necklace_lux', 'B', 55), ('7056', 'necklace_lux', 'B', 31), ('6095', 'necklace_lux', 'B', 26),
    ('6091', 'necklace_lux', 'B', 34),
    -- C · Charm Necklace (necklace_lux_stone)
    ('6159', 'necklace_lux_stone', 'C', null), ('6170', 'necklace_lux_stone', 'C', null), ('6180', 'necklace_lux_stone', 'C', null),
    -- C · Stretch Double
    ('0624', 'stretch_double', 'C', null),
    -- C · Bangle
    ('80012', 'bangle', 'C', 34), ('80043', 'bangle', 'C', 15),
    -- C · Hair Claws (family hair)
    ('03010002', 'hair', 'C', null), ('03010009', 'hair', 'C', null), ('03010013', 'hair', 'C', null),
    ('03010025', 'hair', 'C', null), ('03010035', 'hair', 'C', null),
    -- C · Sparkle Line (diamond)
    ('81004', 'diamond', 'C', null), ('81006', 'diamond', 'C', null), ('81009', 'diamond', 'C', null),
    ('81013', 'diamond', 'C', null), ('81014', 'diamond', 'C', null);

  -- every card barcode must exist, be one product per card, and (if configured) sit in the family the card says
  select string_agg(c.bc, ', ' order by c.bc) into v_bad
    from _kfp_cards c left join product_barcodes pb on pb.barcode = c.bc where pb.product_id is null;
  if v_bad is not null then
    raise exception 'karmi families prep: card barcode(s) not in product_barcodes: %', v_bad;
  end if;
  select string_agg(c.bc || ' (' || k.family || ')', ', ' order by c.bc) into v_bad
    from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc
    join karmi_online_products k on k.product_id = pb.product_id
   where k.family <> c.family;
  if v_bad is not null then
    raise exception 'karmi families prep: card already configured in another family: %', v_bad;
  end if;
  select string_agg(c.bc || ' (' || coalesce(k.online_group, '?') || ')', ', ' order by c.bc) into v_bad
    from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc
    join karmi_online_products k on k.product_id = pb.product_id
   where k.online_group is not null and k.online_group <> c.grp;
  if v_bad is not null then
    raise exception 'karmi families prep: card already has another online_group: %', v_bad;
  end if;
  select string_agg(c.bc, ', ' order by c.bc) into v_bad
    from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc
   where c.new_cap is null and not exists (select 1 from karmi_online_products k where k.product_id = pb.product_id);
  if v_bad is not null then
    raise exception 'karmi families prep: no karmi_online_products row and no unit cap for: %', v_bad;
  end if;
  if (select count(distinct pb.product_id) from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc)
     <> (select count(*) from _kfp_cards) then
    raise exception 'karmi families prep: two card barcodes share one product';
  end if;

  -- variety: raise max_products only as far as the listed cards need (never lowers it)
  update karmi_online_caps f
     set max_products = need.n, set_by = c_src
    from (select fam.family,
                 (select count(*) from karmi_online_products k
                   where k.family = fam.family and k.listed
                     and k.product_id not in (select pb.product_id from _kfp_cards c
                                                join product_barcodes pb on pb.barcode = c.bc))::int
                 + (select count(*) from _kfp_cards c where c.family = fam.family)::int as n
            from (select distinct family from _kfp_cards) fam) need
   where f.family = need.family and f.max_products < need.n;

  -- rows: create the missing ones (listed, grouped, merch cap); existing ones get listed + online_group only
  insert into karmi_online_products (product_id, family, unit_cap, listed, online_group, source, set_by)
  select pb.product_id, c.family, c.new_cap, true, c.grp, c_src, c_src
    from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc
   where c.new_cap is not null
  on conflict (product_id) do nothing;
  update karmi_online_products k
     set listed = true, online_group = c.grp
    from _kfp_cards c join product_barcodes pb on pb.barcode = c.bc
   where k.product_id = pb.product_id
     and (not k.listed or k.online_group is distinct from c.grp);

  drop table pg_temp._kfp_cards;
end $$;
