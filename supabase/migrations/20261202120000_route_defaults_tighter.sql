-- Tighter defaults for route suggestions (docs/route-suggestions.md), decided by the owner on 2026-11-23
-- after the first suggestions with real street times: a route was reaching the other side of town
-- through "neighbor" and "on the way" links. New defaults: 7 min of detour (was 10) and 1.5 km between
-- neighbor bairros (was 2 km). Stops per route stay at 8.
--
-- Stores still on the old defaults move to the new ones. A store that changed a limit in Dados da loja
-- keeps its own value (the old default can't be told apart from a store that picked exactly 10 min or
-- 2 km; today every store is on the defaults).
--
-- Legacy store phones first: restaurants_mobile_phone_check (+55 and 11 digits) came in
-- 20261002231941 as NOT VALID, so a store saved before it may still hold the 11 digits without +55.
-- Any UPDATE of that row is then refused (set_route_settings, set_default_promise and this migration).
-- Same number, owner's OK on 2026-11-23: put +55 in front. Other formats are left alone.
begin;

update public.restaurants
   set phone = '+55' || phone, updated_at = now()
 where phone ~ '^[1-9][0-9]9[0-9]{8}$';

alter table public.restaurants
  alter column route_max_detour_minutes set default 7,
  alter column route_neighbor_meters set default 1500;

update public.restaurants
   set route_max_detour_minutes = 7, updated_at = now()
 where route_max_detour_minutes = 10;

update public.restaurants
   set route_neighbor_meters = 1500, updated_at = now()
 where route_neighbor_meters = 2000;

commit;
