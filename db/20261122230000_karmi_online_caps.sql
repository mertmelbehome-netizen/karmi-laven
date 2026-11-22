-- karmi_online_caps — online price, variety + unit caps and the Christmas cut-off for karmilaven.com
-- (22 Nov 2026, owner decisions via the command centre; spec: agents/online-marketing/outputs/
--  2026-11-22_karmi_new_categories_plan.md §3, §5.4, §7, §8 + K&D v2 conditions).
--
-- Lives in the OPS Supabase (shared with Melbe ops-v2), like db/reviews.sql. Apply with apply_ddl.
-- Rollback: db/20261122230000_karmi_online_caps_ROLLBACK.sql
--
-- What it does
--   * karmi_online_caps      one row per product FAMILY: max distinct products listed online (variety), max units
--                            in the period, launch switch, period. NO ROW = NOT SELLABLE (fail closed).
--   * karmi_online_products  one row per product (products.id = one variety; all its barcodes share it): unit cap,
--                            listed flag, customer-safe line name.
--   * karmi_online_window    Christmas cut-off + the 13–15 Dec order/unit limit (config, not code).
--   * karmi_online_holds     reservations made by /api/checkout before the Stripe session opens; expire after 40 min.
--   * fn_karmi_checkout_reserve  the ONE place a checkout is admitted: advisory lock → cut-off/limit → per-product
--                            and per-family caps (sold + open holds + this cart) → stock → insert holds. One
--                            transaction, serialised, so two concurrent checkouts can never both take the last unit.
--   * fn_karmi_online_status read-only view for /api/stock (sellable qty, real stock, WAT price, window state).
--
-- Online price (owner decision 1): the WAT till single price = pos_promotion_products.list_price for store WAT
-- (nightly IKAPOS bridge feed). A product is priced only when all its barcodes agree on ONE price > 0 and the feed
-- row is fresher than karmi_online_caps.price_max_age. No price → not sellable. The Gradient Edit (Lux / Lux Cobra,
-- the £2.99 multi-buy ladder) is NOT in these tables: its price stays in api/_pricing.js.
--
-- Security: every table has RLS on and no policies; anon/authenticated have no table rights and no EXECUTE.
-- Only service_role (the Vercel functions) calls the fn_karmi_* functions. SECURITY DEFINER + fixed search_path.

-- ───────────────────────────── tables ─────────────────────────────

create table if not exists public.karmi_online_caps (
  family          text primary key check (family ~ '^[a-z][a-z_]*$' and family <> 'gradient'),
  category_names  text[] not null check (cardinality(category_names) > 0),   -- products.category_name values
  display_label   text not null,                -- customer-safe fallback line name (no material words, §1.3)
  max_products    int  not null check (max_products >= 0),   -- max distinct products (products.id) listed online
  max_units       int  not null check (max_units >= 0),      -- family total: sold in period + open holds
  enabled         boolean not null default false,            -- launch switch; false = nothing in the family sells
  period_start    timestamptz not null,                      -- cumulative counters start here (no weekly reset)
  period_end      timestamptz,                               -- null = open-ended
  stock_buffer    int  not null default 3 check (stock_buffer >= 0),   -- same as ONLINE_STOCKROOM_BUFFER
  price_max_age   interval not null default interval '72 hours',       -- older WAT price feed = not sellable
  note            text,
  set_by          text not null,
  updated_at      timestamptz not null default now()
);

create table if not exists public.karmi_online_products (
  product_id    uuid primary key references public.products(id),
  family        text not null references public.karmi_online_caps(family) on update cascade,
  unit_cap      int  not null check (unit_cap >= 0),   -- cumulative units for the period (sold + open holds)
  listed        boolean not null default false,         -- counts toward karmi_online_caps.max_products
  display_name  text,                                   -- customer-safe name; null → family display_label
  source        text not null,
  set_by        text not null,
  updated_at    timestamptz not null default now()
);
create index if not exists karmi_online_products_family_idx on public.karmi_online_products (family) where listed;

create table if not exists public.karmi_online_window (
  id              text primary key,
  closes_at       timestamptz not null,       -- checkout refused from here (last order day ends just before)
  reopen_at       timestamptz,                -- null = stays closed until someone sets it
  limit_from      timestamptz,                -- order/unit limit applies from here until closes_at
  limit_orders    int check (limit_orders >= 0),
  limit_units     int check (limit_units >= 0),
  limit_per_day   boolean not null default false,   -- false = the limit is a TOTAL for limit_from..closes_at
  recovery_off_from timestamptz,              -- Stripe recovery links are not issued for sessions created from here
  closed_message  text not null,
  limit_message   text not null,
  set_by          text not null,
  updated_at      timestamptz not null default now(),
  check (limit_from is null or limit_from < closes_at),
  check (reopen_at is null or reopen_at > closes_at)
);

create table if not exists public.karmi_online_holds (
  id                bigserial primary key,
  ref               uuid not null,                 -- one checkout attempt (Stripe metadata.hold_ref)
  product_id        uuid,                          -- null for Gradient Edit units
  family            text not null,                 -- karmi_online_caps.family or 'gradient'
  qty               int  not null check (qty > 0),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  stripe_session_id text,
  released_at       timestamptz
);
create index if not exists karmi_online_holds_ref_idx  on public.karmi_online_holds (ref);
create index if not exists karmi_online_holds_open_idx on public.karmi_online_holds (expires_at) where released_at is null;

alter table public.karmi_online_caps     enable row level security;
alter table public.karmi_online_products enable row level security;
alter table public.karmi_online_window   enable row level security;
alter table public.karmi_online_holds    enable row level security;
-- No policies on purpose: browser roles see nothing; service_role bypasses RLS.
revoke all on table public.karmi_online_caps, public.karmi_online_products, public.karmi_online_window,
                    public.karmi_online_holds from public, anon, authenticated;
grant select, insert, update, delete on table public.karmi_online_caps, public.karmi_online_products,
                    public.karmi_online_window, public.karmi_online_holds to service_role;
revoke all on sequence public.karmi_online_holds_id_seq from public, anon, authenticated;
grant usage, select on sequence public.karmi_online_holds_id_seq to service_role;

-- ───────────────────────────── config guards ─────────────────────────────

-- A product may only join a family its category belongs to, and a family may never list more than max_products.
create or replace function public.fn_karmi__products_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_max int; v_cats text[]; v_cat text; v_n int;
begin
  select c.max_products, c.category_names into v_max, v_cats from karmi_online_caps c where c.family = new.family;
  select p.category_name into v_cat from products p where p.id = new.product_id;
  if v_cat is null or not (v_cat = any (v_cats)) then
    raise exception 'karmi_online_products: product % (category %) is not in family %', new.product_id, v_cat, new.family;
  end if;
  if new.listed then
    select count(*) into v_n from karmi_online_products k
     where k.family = new.family and k.listed and k.product_id <> new.product_id;
    if v_n + 1 > v_max then
      raise exception 'karmi_online_products: family % already lists % products (max_products %)', new.family, v_n, v_max;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists karmi_online_products_guard on public.karmi_online_products;
create trigger karmi_online_products_guard before insert or update on public.karmi_online_products
  for each row execute function public.fn_karmi__products_guard();

create or replace function public.fn_karmi__caps_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from karmi_online_products k where k.family = new.family and k.listed;
  if v_n > new.max_products then
    raise exception 'karmi_online_caps: family % lists % products; unlist some before lowering max_products to %',
      new.family, v_n, new.max_products;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists karmi_online_caps_guard on public.karmi_online_caps;
create trigger karmi_online_caps_guard before update on public.karmi_online_caps
  for each row execute function public.fn_karmi__caps_guard();

-- ───────────────────────────── helpers (not callable by any API role) ─────────────────────────────

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

-- Karmi online order lines since p_since (every status except cancelled/refunded counts as sold; fulfilment
-- never lowers the counter). product_id is null for barcodes unknown to product_barcodes.
create or replace function public.fn_karmi__sold_lines(p_since timestamptz)
returns table (order_id uuid, created_at timestamptz, product_id uuid, qty int)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.created_at, pb.product_id,
         case when (it->>'qty') ~ '^\s*\d{1,4}\s*$' then (it->>'qty')::int else 0 end
    from online_orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    left join product_barcodes pb on pb.barcode = btrim(it->>'bc')
   where o.source = 'karmilaven'
     and o.created_at >= p_since
     and coalesce(o.status, '') not in ('cancelled', 'refunded')
$$;

-- Per requested barcode: config, WAT price, real stock and what is left under the caps. reason null = sellable.
create or replace function public.fn_karmi__state(p_barcodes text[])
returns table (barcode text, product_id uuid, family text, reason text, price_pence int, line_name text,
               stock int, cap_left int, family_left int)
language sql stable security definer set search_path = public, pg_temp as $$
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
$$;

-- Christmas cut-off and the peak order/unit limit. p_add_* = what this checkout adds (status calls pass 0/0 and are
-- told "full" when one more order/unit would not fit). Also says whether the Stripe session must be short (holds
-- matter / cut-off near) and whether a Stripe recovery link may be issued for a session created now
-- (recovery_ok = false from recovery_off_from until reopen_at; api/checkout.js also never issues one for a cart
-- with a capped product — command centre, 22 Nov).
create or replace function public.fn_karmi__window(p_add_units int, p_add_orders int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare w record; v_since timestamptz; v_orders int; v_units int; v_short boolean := false; v_recovery boolean := true;
begin
  for w in select * from karmi_online_window order by closes_at loop
    if now() >= w.closes_at and (w.reopen_at is null or now() < w.reopen_at) then
      return jsonb_build_object('ok', false, 'error', 'closed', 'message', w.closed_message,
                                'short_session', true, 'recovery_ok', false);
    end if;
    if now() < coalesce(w.reopen_at, 'infinity'::timestamptz) then
      if now() + interval '24 hours' >= coalesce(w.limit_from, w.closes_at) then v_short := true; end if;
      if w.recovery_off_from is not null and now() >= w.recovery_off_from then v_recovery := false; end if;
    end if;
    if w.limit_from is not null and now() >= w.limit_from and now() < w.closes_at
       and (w.limit_orders is not null or w.limit_units is not null) then
      v_since := case when w.limit_per_day
                      then greatest(w.limit_from, (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London')
                      else w.limit_from end;
      select count(distinct s.order_id)::int, coalesce(sum(s.qty), 0)::int into v_orders, v_units
        from fn_karmi__sold_lines(v_since) s;
      select v_orders + count(distinct h.ref)::int, v_units + coalesce(sum(h.qty), 0)::int into v_orders, v_units
        from fn_karmi__open_holds() h where h.created_at >= v_since;
      if (w.limit_orders is not null and v_orders + greatest(coalesce(p_add_orders, 0), 1) > w.limit_orders)
         or (w.limit_units is not null and v_units + greatest(coalesce(p_add_units, 0), 1) > w.limit_units) then
        return jsonb_build_object('ok', false, 'error', 'limit_reached', 'message', w.limit_message,
                                  'short_session', true, 'recovery_ok', false);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'short_session', v_short, 'recovery_ok', v_recovery);
end $$;

-- ───────────────────────────── API functions (service_role only) ─────────────────────────────

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

-- Link a reservation to its Stripe session (checkout after create; webhook again on completion).
create or replace function public.fn_karmi_checkout_attach(p_ref uuid, p_session_id text)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update karmi_online_holds set stripe_session_id = p_session_id
   where ref = p_ref and stripe_session_id is null and coalesce(p_session_id, '') <> '';
  get diagnostics n = row_count;
  return n;
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

-- Read-only state for /api/stock: per barcode {sellable, stock, price_pence} + window {open, message}.
-- sellable = what the bag may hold (caps AND stock); stock = real WAT stock for "Only N left" (never the cap).
create or replace function public.fn_karmi_online_status(p_barcodes text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
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
end $$;

-- Re-pick the listed products of one family (assortment rule, O&W 22 Nov): priced at the WAT till + unit_cap >= 3
-- + WAT stockroom > 0, ranked by WAT+GUI till units of the last 28 days, first max_products. The tone-group
-- complement (rule 4) is a manual UPDATE of `listed` afterwards; the guard trigger still enforces max_products.
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

-- After payment (webhook): flag an order paid after the cut-off or beyond the 13–15 Dec total, e.g. one paid through
-- a Stripe recovery link issued before 13 Dec (nothing on our side sees those before payment). NEVER refunds or
-- cancels: it appends a note to online_orders.fulfilment_note (the existing note column; the refund route appends
-- there the same way) for manual handling. Idempotent. Returns {flagged, reason, order_id}.
create or replace function public.fn_karmi_flag_late_order(p_session_id text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o record; w record; v_since timestamptz; v_orders int; v_units int; v_reason text;
  c_tag constant text := 'FLAG manual check (no auto-refund):';
begin
  select * into o from online_orders where stripe_session_id = p_session_id;
  if not found then return jsonb_build_object('flagged', false, 'reason', 'no_order'); end if;
  for w in select * from karmi_online_window order by closes_at loop
    if o.created_at >= w.closes_at and (w.reopen_at is null or o.created_at < w.reopen_at) then
      v_reason := format('paid after the Christmas cut-off (%s)', to_char(w.closes_at at time zone 'Europe/London', 'DD Mon HH24:MI'));
      exit;
    end if;
    if w.limit_from is not null and o.created_at >= w.limit_from and o.created_at < w.closes_at then
      v_since := case when w.limit_per_day
                      then greatest(w.limit_from, (date_trunc('day', o.created_at at time zone 'Europe/London')) at time zone 'Europe/London')
                      else w.limit_from end;
      select count(distinct s.order_id)::int, coalesce(sum(s.qty), 0)::int into v_orders, v_units
        from fn_karmi__sold_lines(v_since) s where s.created_at <= o.created_at;
      if (w.limit_orders is not null and v_orders > w.limit_orders) or (w.limit_units is not null and v_units > w.limit_units) then
        v_reason := format('beyond the Christmas limit (%s orders / %s units; limit %s / %s)', v_orders, v_units,
                           coalesce(w.limit_orders::text, '-'), coalesce(w.limit_units::text, '-'));
        exit;
      end if;
    end if;
  end loop;
  if v_reason is null then return jsonb_build_object('flagged', false, 'order_id', o.id); end if;
  if coalesce(o.fulfilment_note, '') not like '%' || c_tag || '%' then
    update online_orders
       set fulfilment_note = concat_ws(' | ', nullif(o.fulfilment_note, ''), c_tag || ' ' || v_reason)
     where id = o.id;
  end if;
  return jsonb_build_object('flagged', true, 'reason', v_reason, 'order_id', o.id);
end $$;

revoke all on function public.fn_karmi__products_guard(), public.fn_karmi__caps_guard(),
  public.fn_karmi__wat_price_pence(uuid, interval), public.fn_karmi__open_holds(),
  public.fn_karmi__sold_lines(timestamptz), public.fn_karmi__state(text[]), public.fn_karmi__window(int, int),
  public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_attach(uuid, text),
  public.fn_karmi_checkout_release(uuid), public.fn_karmi_online_status(text[]), public.fn_karmi_online_reselect(text),
  public.fn_karmi_flag_late_order(text)
  from public, anon, authenticated;
grant execute on function public.fn_karmi_checkout_reserve(uuid, jsonb, int), public.fn_karmi_checkout_attach(uuid, text),
  public.fn_karmi_checkout_release(uuid), public.fn_karmi_online_status(text[]), public.fn_karmi_online_reselect(text),
  public.fn_karmi_flag_late_order(text)
  to service_role;

-- ───────────────────────────── seed config (O&W 22 Nov) ─────────────────────────────
-- Families: variety = 2026-11-22_karmi_assortment_config.md; units = 2026-11-22_karmi_online_caps_merch.md v2 §5a.
-- enabled = false for every family: the numbers are set, the LAUNCH switch is the owner's (after K&D + PR-3 photos
-- + Stripe promo-code check). Diamond = 2nd wave: 0 products.
insert into public.karmi_online_caps
  (family, category_names, display_label, max_products, max_units, enabled, period_start, period_end, note, set_by)
values
  ('stretch_charm',      '{"Stretch Charm Bracelet"}',  'Stretch Charm Bracelet',  30, 547, false,
   '2026-11-22 00:00 Europe/London', '2026-12-16 00:00 Europe/London', 'wave 1', 'O&W 2026-11-22'),
  ('stretch_double',     '{"Stretch Double Bracelet"}', 'Stretch Double Bracelet', 14,  92, false,
   '2026-11-22 00:00 Europe/London', '2026-12-16 00:00 Europe/London', 'wave 1; pilot 7081 unpriced → 1358', 'O&W 2026-11-22'),
  ('necklace_lux_stone', '{"Necklace Lux Stone"}',      'Charm Necklace',          20, 149, false,
   '2026-11-22 00:00 Europe/London', '2026-12-16 00:00 Europe/London', 'wave 1', 'O&W 2026-11-22'),
  ('hair',               '{"Hair Clips","Hair Claws"}', 'Hair Accessory',          16, 485, false,
   '2026-11-22 00:00 Europe/London', '2026-12-16 00:00 Europe/London', 'wave 1; Hair Clips Metal excluded (unpriced)', 'O&W 2026-11-22'),
  ('diamond',            '{"Diamond Bracelet"}',        'Sparkle Line Bracelet',    0, 356, false,
   '2026-11-22 00:00 Europe/London', '2026-12-16 00:00 Europe/London', 'wave 2 (owner); no "Diamond" on any customer surface', 'O&W 2026-11-22')
on conflict (family) do nothing;

-- Christmas 2026 (owner decision 5): last order Tue 15 Dec (closes 16 Dec 00:00 London); 13–15 Dec at most
-- 15 orders / 40 units IN TOTAL, all products. Stays closed until reopen_at is set.
insert into public.karmi_online_window
  (id, closes_at, reopen_at, limit_from, limit_orders, limit_units, limit_per_day, recovery_off_from,
   closed_message, limit_message, set_by)
values
  ('christmas_2026', '2026-12-16 00:00 Europe/London', null, '2026-12-13 00:00 Europe/London', 15, 40, false,
   '2026-12-13 00:00 Europe/London',
   'Online orders are closed for Christmas. Our last order date was Tuesday 15 December.',
   'Online orders are paused: we have reached our Christmas order limit.',
   'owner 2026-11-22')
on conflict (id) do nothing;

-- Per-product unit caps (merch v2 §3, cap > 0 only; 200 products, 1 738 units). Main barcode → products.id.
insert into public.karmi_online_products (product_id, family, unit_cap, listed, source, set_by)
select pb.product_id, v.family, v.cap, false, 'merch-analyst caps v2 2026-11-22', 'O&W 2026-11-22'
  from (values
    ('81020', 'diamond', 10),
    ('81022', 'diamond', 10),
    ('81021', 'diamond', 10),
    ('81017', 'diamond', 10),
    ('81028', 'diamond', 10),
    ('81053', 'diamond', 10),
    ('81025', 'diamond', 10),
    ('81054', 'diamond', 10),
    ('81024', 'diamond', 10),
    ('81051', 'diamond', 10),
    ('81056', 'diamond', 10),
    ('81058', 'diamond', 10),
    ('81060', 'diamond', 10),
    ('81055', 'diamond', 10),
    ('81064', 'diamond', 10),
    ('81014', 'diamond', 10),
    ('81018', 'diamond', 10),
    ('81016', 'diamond', 10),
    ('81005', 'diamond', 10),
    ('81013', 'diamond', 10),
    ('81011', 'diamond', 10),
    ('81010', 'diamond', 10),
    ('81009', 'diamond', 10),
    ('81006', 'diamond', 10),
    ('81026', 'diamond', 10),
    ('81050', 'diamond', 10),
    ('81049', 'diamond', 10),
    ('81004', 'diamond', 10),
    ('81048', 'diamond', 10),
    ('81047', 'diamond', 10),
    ('81061', 'diamond', 10),
    ('81046', 'diamond', 10),
    ('81023', 'diamond', 10),
    ('81029', 'diamond', 10),
    ('81034', 'diamond', 10),
    ('81033', 'diamond', 10),
    ('81035', 'diamond', 10),
    ('81036', 'diamond', 10),
    ('81038', 'diamond', 10),
    ('81039', 'diamond', 10),
    ('81042', 'diamond', 10),
    ('81044', 'diamond', 10),
    ('81041', 'diamond', 10),
    ('81007', 'diamond', 4),
    ('81032', 'diamond', 4),
    ('1851', 'hair', 9),
    ('1853', 'hair', 9),
    ('1857', 'hair', 9),
    ('1848', 'hair', 8),
    ('1850', 'hair', 8),
    ('1852', 'hair', 8),
    ('1854', 'hair', 8),
    ('1855', 'hair', 8),
    ('1856', 'hair', 8),
    ('1858', 'hair', 8),
    ('1861', 'hair', 8),
    ('1862', 'hair', 8),
    ('1864', 'hair', 8),
    ('1849', 'hair', 8),
    ('1863', 'hair', 8),
    ('1865', 'hair', 8),
    ('1859', 'hair', 7),
    ('1860', 'hair', 7),
    ('03010002', 'hair', 10),
    ('03010027', 'hair', 10),
    ('03010029', 'hair', 10),
    ('03010028', 'hair', 10),
    ('03010031', 'hair', 10),
    ('03010026', 'hair', 10),
    ('03010033', 'hair', 10),
    ('03010013', 'hair', 10),
    ('03010034', 'hair', 10),
    ('03010035', 'hair', 10),
    ('03010004', 'hair', 10),
    ('03010014', 'hair', 10),
    ('03010023', 'hair', 10),
    ('03010024', 'hair', 10),
    ('03010021', 'hair', 10),
    ('03010001', 'hair', 10),
    ('03010005', 'hair', 10),
    ('03010006', 'hair', 10),
    ('03010007', 'hair', 10),
    ('03010010', 'hair', 10),
    ('03010012', 'hair', 10),
    ('03010022', 'hair', 10),
    ('03010008', 'hair', 10),
    ('03010009', 'hair', 10),
    ('03010025', 'hair', 10),
    ('03010011', 'hair', 10),
    ('03010030', 'hair', 10),
    ('03010032', 'hair', 10),
    ('03010018', 'hair', 10),
    ('03010015', 'hair', 10),
    ('03010019', 'hair', 10),
    ('03010016', 'hair', 10),
    ('03010020', 'hair', 10),
    ('03010017', 'hair', 10),
    ('6169', 'necklace_lux_stone', 10),
    ('6180', 'necklace_lux_stone', 10),
    ('6179', 'necklace_lux_stone', 10),
    ('6170', 'necklace_lux_stone', 10),
    ('1800', 'necklace_lux_stone', 10),
    ('6159', 'necklace_lux_stone', 10),
    ('6158', 'necklace_lux_stone', 10),
    ('6175', 'necklace_lux_stone', 10),
    ('6161', 'necklace_lux_stone', 10),
    ('6160', 'necklace_lux_stone', 10),
    ('0685', 'necklace_lux_stone', 10),
    ('1410', 'necklace_lux_stone', 6),
    ('0692', 'necklace_lux_stone', 6),
    ('1411', 'necklace_lux_stone', 6),
    ('0701', 'necklace_lux_stone', 3),
    ('6167', 'necklace_lux_stone', 3),
    ('6155', 'necklace_lux_stone', 3),
    ('6154', 'necklace_lux_stone', 3),
    ('6171', 'necklace_lux_stone', 3),
    ('6177', 'necklace_lux_stone', 3),
    ('6168', 'necklace_lux_stone', 3),
    ('6163', 'necklace_lux_stone', 3),
    ('6165', 'necklace_lux_stone', 3),
    ('6156', 'necklace_lux_stone', 3),
    ('6176', 'necklace_lux_stone', 3),
    ('6166', 'necklace_lux_stone', 3),
    ('6162', 'necklace_lux_stone', 3),
    ('6178', 'necklace_lux_stone', 3),
    ('6157', 'necklace_lux_stone', 3),
    ('6174', 'necklace_lux_stone', 3),
    ('7112', 'stretch_double', 10),
    ('7114', 'stretch_double', 10),
    ('1358', 'stretch_double', 10),
    ('0562', 'stretch_double', 6),
    ('0556', 'stretch_double', 6),
    ('0958', 'stretch_double', 3),
    ('0902', 'stretch_double', 3),
    ('0649', 'stretch_double', 4),
    ('0905', 'stretch_double', 6),
    ('1368', 'stretch_double', 7),
    ('1362', 'stretch_double', 5),
    ('0624', 'stretch_double', 7),
    ('1369', 'stretch_double', 5),
    ('0957', 'stretch_double', 5),
    ('1363', 'stretch_double', 5),
    ('1480', 'stretch_charm', 10),
    ('1470', 'stretch_charm', 10),
    ('2034', 'stretch_charm', 10),
    ('1476', 'stretch_charm', 10),
    ('1465', 'stretch_charm', 10),
    ('1474', 'stretch_charm', 10),
    ('1471', 'stretch_charm', 10),
    ('1479', 'stretch_charm', 10),
    ('2036', 'stretch_charm', 10),
    ('2002', 'stretch_charm', 10),
    ('1475', 'stretch_charm', 10),
    ('6109', 'stretch_charm', 10),
    ('6193', 'stretch_charm', 10),
    ('2019', 'stretch_charm', 10),
    ('2037', 'stretch_charm', 10),
    ('2022', 'stretch_charm', 10),
    ('2042', 'stretch_charm', 10),
    ('2040', 'stretch_charm', 10),
    ('2032', 'stretch_charm', 10),
    ('2023', 'stretch_charm', 7),
    ('2029', 'stretch_charm', 10),
    ('2010', 'stretch_charm', 10),
    ('2039', 'stretch_charm', 10),
    ('2018', 'stretch_charm', 10),
    ('2025', 'stretch_charm', 4),
    ('2033', 'stretch_charm', 10),
    ('1472', 'stretch_charm', 10),
    ('2007', 'stretch_charm', 7),
    ('2014', 'stretch_charm', 10),
    ('2030', 'stretch_charm', 10),
    ('1473', 'stretch_charm', 10),
    ('2020', 'stretch_charm', 10),
    ('2017', 'stretch_charm', 10),
    ('2009', 'stretch_charm', 10),
    ('2026', 'stretch_charm', 7),
    ('2008', 'stretch_charm', 10),
    ('2006', 'stretch_charm', 10),
    ('2004', 'stretch_charm', 10),
    ('2024', 'stretch_charm', 10),
    ('2003', 'stretch_charm', 7),
    ('2005', 'stretch_charm', 10),
    ('2031', 'stretch_charm', 10),
    ('2001', 'stretch_charm', 10),
    ('2028', 'stretch_charm', 10),
    ('2041', 'stretch_charm', 10),
    ('2027', 'stretch_charm', 10),
    ('1478', 'stretch_charm', 10),
    ('1419', 'stretch_charm', 10),
    ('2038', 'stretch_charm', 10),
    ('1469', 'stretch_charm', 9),
    ('2021', 'stretch_charm', 10),
    ('1477', 'stretch_charm', 10),
    ('1468', 'stretch_charm', 10),
    ('2012', 'stretch_charm', 10),
    ('1136', 'stretch_charm', 7),
    ('1145', 'stretch_charm', 10),
    ('1420', 'stretch_charm', 5),
    ('1133', 'stretch_charm', 4)
  ) as v(barcode, family, cap)
  join public.product_barcodes pb on pb.barcode = v.barcode
on conflict (product_id) do nothing;

-- First listing per wave-1 family (rule 1–3); O&W adjusts for tone groups afterwards.
select public.fn_karmi_online_reselect(f)
  from unnest(array['stretch_charm', 'stretch_double', 'necklace_lux_stone', 'hair']) f;
