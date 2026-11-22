-- karmi_online_caps K1 / K3 (K&D review of PR #36, 23 Nov 2026:
--  agents/quality-audit/outputs/2026-11-23_karmi_pr36_review.md). Applies on top of #34 (20261122230000), #35
--  (20261123090000) and N-items (20261123120000). Idempotent (apply twice = same objects). Apply with apply_ddl, as one
--  transaction (-1 / ON_ERROR_STOP), so a refused guard leaves nothing half-applied.
-- Rollback: db/20261123150000_karmi_online_caps_k_items_ROLLBACK.sql (restores the N-items functions).
-- Deploy order: apply THIS FILE FIRST, then deploy the karmi-laven code that calls the two new functions. The old code
--   keeps working meanwhile: fn_karmi_paid_unrecorded (N3, marks while it reads) is left exactly as it is for it.
--
-- K1 — the paid-not-recorded alarm marked a session as alarmed BEFORE the push went out (and a failed / frozen push
--   left it silent for 24 h). Split into
--     fn_karmi_paid_unrecorded_due(min_age, limit)  READ-ONLY: what is due + the full count, marks nothing;
--     fn_karmi_paid_unrecorded_mark(session_ids)    stamps unrecorded_alarm_at on exactly the sessions the push named,
--   and api/_caps-lib.js calls the mark only after /api/orders/notify answered 2xx.
-- K3 — fn_karmi_cap_overshoot: each product row also carries family_name (the family display_label), so the alarm's
--   product line says which family it belongs to.
-- (K2 — Stripe 404 mode check + burst guard — is code only: api/_caps-lib.js.)

-- ───────────────────────────── needs N-items ─────────────────────────────
do $$
begin
  if to_regprocedure('public.fn_karmi_paid_unrecorded(interval, int)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'karmi_online_holds'
                       and column_name = 'unrecorded_alarm_at') then
    raise exception 'karmi_online_caps K-items: apply db/20261123120000_karmi_online_caps_n_items.sql first';
  end if;
end $$;

-- ───────────────────────────── K1: due list, read-only ─────────────────────────────
-- Paid holds (completed_at) older than p_min_age (at least 30 min) whose session still has no online_orders row and
-- that have not been alarmed in the last 24 h. Marks NOTHING. Returns
--   {total: <number of due sessions>, items: [{session, completed_at, units, lines: [{name, bc, family, qty}]}]}
-- with items = the oldest p_limit (1..50) of them.
create or replace function public.fn_karmi_paid_unrecorded_due(p_min_age interval, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_total int;
  v_age interval := greatest(coalesce(p_min_age, interval '2 hours'), interval '30 minutes');
begin
  with all_due as (
    select h.stripe_session_id as sid, min(h.completed_at) as completed_at
      from karmi_online_holds h
     where h.released_at is null and h.completed_at is not null and h.stripe_session_id is not null
       and h.completed_at < now() - v_age
       and not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id)
     group by h.stripe_session_id
    having max(h.unrecorded_alarm_at) is null or max(h.unrecorded_alarm_at) < now() - interval '24 hours'
  ), due as (
    select * from all_due order by completed_at, sid limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), lines as (
    select due.sid, due.completed_at, h.family,
           case when h.product_id is null then 'Gradient Edit'
                else coalesce(nullif(btrim(k.display_name), ''), c.display_label, h.family) end as name,
           (select min(pb.barcode) from product_barcodes pb where pb.product_id = h.product_id) as bc,
           sum(h.qty)::int as qty
      from due
      join karmi_online_holds h on h.stripe_session_id = due.sid and h.released_at is null
      left join karmi_online_products k on k.product_id = h.product_id
      left join karmi_online_caps c on c.family = h.family
     group by due.sid, due.completed_at, h.family, h.product_id, k.display_name, c.display_label
  )
  select (select count(*)::int from all_due),
         (select jsonb_agg(jsonb_build_object('session', x.sid, 'completed_at', x.completed_at, 'units', x.units,
                                              'lines', x.lines) order by x.completed_at, x.sid)
            from (select l.sid, l.completed_at, sum(l.qty)::int as units,
                         jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', l.name, 'bc', l.bc, 'family', l.family,
                                                                        'qty', l.qty)) order by l.family, l.bc) as lines
                    from lines l group by l.sid, l.completed_at) x)
    into v_total, v;
  return jsonb_build_object('total', coalesce(v_total, 0), 'items', coalesce(v, '[]'::jsonb));
end $$;

-- ───────────────────────────── K1: mark what the push named ─────────────────────────────
-- Called only after the notify push answered 2xx, with the session ids that push named. Stamps unrecorded_alarm_at on
-- their open paid holds (the next alarm for them comes after 24 h). Returns the number of sessions stamped.
create or replace function public.fn_karmi_paid_unrecorded_mark(p_session_ids text[])
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with s as (
    update karmi_online_holds h set unrecorded_alarm_at = now()
     where h.stripe_session_id = any (coalesce(p_session_ids, '{}'::text[]))
       and h.released_at is null and h.completed_at is not null
    returning h.stripe_session_id
  )
  select count(distinct s.stripe_session_id)::int into n from s;
  return n;
end $$;

-- ───────────────────────────── K3: overshoot product rows carry the family name ─────────────────────────────
-- Same as N-items, plus family_name (the family display_label) on product rows. Read-only.
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
    select k.product_id, k.family, k.unit_cap, ord.bcs, c.display_label as family_name,
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
    select 'product' as kind, pr.family, pr.family_name, pr.product_id, pr.name, pr.bcs as bc, pr.unit_cap as cap,
           coalesce((select sum(s.q) from sold s where s.pid = pr.product_id and s.family = pr.family), 0)::int as sold,
           coalesce((select sum(h.q) from held h where h.pid = pr.product_id), 0)::int as held
      from prods pr
    union all
    select 'family', f.family, null::text, null::uuid, f.display_label, null::text, f.max_units,
           coalesce((select sum(s.q) from sold s where s.family = f.family), 0)::int,
           coalesce((select sum(h.q) from held h where h.family = f.family), 0)::int
      from fams f
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', x.kind, 'family', x.family, 'family_name', x.family_name,
                                                        'product_id', x.product_id, 'name', x.name, 'bc', x.bc,
                                                        'cap', x.cap, 'sold', x.sold, 'held', x.held))
                   order by x.kind, x.family, x.product_id)
    into v
    from x
   where x.sold + x.held > x.cap;
  return jsonb_build_object('over', coalesce(v, '[]'::jsonb));
end $$;

-- ───────────────────────────── grants (service_role only, as in #34 / #35 / N) ─────────────────────────────
revoke all on function public.fn_karmi_paid_unrecorded_due(interval, int), public.fn_karmi_paid_unrecorded_mark(text[]),
  public.fn_karmi_cap_overshoot(text)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_paid_unrecorded_due(interval, int), public.fn_karmi_paid_unrecorded_mark(text[]),
  public.fn_karmi_cap_overshoot(text)
  to service_role;
