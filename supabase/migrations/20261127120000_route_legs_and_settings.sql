-- Route suggestions, phase 2 (docs/route-suggestions.md).
--
-- 1. Street times between two points, kept per store so each leg is asked to Mapbox once
--    (the Matrix API is billed per element). Points are rounded to 5 decimals (~1 m).
--    Private table: read and written only through the member-checked RPCs below, called by the
--    panel's server route. A member could only ever write bad times into their own store's cache.
-- 2. The store's own limits for the suggestions (owner/manager change them in Dados da loja).
begin;

create table private.route_legs (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  from_latitude numeric(8,5) not null check (from_latitude between -90 and 90),
  from_longitude numeric(8,5) not null check (from_longitude between -180 and 180),
  to_latitude numeric(8,5) not null check (to_latitude between -90 and 90),
  to_longitude numeric(8,5) not null check (to_longitude between -180 and 180),
  seconds integer not null check (seconds between 0 and 86400),
  meters integer not null check (meters between 0 and 1000000),
  fetched_at timestamptz not null default now(),
  primary key (restaurant_id, from_latitude, from_longitude, to_latitude, to_longitude)
);
revoke all on table private.route_legs from public, anon, authenticated;

alter table public.restaurants
  add column route_max_stops smallint not null default 8 check (route_max_stops between 1 and 8),
  add column route_max_detour_minutes smallint not null default 10 check (route_max_detour_minutes between 0 and 60),
  add column route_neighbor_meters integer not null default 2000 check (route_neighbor_meters between 0 and 10000);

-- =========================================================
-- STREET TIMES
-- =========================================================

-- p_points: [{latitude, longitude}, ...] (at most 60). Answers the legs already known among them,
-- as point indexes: [{from, to, seconds, meters}]. Legs older than 90 days are asked again.
create function public.read_route_legs(p_restaurant_id uuid, p_points jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) > 60 then
    raise exception 'RPM_ROUTE_LEGS_INPUT' using errcode = '22023';
  end if;
  return coalesce((
    with points as (
      select (p.ordinality - 1)::int as idx,
             round((p.value->>'latitude')::numeric, 5) as lat,
             round((p.value->>'longitude')::numeric, 5) as lng
        from jsonb_array_elements(p_points) with ordinality as p(value, ordinality)
    )
    select jsonb_agg(jsonb_build_object('from', a.idx, 'to', b.idx, 'seconds', l.seconds, 'meters', l.meters)
                     order by a.idx, b.idx)
      from points a
      join points b on b.idx <> a.idx
      join private.route_legs l
        on l.restaurant_id = p_restaurant_id
       and l.from_latitude = a.lat and l.from_longitude = a.lng
       and l.to_latitude = b.lat and l.to_longitude = b.lng
     where l.fetched_at > now() - interval '90 days'), '[]'::jsonb);
end; $$;

-- p_legs: [{fromLatitude, fromLongitude, toLatitude, toLongitude, seconds, meters}] (at most 3600).
create function public.save_route_legs(p_restaurant_id uuid, p_legs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_saved integer;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_legs) is distinct from 'array' or jsonb_array_length(p_legs) > 3600 then
    raise exception 'RPM_ROUTE_LEGS_INPUT' using errcode = '22023';
  end if;
  insert into private.route_legs as l (restaurant_id, from_latitude, from_longitude, to_latitude, to_longitude, seconds, meters)
  select p_restaurant_id,
         round((leg->>'fromLatitude')::numeric, 5), round((leg->>'fromLongitude')::numeric, 5),
         round((leg->>'toLatitude')::numeric, 5), round((leg->>'toLongitude')::numeric, 5),
         (leg->>'seconds')::numeric::int, (leg->>'meters')::numeric::int
    from jsonb_array_elements(p_legs) as leg
  on conflict (restaurant_id, from_latitude, from_longitude, to_latitude, to_longitude)
  do update set seconds = excluded.seconds, meters = excluded.meters, fetched_at = now();
  get diagnostics v_saved = row_count;
  return jsonb_build_object('saved', v_saved);
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception 'RPM_ROUTE_LEGS_INPUT' using errcode = '22023';
end; $$;

-- =========================================================
-- THE STORE'S LIMITS
-- =========================================================

create function public.get_route_settings(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.restaurants;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  select * into v from public.restaurants where id = p_restaurant_id;
  return jsonb_build_object(
    'maxStops', v.route_max_stops,
    'maxDetourMinutes', v.route_max_detour_minutes,
    'neighborMeters', v.route_neighbor_meters,
    'canEdit', private.is_restaurant_manager(p_restaurant_id));
end; $$;

create function public.set_route_settings(p_restaurant_id uuid, p_max_stops integer,
  p_max_detour_minutes integer, p_neighbor_meters integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_manager(p_restaurant_id) then
    raise exception 'RPM_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if p_max_stops is null or p_max_stops not between 1 and 8
     or p_max_detour_minutes is null or p_max_detour_minutes not between 0 and 60
     or p_neighbor_meters is null or p_neighbor_meters not between 0 and 10000 then
    raise exception 'RPM_ROUTE_SETTINGS_INVALID' using errcode = '22023';
  end if;
  update public.restaurants
     set route_max_stops = p_max_stops, route_max_detour_minutes = p_max_detour_minutes,
         route_neighbor_meters = p_neighbor_meters, updated_at = now()
   where id = p_restaurant_id;
  return public.get_route_settings(p_restaurant_id);
end; $$;

revoke all on function public.read_route_legs(uuid, jsonb) from public, anon;
revoke all on function public.save_route_legs(uuid, jsonb) from public, anon;
revoke all on function public.get_route_settings(uuid) from public, anon;
revoke all on function public.set_route_settings(uuid, integer, integer, integer) from public, anon;
grant execute on function public.read_route_legs(uuid, jsonb) to authenticated;
grant execute on function public.save_route_legs(uuid, jsonb) to authenticated;
grant execute on function public.get_route_settings(uuid) to authenticated;
grant execute on function public.set_route_settings(uuid, integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
