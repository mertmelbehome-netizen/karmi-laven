-- karmi_online_caps N1–N6 (K&D review of PR #35, 23 Nov 2026:
--  agents/quality-audit/outputs/2026-11-23_karmi_pr35_review.md). Applies on top of
--  db/20261122230000_karmi_online_caps.sql (#34) and db/20261123090000_karmi_online_caps_f1_f3.sql (#35).
-- Idempotent (apply twice = same objects). Apply with apply_ddl.
-- Rollback: db/20261123120000_karmi_online_caps_n_items_ROLLBACK.sql (restores the #35 functions).
--
-- N1 — the resolver no longer gets stuck on the same 10 sessions. fn_karmi_holds_to_check now hands out the
--   LEAST-RECENTLY-CHECKED sessions first and stamps karmi_online_holds.last_checked_at on what it returns, so a
--   session Stripe cannot answer (timeout, error) goes to the back of the queue instead of blocking the head.
--   (api/_caps-lib.js also treats a Stripe 404 / resource_missing session as expired → the hold is freed.)
-- N3 — fn_karmi_paid_unrecorded: a hold whose Stripe session is paid (completed_at) but has had no online_orders
--   row for p_min_age (2 h) is reported for an alarm (push + log, api/_caps-lib.js). At most once per session per
--   24 h (karmi_online_holds.unrecorded_alarm_at). The hold KEEPS COUNTING — nothing is released or refunded.
-- N4 — the seed listed 2 stretch_double products (0562, 0905) whose second barcode has no WAT till price (F3 makes
--   them not sellable, but they held 2 of the 14 variety slots). Unlisted here; rule-based, so it is idempotent.
--   The free slots are NOT refilled automatically (O&W tone-group choices stay): fn_karmi_online_reselect or a
--   manual UPDATE does that.
-- N5 — the #34 / #35 files now refuse to run on top of a later migration (guards at the top of those files);
--   this file refuses to run without #35.
-- N6 — fn_karmi_cap_overshoot also returns the customer-safe product name and the ordered barcode(s).

-- ───────────────────────────── needs #35 ─────────────────────────────
do $$
begin
  if to_regprocedure('public.fn_karmi_checkout_resolve(text, text)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'karmi_online_holds' and column_name = 'completed_at') then
    raise exception 'karmi_online_caps N-items: apply db/20261123090000_karmi_online_caps_f1_f3.sql first';
  end if;
end $$;

-- ───────────────────────────── holds: check / alarm stamps ─────────────────────────────
alter table public.karmi_online_holds add column if not exists last_checked_at     timestamptz;  -- N1
alter table public.karmi_online_holds add column if not exists unrecorded_alarm_at timestamptz;  -- N3

-- ───────────────────────────── N1: least-recently-checked first ─────────────────────────────
-- Sessions whose outcome the resolver must ask Stripe for: attached, short, past expires_at, not released, not
-- complete, no order row. Never-checked first, then least recently checked; capped products before Gradient-only;
-- then oldest. Every session returned is stamped as checked NOW, whatever Stripe answers afterwards, so an
-- unanswerable session cannot keep newer ones from being checked.
create or replace function public.fn_karmi_holds_to_check(p_limit int)
returns setof text language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select h.stripe_session_id as sid, max(h.last_checked_at) as last_chk,
           bool_and(h.family = 'gradient') as grad_only, min(h.created_at) as first_at
      from karmi_online_holds h
     where h.released_at is null and h.completed_at is null and h.short_session
       and h.stripe_session_id is not null and h.expires_at <= now()
       and not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id)
     group by h.stripe_session_id
     order by max(h.last_checked_at) nulls first, bool_and(h.family = 'gradient'), min(h.created_at)
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), stamp as (
    update karmi_online_holds h set last_checked_at = now()
      from due where h.stripe_session_id = due.sid and h.released_at is null
    returning h.id
  )
  select due.sid from due order by due.last_chk nulls first, due.grad_only, due.first_at;
end $$;

-- ───────────────────────────── N3: paid but never recorded ─────────────────────────────
-- Paid holds (completed_at) older than p_min_age (at least 30 min) whose session still has no online_orders row and
-- that have not been alarmed in the last 24 h. Stamps unrecorded_alarm_at on what it returns. Changes nothing else:
-- the hold keeps counting until someone checks the order by hand.
-- Returns {items: [{session, completed_at, units, lines: [{name, bc, family, qty}]}]}.
create or replace function public.fn_karmi_paid_unrecorded(p_min_age interval, p_limit int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_age interval := greatest(coalesce(p_min_age, interval '2 hours'), interval '30 minutes');
begin
  with due as (
    select h.stripe_session_id as sid, min(h.completed_at) as completed_at
      from karmi_online_holds h
     where h.released_at is null and h.completed_at is not null and h.stripe_session_id is not null
       and h.completed_at < now() - v_age
       and not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id)
     group by h.stripe_session_id
    having max(h.unrecorded_alarm_at) is null or max(h.unrecorded_alarm_at) < now() - interval '24 hours'
     order by min(h.completed_at)
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), stamp as (
    update karmi_online_holds h set unrecorded_alarm_at = now()
      from due where h.stripe_session_id = due.sid and h.released_at is null
    returning h.id
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
  select jsonb_agg(jsonb_build_object('session', x.sid, 'completed_at', x.completed_at, 'units', x.units,
                                      'lines', x.lines) order by x.completed_at)
    into v
    from (select l.sid, l.completed_at, sum(l.qty)::int as units,
                 jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', l.name, 'bc', l.bc, 'family', l.family,
                                                                'qty', l.qty)) order by l.family, l.bc) as lines
            from lines l group by l.sid, l.completed_at) x;
  return jsonb_build_object('items', coalesce(v, '[]'::jsonb));
end $$;

-- ───────────────────────────── N6: overshoot alarm names the product ─────────────────────────────
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

-- ───────────────────────────── N4: unlist seeded stretch_double products with an unpriced barcode ─────────────────
-- A listed stretch_double product with ANY barcode that has no WAT till row with a price > 0 (of any age, so a late
-- nightly feed can never unlist the family) can never be priced under F3. Live (K&D 23 Nov, GET only): 0562 (+0959)
-- and 0905 (+0952). Repeat runs find nothing to change.
update public.karmi_online_products k
   set listed = false, set_by = 'N4 2026-11-23: barcode without WAT price'
 where k.family = 'stretch_double' and k.listed
   and exists (select 1 from public.product_barcodes pb
                where pb.product_id = k.product_id
                  and not exists (select 1 from public.pos_promotion_products ppp
                                   where ppp.barcode = pb.barcode and ppp.store_id = 'WAT' and ppp.list_price > 0));

-- ───────────────────────────── grants (service_role only, as in #34 / #35) ─────────────────────────────
revoke all on function public.fn_karmi_holds_to_check(int), public.fn_karmi_paid_unrecorded(interval, int),
  public.fn_karmi_cap_overshoot(text)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_holds_to_check(int), public.fn_karmi_paid_unrecorded(interval, int),
  public.fn_karmi_cap_overshoot(text)
  to service_role;
