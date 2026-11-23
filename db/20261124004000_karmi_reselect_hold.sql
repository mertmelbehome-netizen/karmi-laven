-- Karmi: fn_karmi_online_reselect never re-lists a product on a command-centre hold (23 Nov 2026).
--
-- Why: 0624 was unlisted at 15:06 on 23 Nov (karmi_online_products listed=false, set_by 'komuta hold 0624
-- name/price (K-068) 2026-11-23'): online it read "Stretch Bracelet" at £13 (group C) next to seven £5 "Stretch
-- Bracelet" cards (group A). The reselect function first unlists the whole family, then lists the top
-- max_products by 28-day sales; run by hand for 'stretch_double' it would have listed 0624 again.
-- Rule: a row whose set_by starts with 'komuta hold' is skipped by the reselect (it stays as it is, unlisted).
-- Releasing a hold = a manual update (listed = true, set_by = '<who> release <why>'), never the reselect.
-- K-068 (Mert: 0624 group A £5, or its own name at £13) decides when 0624 comes back.
-- Body = db/20261122230000 + one condition. Same signature, SECURITY DEFINER, search_path, grants.
-- Guard: the live body must be the one read on 23 Nov 2026 (md5 of prosrc without CR 616db4f08a4838fa3a3e7ce44495d80a),
-- or this migration's own body (re-run).
-- Rollback: db/20261124004000_karmi_reselect_hold_ROLLBACK.sql

do $$
declare v_src text;
begin
  select replace(prosrc, chr(13), '') into v_src from pg_proc where oid = 'public.fn_karmi_online_reselect(text)'::regprocedure;
  if md5(v_src) <> '616db4f08a4838fa3a3e7ce44495d80a' and position('komuta hold%' in v_src) = 0 then
    raise exception 'fn_karmi_online_reselect body changed since 2026-11-23 (md5 %): rebase this migration on it', md5(v_src);
  end if;
end $$;

create or replace function public.fn_karmi_online_reselect(p_family text)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_max int; v_age interval; v_n int;
begin
  select c.max_products, c.price_max_age into v_max, v_age from karmi_online_caps c where c.family = p_family;
  if not found then raise exception 'unknown family %', p_family; end if;
  update karmi_online_products set listed = false, set_by = 'fn_karmi_online_reselect'
   where family = p_family and listed;
  with sales as (
    select pb.product_id, sum(d.qty) as q
      from pos_daily_item_sales d join product_barcodes pb on pb.barcode = d.barcode
     where d.store_id in ('WAT', 'GUI') and d.sale_date >= current_date - 28
     group by 1
  ), elig as (
    select k.product_id,
           row_number() over (order by coalesce(s.q, 0) desc, sl.stockroom_count desc, k.product_id) as rn
      from karmi_online_products k
      join stock_levels sl on sl.product_id = k.product_id and sl.store_id = 'WAT'
      left join sales s on s.product_id = k.product_id
     where k.family = p_family and k.unit_cap >= 3 and sl.stockroom_count > 0
       and fn_karmi__wat_price_pence(k.product_id, v_age) is not null
       -- a product put on hold by the command centre stays unlisted (23 Nov 2026: 0624, K-068)
       and coalesce(k.set_by, '') not like 'komuta hold%'
  )
  update karmi_online_products k set listed = true, set_by = 'fn_karmi_online_reselect'
    from elig where elig.product_id = k.product_id and elig.rn <= v_max;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.fn_karmi_online_reselect(text) is
  'Re-pick the listed products of one family. Skips set_by ''komuta hold%'' rows (23 Nov 2026: 0624 held until K-068).';

do $$
begin
  if position('komuta hold%' in (select prosrc from pg_proc where oid = 'public.fn_karmi_online_reselect(text)'::regprocedure)) = 0 then
    raise exception 'reselect hold guard missing';
  end if;
  raise notice 'karmi reselect hold post-check ok';
end $$;
