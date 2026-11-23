-- ROLLBACK for 20261123232000_karmi_families_prep.sql — puts back the K-items-era (live 23 Nov 2026) state.
-- Order: (1) close the families first: db/manual/20261123232000_karmi_families_open_ROLLBACK.sql (this file refuses
--   while any touched family is enabled); (2) if PR #47 code is live, it keeps working (it falls back to
--   ladders.json family_groups; no-till-price lines are refused again by the DB); (3) run this file as ONE transaction.
-- What it restores
--   * fn_karmi__state / fn_karmi_online_status / fn_karmi_checkout_reserve: the live bodies (pg_get_functiondef,
--     23 Nov 2026, md5 d5fbac9f… / 39834fbf… / fa7bcc4a…), grants identical (service_role only).
--   * listed=false again on the 10 cards that were unlisted before the prep: 1472, Hair Claws 03010002 03010009
--     03010025 03010035, Sparkle Line 81004 81006 81009 81013 81014.
--   * deletes the 14 karmi_online_products rows the prep created (source 'families-prep 2026-11-23 …').
--   * max_products back: stretch_charm 30, hair 16, diamond 0 (set_by 'O&W 2026-11-22').
--   * drops families stretch_bracelet / necklace_lux / bangle, column karmi_online_products.online_group and table
--     karmi_online_groups.
-- Data loss: the online_group values and the 3 new families' config (re-run the prep file to get them back). Holds and
--   orders are not touched (karmi_online_holds.family is text; a sold line keeps its family name).

do $$
declare v_bad text;
begin
  select string_agg(family, ', ' order by family) into v_bad
    from karmi_online_caps
   where enabled and family in ('stretch_charm', 'hair', 'diamond', 'necklace_lux_stone', 'stretch_double',
                                'stretch_bracelet', 'necklace_lux', 'bangle');
  if v_bad is not null then
    raise exception 'families prep ROLLBACK: close the families first (db/manual/20261123232000_karmi_families_open_ROLLBACK.sql): % enabled', v_bad;
  end if;
end $$;

-- live body (verbatim, pg_get_functiondef 2026-11-23)
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
           c.display_label, c.stock_buffer, c.price_max_age
      from req r
      left join product_barcodes pb on pb.barcode = r.bc
      left join karmi_online_products k on k.product_id = pb.product_id
      left join karmi_online_caps c on c.family = k.family
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
           when fn_karmi__wat_price_pence(kp.pid, kp.price_max_age) is null then 'no_price'
         end,
         fn_karmi__wat_price_pence(kp.pid, kp.price_max_age),
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

-- live body (verbatim, pg_get_functiondef 2026-11-23)
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
           'price_pence', case when s.reason is null then s.price_pence end)), '{}'::jsonb)
    into v_items
    from fn_karmi__state(p_barcodes) s;
  return jsonb_build_object('window', jsonb_build_object('open', v_open, 'message', v_win->>'message'),
                            'items', v_items);
end $function$;

-- live body (verbatim, pg_get_functiondef 2026-11-23)
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
                                               'price_pence', s.price_pence, 'name', s.line_name) order by s.barcode),
                  '[]'::jsonb)
    into v_lines from pg_temp._karmi_state s;

  return jsonb_build_object('ok', true, 'ref', p_ref, 'lines', v_lines,
                            'short_session', v_short_session,
                            'recovery_ok', not v_capped and coalesce((v_win->>'recovery_ok')::boolean, false));
end $function$;

revoke all on function public.fn_karmi__state(text[]), public.fn_karmi_online_status(text[]),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int)
  from public, anon, authenticated;
grant execute on function public.fn_karmi__state(text[]), public.fn_karmi_online_status(text[]),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int)
  to service_role;

do $$
declare c_src constant text := 'families-prep 2026-11-23 (O&W cards, merch 05 caps)';
begin
  update karmi_online_products k set listed = false
    from product_barcodes pb
   where pb.product_id = k.product_id and k.listed
     and pb.barcode in ('1472', '03010002', '03010009', '03010025', '03010035',
                        '81004', '81006', '81009', '81013', '81014');
  delete from karmi_online_products where source = c_src;
  update karmi_online_caps c set max_products = v.mp, set_by = 'O&W 2026-11-22'
    from (values ('stretch_charm', 30), ('hair', 16), ('diamond', 0)) v(family, mp)
   where c.family = v.family and c.max_products > v.mp;
  delete from karmi_online_caps
   where family in ('stretch_bracelet', 'necklace_lux', 'bangle')
     and not exists (select 1 from karmi_online_products k where k.family = karmi_online_caps.family);
end $$;

alter table public.karmi_online_products drop column if exists online_group;
drop table if exists public.karmi_online_groups;
