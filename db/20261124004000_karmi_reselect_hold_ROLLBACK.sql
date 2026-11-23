-- Rollback of 20261124004000_karmi_reselect_hold.sql: the reselect body of db/20261122230000 (no hold check).
-- After this, do NOT run fn_karmi_online_reselect('stretch_double') while 0624 is held (K-068).
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
  )
  update karmi_online_products k set listed = true, set_by = 'fn_karmi_online_reselect'
    from elig where elig.product_id = k.product_id and elig.rn <= v_max;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.fn_karmi_online_reselect(text) is null;

do $$ begin raise notice 'karmi reselect hold rollback ok'; end $$;
