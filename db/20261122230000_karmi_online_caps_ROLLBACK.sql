-- ROLLBACK for 20261122230000_karmi_online_caps.sql
-- Deploy order: revert/redeploy the karmi-laven code that calls these functions FIRST (the old checkout does not use
-- them). With the new code still live, dropping these makes every non-Gradient cart fail closed (503) and Gradient
-- carts fall back to the built-in Christmas guard in api/_caps-lib.js — safe, but no caps/limit counting.
-- Data loss: the config rows and the reservation log (karmi_online_holds). Export them first if needed:
--   select * from karmi_online_caps; select * from karmi_online_products; select * from karmi_online_window;

drop function if exists public.fn_karmi_flag_late_order(text);
drop function if exists public.fn_karmi_online_reselect(text);
drop function if exists public.fn_karmi_online_status(text[]);
drop function if exists public.fn_karmi_checkout_release(uuid);
drop function if exists public.fn_karmi_checkout_attach(uuid, text);
drop function if exists public.fn_karmi_checkout_reserve(uuid, jsonb, int);
drop function if exists public.fn_karmi__window(int, int);
drop function if exists public.fn_karmi__state(text[]);
drop function if exists public.fn_karmi__sold_lines(timestamptz);
drop function if exists public.fn_karmi__open_holds();
drop function if exists public.fn_karmi__wat_price_pence(uuid, interval);

drop trigger if exists karmi_online_products_guard on public.karmi_online_products;
drop trigger if exists karmi_online_caps_guard on public.karmi_online_caps;
drop function if exists public.fn_karmi__products_guard();
drop function if exists public.fn_karmi__caps_guard();

drop table if exists public.karmi_online_holds;
drop table if exists public.karmi_online_products;
drop table if exists public.karmi_online_window;
drop table if exists public.karmi_online_caps;
