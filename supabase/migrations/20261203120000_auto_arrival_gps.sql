-- Chegada automática na loja pelo GPS (docs/delivery-core-commands.md, "Chegada pelo GPS").
-- Forward-only; hosted application requires separate approval.
--
-- Before: the courier only went back in line after swiping "Cheguei na loja", at the end of the
-- line at the time of the swipe; forgetting the swipe meant losing the turn.
-- Now, on the way back (route RETURNING), the first GPS point within 100 m of the store pin with an
-- accuracy of 50 m or better closes the route by itself, and the courier goes back in line at THAT
-- moment (the real arrival), not at the time anybody noticed. The swipe stays for a phone without
-- GPS: it closes the route as before, at the GPS arrival time if one was recorded, else now.
-- A store without a pin never closes a route by itself.
begin;

-- How the way back ended: the courier's swipe or the GPS. Null on routes closed before this.
alter table public.routes add column arrival_source text
  constraint routes_arrival_source_check check (arrival_source is null or arrival_source in ('BUTTON','GPS'));

-- The first point of the way back at the store: within 100 m of the pin, accuracy 50 m or better
-- (unknown accuracy counts: older apps did not send it). Null without a store pin or such a point.
create function private.store_arrival_at(p_route_id uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
  select min(l.recorded_at)
  from public.routes r
  join public.restaurants s on s.id = r.restaurant_id
  join public.courier_locations l on l.route_id = r.id
  where r.id = p_route_id
    and r.returning_at is not null
    and s.latitude is not null and s.longitude is not null
    and l.recorded_at >= r.returning_at
    and coalesce(l.accuracy, 0) <= 50
    and private.distance_meters(l.latitude::double precision, l.longitude::double precision,
      s.latitude::double precision, s.longitude::double precision) <= 100
$$;

-- Closes the way back: route COMPLETED, the courier back in line at the moment of arrival.
-- Caller holds the route execution locks and has checked the route is RETURNING.
create function private.finish_return(p_route public.routes, p_arrived_at timestamptz, p_now timestamptz, p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.routes set status='COMPLETED', arrived_at=p_arrived_at, completed_at=p_now, arrival_source=p_source
    where id = p_route.id;
  update public.courier_shifts set status='AVAILABLE', available_since=p_arrived_at
    where id = p_route.courier_shift_id and status = 'RETURNING';
end; $$;

-- "Cheguei na loja" (the swipe): same as before, but the turn counts from the GPS arrival when
-- the GPS saw it first (a batch that reached the server late, for example).
create or replace function private.arrive_at_store_core(p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);
  if v_route.status = 'COMPLETED' then
    return private.route_progress(v_route.id) || jsonb_build_object('changed', false);
  end if;
  if v_route.status <> 'RETURNING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  perform private.finish_return(v_route, least(coalesce(private.store_arrival_at(v_route.id), v_now), v_now), v_now, 'BUTTON');
  return private.route_progress(v_route.id) || jsonb_build_object('changed', true);
end; $$;

-- Same as before (20261112120000), plus: on the way back, a point at the store closes the route.
create or replace function public.record_courier_locations(p_route_id uuid, p_points jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
  v_inserted integer;
  v_last record;
  v_arrived timestamptz;
  v_active boolean;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  select * into v_route from public.routes where id = p_route_id;
  if v_route.status not in ('ON_ROUTE','RETURNING','COMPLETED') then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  -- Shape first, then values: CASE fixes the evaluation order so a malformed
  -- point never reaches a cast.
  if jsonb_typeof(p_points) is distinct from 'array' then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end if;
  if jsonb_array_length(p_points) not between 1 and 100
    or exists (select 1 from jsonb_array_elements(p_points) e
      where case
        when jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e->'latitude') is distinct from 'number'
          or jsonb_typeof(e->'longitude') is distinct from 'number'
          or coalesce(jsonb_typeof(e->'accuracy'), 'null') not in ('number','null')
          or jsonb_typeof(e->'recordedAt') is distinct from 'string' then true
        else (e->>'latitude')::double precision not between -90 and 90
          or (e->>'longitude')::double precision not between -180 and 180
          or coalesce((e->>'accuracy')::double precision, 0) < 0
      end) then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end if;

  begin
    with points as (
      select (e->>'latitude')::numeric as latitude, (e->>'longitude')::numeric as longitude,
        (e->>'accuracy')::numeric as accuracy, (e->>'recordedAt')::timestamptz as recorded_at
      from jsonb_array_elements(p_points) e
    ), accepted as (
      insert into public.courier_locations (courier_id, route_id, latitude, longitude, accuracy, recorded_at)
        select distinct on (recorded_at) v_courier, v_route.id, latitude, longitude, accuracy, recorded_at
        from points
        where recorded_at between v_route.started_at - interval '1 minute'
          and least(coalesce(v_route.completed_at, v_now), v_now) + interval '1 minute'
        order by recorded_at
      on conflict (route_id, recorded_at) do nothing
      returning latitude, longitude, recorded_at
    )
    select count(*) as n, (array_agg(a.latitude order by a.recorded_at desc))[1] as latitude,
      (array_agg(a.longitude order by a.recorded_at desc))[1] as longitude,
      max(a.recorded_at) as recorded_at
      into v_last from accepted a;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end;
  v_inserted := v_last.n;
  v_active := v_route.status in ('ON_ROUTE','RETURNING');

  -- On the way back, at the store: back in line from the moment the GPS saw the courier there.
  -- The locks are taken only then, and the state is checked again under them (the swipe may
  -- have closed the route in the meantime).
  if v_inserted > 0 and v_route.status = 'RETURNING' then
    v_arrived := private.store_arrival_at(v_route.id);
    if v_arrived is not null then
      v_route := private.lock_route_execution(v_route.id);
      if v_route.status = 'RETURNING' then
        perform private.finish_return(v_route, least(v_arrived, v_now), v_now, 'GPS');
      end if;
    end if;
  end if;

  -- The live position only moves forward and only during an active route (the status the
  -- batch arrived with: the point that closed the way back still moves the courier there).
  if v_inserted > 0 and v_active then
    update public.couriers set last_latitude=v_last.latitude, last_longitude=v_last.longitude,
      location_updated_at=v_last.recorded_at
      where id = v_courier
        and (location_updated_at is null or location_updated_at < v_last.recorded_at);
  end if;
  return v_inserted;
end; $$;

revoke all on function private.store_arrival_at(uuid) from public, anon, authenticated;
revoke all on function private.finish_return(public.routes, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function private.arrive_at_store_core(uuid) from public, anon, authenticated;
revoke all on function public.record_courier_locations(uuid, jsonb) from public, anon;
grant execute on function public.record_courier_locations(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
