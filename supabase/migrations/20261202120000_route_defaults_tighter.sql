-- Tighter defaults for route suggestions (docs/route-suggestions.md), decided by the owner on 2026-11-23
-- after the first suggestions with real street times: a route was reaching the other side of town
-- through "neighbor" and "on the way" links. New defaults: 7 min of detour (was 10) and 1.5 km between
-- neighbor bairros (was 2 km). Stops per route stay at 8.
--
-- Stores still on the old defaults move to the new ones. A store that changed a limit in Dados da loja
-- keeps its own value (the old default can't be told apart from a store that picked exactly 10 min or
-- 2 km; today every store is on the defaults).
begin;

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
