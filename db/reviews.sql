-- Karmi Laven customer reviews — lives in OPS Supabase (shared).
-- Applied via apply_ddl from karmi-laven repo record (db/reviews.sql). 2026-06-24.

create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  order_id     text,
  customer_name text,
  email        text,
  rating       int not null check (rating between 1 and 5),
  title        text,
  body         text,
  photo_url    text,
  product_bc   text,
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists reviews_approved_created_idx
  on public.reviews (approved, created_at desc);

alter table public.reviews enable row level security;

-- anon (public site read) may see ONLY approved reviews.
drop policy if exists reviews_anon_select_approved on public.reviews;
create policy reviews_anon_select_approved
  on public.reviews for select
  to anon
  using (approved = true);

-- No anon INSERT/UPDATE/DELETE policies → writes only via service key
-- (the /api/review serverless function), which bypasses RLS.
