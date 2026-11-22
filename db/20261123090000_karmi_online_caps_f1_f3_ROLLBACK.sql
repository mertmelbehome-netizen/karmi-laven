-- ROLLBACK for 20261123090000_karmi_online_caps_f1_f3.sql — puts back the PR #34 (20261122230000) definitions.
-- Deploy order: redeploy the karmi-laven code without the F1/F3 calls FIRST (it calls fn_karmi_checkout_complete,
-- fn_karmi_holds_to_check, fn_karmi_checkout_resolve, fn_karmi_cap_overshoot; with them gone those calls fail and are
-- treated as best effort / skipped). Data loss: karmi_online_holds.completed_at / short_session.
-- After this file the PR #34 rollback (20261122230000_karmi_online_caps_ROLLBACK.sql) can run as before.

-- added by 20261123120000_karmi_online_caps_n_items.sql (harmless if that file was never applied)
drop function if exists public.fn_karmi_paid_unrecorded(interval, int);
alter table public.karmi_online_holds drop column if exists last_checked_at;
alter table public.karmi_online_holds drop column if exists unrecorded_alarm_at;
drop function if exists public.fn_karmi_cap_overshoot(text);
drop function if exists public.fn_karmi_checkout_resolve(text, text);
drop function if exists public.fn_karmi_holds_to_check(int);
drop function if exists public.fn_karmi_checkout_complete(uuid, text);

-- PR #34 bodies (verbatim)
-- WAT till single price in pence, or null when missing / stale / ambiguous.
create or replace function public.fn_karmi__wat_price_pence(p_product_id uuid, p_max_age interval)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select case when count(distinct ppp.list_price) = 1 and min(ppp.list_price) > 0
              then round(min(ppp.list_price) * 100)::int end
    from product_barcodes pb
    join pos_promotion_products ppp on ppp.barcode = pb.barcode and ppp.store_id = 'WAT'
   where pb.product_id = p_product_id
     and ppp.list_price is not null
     and ppp.received_at > now() - p_max_age
$$;

-- Open reservations: not released, not expired, and not already turned into an online_orders row
-- (that order is counted as sold instead, so nothing is counted twice once the session is attached).
create or replace function public.fn_karmi__open_holds()
returns table (ref uuid, product_id uuid, family text, qty int, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.ref, h.product_id, h.family, h.qty, h.created_at
    from karmi_online_holds h
   where h.released_at is null
     and h.expires_at > now()
     and (h.stripe_session_id is null
          or not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id))
$$;

-- Admit one checkout. p_items = [{bc, qty}] for every NON-Gradient barcode in the cart (anything not configured
-- here is refused); p_gradient_units = Gradient Edit units (they only count toward the Christmas limit).
-- Returns {ok:true, ref, lines:[{bc,product_id,family,price_pence,name}], short_session, recovery_ok}
--      or {ok:false, error:'closed'|'limit_reached'|'not_available'|'bad_request', message, items?}.
create or replace function public.fn_karmi_checkout_reserve(p_ref uuid, p_items jsonb, p_gradient_units int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_grad int := coalesce(p_gradient_units, 0);
  v_units int; v_win jsonb; v_short jsonb; v_lines jsonb; v_capped boolean;
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

  insert into karmi_online_holds (ref, product_id, family, qty, expires_at)
  select p_ref, s.product_id, s.family, s.qty, now() + c_hold from pg_temp._karmi_state s;
  if v_grad > 0 then
    insert into karmi_online_holds (ref, product_id, family, qty, expires_at)
    values (p_ref, null, 'gradient', v_grad, now() + c_hold);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bc', s.barcode, 'product_id', s.product_id, 'family', s.family,
                                               'price_pence', s.price_pence, 'name', s.line_name) order by s.barcode),
                  '[]'::jsonb)
    into v_lines from pg_temp._karmi_state s;

  return jsonb_build_object('ok', true, 'ref', p_ref, 'lines', v_lines,
                            'short_session', v_capped or coalesce((v_win->>'short_session')::boolean, true),
                            'recovery_ok', not v_capped and coalesce((v_win->>'recovery_ok')::boolean, false));
end $$;

-- Free a reservation (Stripe session create failed, or checkout.session.expired). Never frees a paid one.
create or replace function public.fn_karmi_checkout_release(p_ref uuid)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update karmi_online_holds h set released_at = now()
   where h.ref = p_ref and h.released_at is null
     and (h.stripe_session_id is null
          or not exists (select 1 from online_orders o where o.stripe_session_id = h.stripe_session_id));
  get diagnostics n = row_count;
  return n;
end $$;

alter table public.karmi_online_holds drop column if exists completed_at;
alter table public.karmi_online_holds drop column if exists short_session;

revoke all on function public.fn_karmi__wat_price_pence(uuid, interval), public.fn_karmi__open_holds(),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_release(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_release(uuid)
  to service_role;
