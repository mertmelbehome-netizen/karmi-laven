-- karmi_online_caps F1 + F3 (K&D review of PR #34, 23 Nov 2026:
--  agents/quality-audit/outputs/2026-11-23_karmi_pr34_caps_pricing_review.md). Applies on top of
--  db/20261122230000_karmi_online_caps.sql. Idempotent (apply twice = same objects). Apply with apply_ddl.
-- Rollback: db/20261123090000_karmi_online_caps_f1_f3_ROLLBACK.sql (restores the PR #34 functions).
-- ⚠ Do not re-run the PR #34 file on its own after this one: it would put back the old open-holds / price rules.
--
-- F1 — a late or failed Stripe webhook must not free a cap that was already paid.
--   Before: a hold stopped counting at expires_at (40 min); the sale only counted once the webhook wrote
--   online_orders. Webhook late → a second buyer could take the same units (PGlite: 4 sold vs cap 2).
--   Now: a hold that is attached to a SHORT Stripe session (31 min; every cart with a capped product, and every cart
--   near / inside the Christmas window) no longer expires by the clock. It counts until Stripe's outcome is known:
--     * session completed → completed_at is set (webhook, or the resolver below) → counts until its online_orders row
--       exists, then the order counts instead (never both, never neither);
--     * session expired    → released_at is set (checkout.session.expired webhook, or the resolver).
--   The resolver: /api/checkout (before every admission) and /api/stock ask fn_karmi_holds_to_check for attached
--   short holds past expires_at with no outcome yet, look each session up in Stripe, and report it with
--   fn_karmi_checkout_resolve. Until then the hold keeps counting (fail safe: under-sell, never over-sell).
--   Holds with no Stripe session (session create failed / attach failed) still expire by the clock.
--   Overshoot alarm: fn_karmi_cap_overshoot(session) lists products / families of that order whose sold + held is
--   over the cap; the webhook logs a warning and pushes via /api/orders/notify. Never refunds or cancels.
--
-- F3 — "all barcodes agree" is enforced: a product is priced only when EVERY one of its barcodes has a fresh WAT row
--   (price > 0, newer than price_max_age) and all those rows carry ONE price. A barcode with a missing or stale price
--   makes the whole product not sellable ('no_price' → checkout refuses with not_available, status sellable 0).
--   (Wave-1 config, O&W: sub-barcodes share one cap and price = the WAT single price.)

-- ───────────────────────────── re-run guard (N5) ─────────────────────────────
-- Re-running this file after db/20261123120000_karmi_online_caps_n_items.sql would put back the oldest-first
-- fn_karmi_holds_to_check and the name-less overshoot alarm. Refuse; roll that one back first.
do $$
begin
  if to_regprocedure('public.fn_karmi_paid_unrecorded(interval, int)') is not null then
    raise exception 'karmi_online_caps F1/F3 (#35): 20261123120000_karmi_online_caps_n_items is applied; re-running this file would revert it. Roll it back first.';
  end if;
end $$;

-- ───────────────────────────── holds: outcome columns ─────────────────────────────
alter table public.karmi_online_holds add column if not exists completed_at  timestamptz;  -- Stripe session complete
alter table public.karmi_online_holds add column if not exists short_session boolean not null default false;

-- ───────────────────────────── F3: price only when every barcode agrees ─────────────────────────────
create or replace function public.fn_karmi__wat_price_pence(p_product_id uuid, p_max_age interval)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  with f as (   -- one row per barcode × fresh WAT row; list_price null = this barcode has no fresh WAT price
    select pb.barcode, ppp.list_price
      from product_barcodes pb
      left join pos_promotion_products ppp
        on ppp.barcode = pb.barcode and ppp.store_id = 'WAT'
       and ppp.list_price is not null and ppp.received_at > now() - p_max_age
     where pb.product_id = p_product_id
  )
  select case when count(*) > 0
               and count(*) filter (where f.list_price is null) = 0
               and count(distinct f.list_price) = 1
               and min(f.list_price) > 0
              then round(min(f.list_price) * 100)::int end
    from f
$$;

-- ───────────────────────────── F1: open holds ─────────────────────────────
-- Counted: not released, no online_orders row yet for its session, and one of
--   * not expired by the clock;
--   * Stripe session completed (paid, order row not written yet — late / failed webhook);
--   * attached to a short Stripe session whose outcome is not known yet.
create or replace function public.fn_karmi__open_holds()
returns table (ref uuid, product_id uuid, family text, qty int, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.ref, h.product_id, h.family, h.qty, h.created_at
    from karmi_online_holds h
   where h.released_at is null
     and (h.expires_at > now()
          or h.completed_at is not null
          or (h.stripe_session_id is not null and h.short_session))
     and (h.stripe_session_id is null
          or not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id))
$$;

-- Same as PR #34, plus: the hold records whether its Stripe session is short (31 min), which is what lets it outlive
-- expires_at until Stripe's outcome is known.
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

-- Free a reservation (Stripe session create failed, or checkout.session.expired). Never frees a paid one
-- (order row written, or the session is known to be complete).
create or replace function public.fn_karmi_checkout_release(p_ref uuid)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update karmi_online_holds h set released_at = now()
   where h.ref = p_ref and h.released_at is null and h.completed_at is null
     and (h.stripe_session_id is null
          or not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id));
  get diagnostics n = row_count;
  return n;
end $$;

-- Webhook checkout.session.completed, called BEFORE the order row is written: link the hold to the session (if
-- api/checkout could not) and mark it complete, so it keeps counting even if writing the order fails.
create or replace function public.fn_karmi_checkout_complete(p_ref uuid, p_session_id text)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_ref is null or coalesce(p_session_id, '') = '' then return 0; end if;
  update karmi_online_holds
     set stripe_session_id = coalesce(stripe_session_id, p_session_id),
         completed_at = coalesce(completed_at, now())
   where ref = p_ref and (stripe_session_id is null or stripe_session_id = p_session_id);
  get diagnostics n = row_count;
  return n;
end $$;

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

-- Stripe's answer for one session: 'complete' → counts until the order row exists; 'expired' → released.
create or replace function public.fn_karmi_checkout_resolve(p_session_id text, p_outcome text)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int := 0;
begin
  if coalesce(p_session_id, '') = '' then return 0; end if;
  if p_outcome = 'complete' then
    update karmi_online_holds set completed_at = coalesce(completed_at, now())
     where stripe_session_id = p_session_id and released_at is null;
  elsif p_outcome = 'expired' then
    update karmi_online_holds h set released_at = now()
     where h.stripe_session_id = p_session_id and h.released_at is null and h.completed_at is null
       and not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id);
  else
    return 0;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

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

-- ───────────────────────────── grants (service_role only, as in PR #34) ─────────────────────────────
revoke all on function public.fn_karmi__wat_price_pence(uuid, interval), public.fn_karmi__open_holds(),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_release(uuid),
  public.fn_karmi_checkout_complete(uuid, text), public.fn_karmi_holds_to_check(int),
  public.fn_karmi_checkout_resolve(text, text), public.fn_karmi_cap_overshoot(text)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_release(uuid),
  public.fn_karmi_checkout_complete(uuid, text), public.fn_karmi_holds_to_check(int),
  public.fn_karmi_checkout_resolve(text, text), public.fn_karmi_cap_overshoot(text)
  to service_role;
