-- MANUAL — OPEN the Karmi family groups (NOT a migration; run by hand, once the command centre says go).
-- Needs db/20261123232000_karmi_families_prep.sql applied. Idempotent (run twice = same state). One DO block.
-- Rollback: db/manual/20261123232000_karmi_families_open_ROLLBACK.sql (per group).
--
-- PARAMETER: v_groups below = the online groups to open. Command centre 23 Nov: B + C + A (A = 7 Stretch Bracelet
--   cards). Edit that ONE line to open fewer (e.g. array['B','C']).
-- What it does: enabled = true on every caps family that has at least one LISTED product whose online_group is in
--   v_groups. NOTE: family hair holds Hair Clips (B) AND Hair Claws (C): opening B or C opens the whole hair family
--   (its listed products in the other group become sellable too, at THEIR group price). The notice lists this.
-- Refuses (nothing changes) if: the prep is missing, a group is unknown or inactive, or a group has no listed product.
-- ALSO NEEDED for the shop to show / sell the families (not SQL):
--   Vercel karmi-laven Production env KARMI_STOREFRONT_FAMILIES=on + redeploy (PR #47 code), then the smoke test.

do $$
declare
  v_groups constant text[] := array['B', 'C', 'A'];   -- ← the ONE parameter
  v_bad text;
  v_fams text[];
  v_opened text[];
  v_mixed text;
begin
  if to_regclass('public.karmi_online_groups') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'karmi_online_products' and column_name = 'online_group') then
    raise exception 'families open: apply db/20261123232000_karmi_families_prep.sql first';
  end if;
  if cardinality(v_groups) is null or cardinality(v_groups) = 0 then
    raise exception 'families open: v_groups is empty';
  end if;
  select string_agg(x, ', ') into v_bad
    from unnest(v_groups) x
   where not exists (select 1 from karmi_online_groups g where g.online_group = x and g.active);
  if v_bad is not null then
    raise exception 'families open: group(s) unknown or inactive in karmi_online_groups: %', v_bad;
  end if;
  select string_agg(x, ', ') into v_bad
    from unnest(v_groups) x
   where not exists (select 1 from karmi_online_products k where k.online_group = x and k.listed);
  if v_bad is not null then
    raise exception 'families open: group(s) with no listed product: %', v_bad;
  end if;

  select array_agg(distinct k.family order by k.family) into v_fams
    from karmi_online_products k where k.listed and k.online_group = any (v_groups);

  with u as (
    update karmi_online_caps c
       set enabled = true, set_by = 'manual open ' || array_to_string(v_groups, '+') || ' ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
     where c.family = any (v_fams) and not c.enabled
    returning c.family
  )
  select array_agg(family order by family) into v_opened from u;

  select string_agg(m.family || ' (' || m.grps || ')', ', ') into v_mixed
    from (select k.family, string_agg(distinct k.online_group, '+' order by k.online_group) as grps
            from karmi_online_products k
           where k.listed and k.family = any (v_fams) and k.online_group is not null
           group by k.family having count(distinct k.online_group) > 1) m;

  raise notice 'families open: groups % -> families % open (newly opened now: %)%',
    v_groups, v_fams, coalesce(v_opened, '{}'::text[]),
    coalesce('; mixed-group families: ' || v_mixed, '');
  if exists (select 1 from karmi_online_caps c where c.family = any (v_fams)
              and (now() < c.period_start or (c.period_end is not null and now() >= c.period_end))) then
    raise notice 'families open: WARNING some opened family is outside its period_start / period_end (still closed in practice)';
  end if;
end $$;

-- check (read-only): select family, enabled, max_products, max_units, set_by from karmi_online_caps order by 1;
