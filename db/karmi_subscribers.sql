-- Migration: karmi_subscribers
-- Captures email signups from the Karmi Laven popup.
-- Run once against shared ops v2 Supabase (service-role only access).

create table if not exists karmi_subscribers (
  id          bigserial primary key,
  email       text not null unique,
  source      text not null default 'popup',
  created_at  timestamptz not null default now()
);

-- Lower-case constraint: enforce via a functional unique index so we match
-- case-insensitively without storing a separate column.
create unique index if not exists karmi_subscribers_email_lower_idx
  on karmi_subscribers (lower(email));

-- RLS: service-role only (anon / authenticated cannot touch this table)
alter table karmi_subscribers enable row level security;
-- No policies added → only service-role bypasses RLS
