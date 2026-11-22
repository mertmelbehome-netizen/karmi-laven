-- ROLLBACK for 20261123120000_karmi_online_caps_n_items.sql — puts back the #35 (20261123090000) definitions.
-- Deploy order: redeploy the karmi-laven code without the N-items calls FIRST (it calls fn_karmi_paid_unrecorded;
-- with it gone that call fails and is skipped as best effort). Data loss: karmi_online_holds.last_checked_at /
-- unrecorded_alarm_at. N4 is NOT undone: the two unlisted stretch_double products stay unlisted (they cannot be
-- priced under F3 anyway); re-list by hand if wanted.
-- After this file the #35 rollback (20261123090000_karmi_online_caps_f1_f3_ROLLBACK.sql) can run as before.

drop function if exists public.fn_karmi_paid_unrecorded(interval, int);

-- #35 bodies (verbatim)
-- Sessions whose outcome the resolver must ask Stripe for: attached, short, past expires_at, not released, not
-- complete, no order row. Oldest first, capped products before Gradient-only.
create or replace function public.fn_karmi_holds_to_check(p_limit int)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select h.stripe_session_id
    from karmi_online_holds h
   where h.released_at is null and h.completed_at is null and h.short_session
     and h.stripe_session_id is not null and h.expires_at <= now()
     and not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id)
   group by h.stripe_session_id
   order by bool_and(h.family = 'gradient'), min(h.created_at)
   limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;

-- Overshoot alarm for one recorded order: every product of the order and every family it touches where
-- sold in the period + open holds > cap. Read-only. Returns {over: [{kind, family, product_id?, cap, sold, held}]}.
create or replace function public.fn_karmi_cap_overshoot(p_session_id text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  with ord as (
    select distinct pb.product_id as pid
      from online_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
      join product_barcodes pb on pb.barcode = btrim(it->>'bc')
     where o.stripe_session_id = p_session_id
  ), prods as (
    select k.product_id, k.family, k.unit_cap from ord join karmi_online_products k on k.product_id = ord.pid
  ), fams as (
    select distinct c.family, c.max_units, c.period_start, c.period_end, c.category_names
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
    select 'product' as kind, pr.family, pr.product_id, pr.unit_cap as cap,
           coalesce((select sum(s.q) from sold s where s.pid = pr.product_id and s.family = pr.family), 0)::int as sold,
           coalesce((select sum(h.q) from held h where h.pid = pr.product_id), 0)::int as held
      from prods pr
    union all
    select 'family', f.family, null::uuid, f.max_units,
           coalesce((select sum(s.q) from sold s where s.family = f.family), 0)::int,
           coalesce((select sum(h.q) from held h where h.family = f.family), 0)::int
      from fams f
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', x.kind, 'family', x.family, 'product_id', x.product_id,
                                                        'cap', x.cap, 'sold', x.sold, 'held', x.held))
                   order by x.kind, x.family, x.product_id)
    into v
    from x
   where x.sold + x.held > x.cap;
  return jsonb_build_object('over', coalesce(v, '[]'::jsonb));
end $$;

alter table public.karmi_online_holds drop column if exists last_checked_at;
alter table public.karmi_online_holds drop column if exists unrecorded_alarm_at;

revoke all on function public.fn_karmi_holds_to_check(int), public.fn_karmi_cap_overshoot(text)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_holds_to_check(int), public.fn_karmi_cap_overshoot(text)
  to service_role;
