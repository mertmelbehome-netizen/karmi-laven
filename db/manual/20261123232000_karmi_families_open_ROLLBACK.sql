-- MANUAL ROLLBACK of db/manual/20261123232000_karmi_families_open.sql — CLOSE family groups (per group).
-- Idempotent. One DO block. Close in the shop first if needed: Vercel KARMI_STOREFRONT_FAMILIES=off + redeploy hides
-- the cards; THIS file is what stops the DB admitting them (reserve refuses 'family_closed').
--
-- PARAMETER: v_groups = the groups to close. All three: array['B','C','A']; only A: array['A'].
-- Closes every caps family that has a listed product in one of v_groups. A family is one switch, so closing B also
--   closes family hair, which holds the C Hair Claws (and closing C closes the B Hair Clips): the notice names every
--   group that went down with it. Open holds already taken stay valid until they expire / complete (40 min).
-- Never touches the Gradient Edit (it is not a caps family).

do $$
declare
  v_groups constant text[] := array['B', 'C', 'A'];   -- ← the ONE parameter
  v_fams text[];
  v_closed text[];
  v_also text;
begin
  if to_regclass('public.karmi_online_groups') is null then
    raise notice 'families close: prep not applied, nothing to close';
    return;
  end if;
  select array_agg(distinct k.family order by k.family) into v_fams
    from karmi_online_products k where k.listed and k.online_group = any (v_groups);

  with u as (
    update karmi_online_caps c
       set enabled = false, set_by = 'manual close ' || array_to_string(v_groups, '+') || ' ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
     where c.family = any (coalesce(v_fams, '{}'::text[])) and c.enabled
    returning c.family
  )
  select array_agg(family order by family) into v_closed from u;

  select string_agg(distinct k.online_group, '+' order by k.online_group) into v_also
    from karmi_online_products k
   where k.listed and k.family = any (coalesce(v_fams, '{}'::text[]))
     and k.online_group is not null and not (k.online_group = any (v_groups));

  raise notice 'families close: groups % -> families % closed (newly closed now: %)%',
    v_groups, coalesce(v_fams, '{}'::text[]), coalesce(v_closed, '{}'::text[]),
    coalesce('; ALSO closed for group(s) ' || v_also || ' (shared family)', '');
end $$;

-- check (read-only): select family, enabled, set_by from karmi_online_caps order by 1;
