-- Karmi sellable stock = WAT display + stockroom (owner rule 27 Nov 2026, Mert: "adeti display artı hub olarak
-- yapabilirsin"; online orders are SENT from display only - ops-v2 #1068 fn_online_sale_event - and what display lacks is
-- brought out by the normal stocking flow first). Lives in the OPS Supabase (shared with ops-v2), like the other db/ files.
--
-- WHAT  CREATE OR REPLACE public.fn_karmi__state(text[]): the live body (read 27 Nov, md5 5ba5763a686c2bc5f49e271a637e2c9a = the
--       20261123232000_karmi_families_prep.sql body) with ONE change in the `stock` column:
--         greatest(0, stockroom_count - stock_buffer - paid - holds)
--      -> greatest(0, stockroom_count + greatest(display_count, 0) - stock_buffer - paid - holds)
--       Buffer (karmi_online_caps.stock_buffer, default 3), paid-not-fulfilled orders, open holds, caps, family caps,
--       every gate, price and the signature / SECURITY DEFINER / SET search_path are unchanged. fn_karmi_online_status
--       (page) and fn_karmi_checkout_reserve (checkout) both read it, so page and checkout agree.
--       Example (O&W + K&D live, 27 Nov): 1468 stockroom 45, display 10 -> stock 42 today, 52 after.
-- Guard: live md5 must be 5ba5763a686c2bc5f49e271a637e2c9a (base) or 56aacae00acfd411ece7b4684e62d0b1 (this body, re-run). Post-check: md5, definer, search_path, server-only.
-- Apply: one transaction (apply_ddl / apply_migration.py), after close. Rollback: db/20261127160000_karmi_state_display_plus_stockroom_ROLLBACK.sql

SET lock_timeout = '3s';

DO $guard$
DECLARE cur text;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO cur FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_karmi__state(text[])');
  IF cur IS NULL THEN RAISE EXCEPTION 'karmi state display+stockroom guard: fn_karmi__state not found'; END IF;
  IF cur NOT IN ('5ba5763a686c2bc5f49e271a637e2c9a', '56aacae00acfd411ece7b4684e62d0b1') THEN
    RAISE EXCEPTION 'karmi state display+stockroom guard: fn_karmi__state changed (md5 %) - rebuild this file from the live body', cur;
  END IF;
END
$guard$;

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
         greatest(0, coalesce(sl.stockroom_count, 0) + greatest(coalesce(sl.display_count, 0), 0) - coalesce(kp.stock_buffer, 3) - coalesce(pd.q, 0)
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

REVOKE EXECUTE ON FUNCTION public.fn_karmi__state(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_karmi__state(text[]) TO service_role;

DO $post$
DECLARE cur text; v_def boolean; v_cfg text[];
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')), p.prosecdef, p.proconfig INTO cur, v_def, v_cfg
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_karmi__state(text[])');
  IF cur IS DISTINCT FROM '56aacae00acfd411ece7b4684e62d0b1' THEN RAISE EXCEPTION 'karmi state display+stockroom post-check: md5 % is not %', cur, '56aacae00acfd411ece7b4684e62d0b1'; END IF;
  IF NOT v_def OR v_cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'karmi state display+stockroom post-check: security changed (definer %, config %)', v_def, v_cfg;
  END IF;
  IF has_function_privilege('anon', 'public.fn_karmi__state(text[])', 'execute') OR has_function_privilege('authenticated', 'public.fn_karmi__state(text[])', 'execute')
     OR NOT has_function_privilege('service_role', 'public.fn_karmi__state(text[])', 'execute') THEN
    RAISE EXCEPTION 'karmi state display+stockroom post-check: EXECUTE is not server-only';
  END IF;
  RAISE NOTICE 'karmi state display+stockroom post-check ok';
END
$post$;

RESET lock_timeout;
