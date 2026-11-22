-- ROLLBACK for 20261123150000_karmi_online_caps_k_items.sql — puts back the N-items (20261123120000) definitions.
-- Deploy order: redeploy the karmi-laven code without the K-items calls FIRST (it calls fn_karmi_paid_unrecorded_due /
-- fn_karmi_paid_unrecorded_mark; with them gone the paid-not-recorded alarm fails and is skipped as best effort).
-- Data loss: none (no table or column was added). fn_karmi_paid_unrecorded (N3) was never changed and stays.
-- After this file the N-items rollback (20261123120000_karmi_online_caps_n_items_ROLLBACK.sql) can run as before.

drop function if exists public.fn_karmi_paid_unrecorded_mark(text[]);
drop function if exists public.fn_karmi_paid_unrecorded_due(interval, int);

-- N-items body (verbatim)
-- Same as #35, plus per product: name (display_name, else the family display_label) and bc (the barcode(s) of this
-- order); per family: name (display_label). Read-only.
create or replace function public.fn_karmi_cap_overshoot(p_session_id text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  with ord as (
    select pb.product_id as pid, string_agg(distinct btrim(it->>'bc'), ',') as bcs
      from online_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
      join product_barcodes pb on pb.barcode = btrim(it->>'bc')
     where o.stripe_session_id = p_session_id
     group by pb.product_id
  ), prods as (
    select k.product_id, k.family, k.unit_cap, ord.bcs,
           coalesce(nullif(btrim(k.display_name), ''), c.display_label) as name
      from ord
      join karmi_online_products k on k.product_id = ord.pid
      join karmi_online_caps c on c.family = k.family
  ), fams as (
    select distinct c.family, c.max_units, c.period_start, c.period_end, c.category_names, c.display_label
      from prods join karmi_online_caps c on c.family = prods.family
  ), sold as (
    select f.family, s.product_id as pid, sum(s.qty)::int as q
      from fams f
      cross join lateral fn_karmi__sold_lines(f.period_start) s
      join products p on p.id = s.product_id
     where p.category_name = any (f.category_names)
       and (f.period_end is null or s.created_at < f.period_end)
     group by 1, 2
  ), held as (
    select h.family, h.product_id as pid, sum(h.qty)::int as q from fn_karmi__open_holds() h group by 1, 2
  ), x as (
    select 'product' as kind, pr.family, pr.product_id, pr.name, pr.bcs as bc, pr.unit_cap as cap,
           coalesce((select sum(s.q) from sold s where s.pid = pr.product_id and s.family = pr.family), 0)::int as sold,
           coalesce((select sum(h.q) from held h where h.pid = pr.product_id), 0)::int as held
      from prods pr
    union all
    select 'family', f.family, null::uuid, f.display_label, null::text, f.max_units,
           coalesce((select sum(s.q) from sold s where s.family = f.family), 0)::int,
           coalesce((select sum(h.q) from held h where h.family = f.family), 0)::int
      from fams f
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', x.kind, 'family', x.family, 'product_id', x.product_id,
                                                        'name', x.name, 'bc', x.bc,
                                                        'cap', x.cap, 'sold', x.sold, 'held', x.held))
                   order by x.kind, x.family, x.product_id)
    into v
    from x
   where x.sold + x.held > x.cap;
  return jsonb_build_object('over', coalesce(v, '[]'::jsonb));
end $$;

revoke all on function public.fn_karmi_cap_overshoot(text) from public, anon, authenticated;
grant execute on function public.fn_karmi_cap_overshoot(text) to service_role;
