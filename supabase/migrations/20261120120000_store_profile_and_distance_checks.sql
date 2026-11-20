-- Dados da loja + conferência de distância nos deslizes do motoboy.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md ("Dados da loja e distância").
begin;

-- =========================================================
-- 1. Dados da loja: owners and managers change name, phone and address.
-- =========================================================
-- The address only changes together with a confirmed location (same rules as
-- create_restaurant); without p_address the current one stays.
create function public.update_restaurant_profile(
  p_restaurant_id uuid,
  p_name text,
  p_phone text,
  p_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_address_provider text default null,
  p_address_provider_id text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_digits text;
  v_row public.restaurants;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  if p_restaurant_id is null or not private.is_restaurant_manager(p_restaurant_id) then
    raise exception 'RPM_STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  if v_name = '' or char_length(v_name) > 160 then
    raise exception 'RPM_STORE_FIELDS' using errcode='22023';
  end if;
  if v_phone is not null then
    if char_length(v_phone) > 30 or v_phone !~ '^\+?[0-9() .-]+$'
      or (v_phone like '+%' and v_phone not like '+55%') then
      raise exception 'RPM_STORE_PHONE' using errcode='22023';
    end if;
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if v_phone like '+55%' and char_length(v_digits) = 13 then
      v_digits := substring(v_digits from 3);
    end if;
    if v_digits !~ '^[1-9][0-9]9[0-9]{8}$' then
      raise exception 'RPM_STORE_PHONE' using errcode='22023';
    end if;
    v_phone := '+55' || v_digits;
  end if;
  if v_address is not null and (char_length(v_address) > 500
    or p_latitude is null or not (p_latitude between -90 and 90)
    or p_longitude is null or not (p_longitude between -180 and 180)
    or p_address_provider is distinct from 'mapbox'
    or p_address_provider_id is null or p_address_provider_id !~ '^[A-Za-z0-9_-]{1,255}$') then
    raise exception 'RPM_STORE_ADDRESS' using errcode='22023';
  end if;

  update public.restaurants set
      name = v_name,
      phone = v_phone,
      address = coalesce(v_address, address),
      latitude = case when v_address is null then latitude else p_latitude end,
      longitude = case when v_address is null then longitude else p_longitude end,
      address_provider = case when v_address is null then address_provider else p_address_provider end,
      address_provider_id = case when v_address is null then address_provider_id else p_address_provider_id end
    where id = p_restaurant_id and is_active
    returning * into v_row;
  if not found then
    raise exception 'RPM_STORE_MANAGER_REQUIRED' using errcode='42501';
  end if;
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'phone', v_row.phone,
    'address', v_row.address, 'latitude', v_row.latitude, 'longitude', v_row.longitude);
end; $$;

-- =========================================================
-- 2. Distance: where the courier is when swiping.
-- =========================================================
-- Great-circle distance in whole meters. Pure arithmetic: no PostGIS, no paid API.
create function private.distance_meters(lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision)
returns integer language sql immutable set search_path='' as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))::integer
$$;

-- A position sent by the app: both coordinates or none, in range; accuracy optional.
create function private.check_position(p_latitude double precision, p_longitude double precision,
  p_accuracy double precision)
returns void language plpgsql immutable set search_path='' as $$
begin
  if (p_latitude is null) <> (p_longitude is null)
    or (p_latitude is not null and (not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180)))
    or (p_accuracy is not null and not (p_accuracy between 0 and 100000)) then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end if;
end; $$;

-- Far means: beyond 300 m even after giving the GPS the benefit of its own
-- accuracy (capped at 100 m). Mapbox pins in Brazil are a few houses off and
-- city GPS drifts 10-50 m, so anything tighter would stop couriers at the door.
create function private.is_far(p_meters integer, p_accuracy double precision)
returns boolean language sql immutable set search_path='' as $$
  select p_meters - least(coalesce(p_accuracy, 0), 100) > 300
$$;

alter table public.delivery_attempts
  add column distance_meters integer,
  add column far_from_address boolean not null default false,
  add constraint delivery_attempts_distance_check check (distance_meters is null or distance_meters >= 0);

-- The commands keep their behavior; a thin public command checks the distance
-- first and then runs them. Their old signatures stay valid through the defaults,
-- so an app without this version (no position) is never blocked.
alter function public.complete_delivery(uuid, uuid, uuid) set schema private;
alter function private.complete_delivery(uuid, uuid, uuid) rename to complete_delivery_core;
alter function public.arrive_at_store(uuid) set schema private;
alter function private.arrive_at_store(uuid) rename to arrive_at_store_core;

-- "Entregue": with the app's position more than 300 m from the order's pin, the
-- command stops with RPM_FAR_FROM_ADDRESS <meters> until the courier confirms
-- (p_confirm_far). Confirmed, or measured from the last GPS point when the app
-- sent none, the attempt keeps the distance and the panel shows it.
-- No pin on the order, or no position at all: nothing to compare, never blocked.
create function public.complete_delivery(
  p_request_id uuid,
  p_route_id uuid,
  p_delivery_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy double precision default null,
  p_confirm_far boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_from_app boolean := p_latitude is not null;
  v_lat double precision := p_latitude;
  v_lon double precision := p_longitude;
  v_acc double precision := p_accuracy;
  v_pin record;
  v_meters integer;
  v_far boolean := false;
  v_result jsonb;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  perform private.check_position(p_latitude, p_longitude, p_accuracy);
  -- A replay was checked when it was first applied; only the current stop is measured.
  if p_request_id is not null
    and not exists (select 1 from public.delivery_attempts
      where route_id = p_route_id and client_request_id = p_request_id)
    and private.route_delivery_status(p_route_id, p_delivery_id) = 'NEXT' then
    select o.latitude, o.longitude into v_pin
      from public.deliveries d join public.orders o on o.id = d.order_id
      where d.id = p_delivery_id;
    if not v_from_app then
      select l.latitude::double precision, l.longitude::double precision, l.accuracy::double precision
        into v_lat, v_lon, v_acc
        from public.courier_locations l
        where l.route_id = p_route_id and l.recorded_at >= v_now - interval '2 minutes'
        order by l.recorded_at desc limit 1;
    end if;
    if v_pin.latitude is not null and v_lat is not null then
      v_meters := private.distance_meters(v_lat, v_lon, v_pin.latitude, v_pin.longitude);
      v_far := private.is_far(v_meters, v_acc);
      if v_far and v_from_app and not coalesce(p_confirm_far, false) then
        raise exception 'RPM_FAR_FROM_ADDRESS %', v_meters using errcode='55000', detail=v_meters::text;
      end if;
    end if;
  end if;

  v_result := private.complete_delivery_core(p_request_id, p_route_id, p_delivery_id);
  if v_meters is not null then
    update public.delivery_attempts set distance_meters = v_meters, far_from_address = v_far
      where route_id = p_route_id and client_request_id = p_request_id and distance_meters is null;
  end if;
  return v_result;
end; $$;

-- "Cheguei na loja": with the app's position more than 300 m from the store,
-- refused with RPM_FAR_FROM_STORE <meters>. No position (or a store without a
-- pin) keeps working as before.
create function public.arrive_at_store(
  p_route_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy double precision default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_courier uuid := private.require_courier();
  v_store record;
  v_meters integer;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  perform private.check_position(p_latitude, p_longitude, p_accuracy);
  if p_latitude is not null then
    select r.status, s.latitude, s.longitude into v_store
      from public.routes r join public.restaurants s on s.id = r.restaurant_id
      where r.id = p_route_id;
    if v_store.status = 'RETURNING' and v_store.latitude is not null then
      v_meters := private.distance_meters(p_latitude, p_longitude, v_store.latitude, v_store.longitude);
      if private.is_far(v_meters, p_accuracy) then
        raise exception 'RPM_FAR_FROM_STORE %', v_meters using errcode='55000', detail=v_meters::text;
      end if;
    end if;
  end if;
  return private.arrive_at_store_core(p_route_id);
end; $$;

-- =========================================================
-- 3. Panel: deliveries confirmed far from the address.
-- =========================================================
alter function public.get_operations_board(uuid) set schema private;
alter function private.get_operations_board(uuid) rename to operations_board_core;

create function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_board jsonb := private.operations_board_core(p_restaurant_id);
begin
  -- Membership was checked by the core. Last 12 hours, like the rest of the board.
  return v_board || jsonb_build_object('farDeliveries', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId', a.delivery_id,
        'routeId', a.route_id,
        'distanceMeters', a.distance_meters,
        'reportedAt', a.reported_at)
      order by a.reported_at desc, a.id), '[]')
      from public.delivery_attempts a
      where a.restaurant_id = p_restaurant_id and a.outcome = 'DELIVERED' and a.far_from_address
        and a.reported_at >= clock_timestamp() - interval '12 hours'));
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================
revoke all on function
  private.complete_delivery_core(uuid, uuid, uuid),
  private.arrive_at_store_core(uuid),
  private.operations_board_core(uuid),
  private.distance_meters(double precision, double precision, double precision, double precision),
  private.check_position(double precision, double precision, double precision),
  private.is_far(integer, double precision)
  from public, anon, authenticated;

revoke all on function
  public.update_restaurant_profile(uuid, text, text, text, double precision, double precision, text, text),
  public.complete_delivery(uuid, uuid, uuid, double precision, double precision, double precision, boolean),
  public.arrive_at_store(uuid, double precision, double precision, double precision),
  public.get_operations_board(uuid)
  from public, anon;
grant execute on function
  public.update_restaurant_profile(uuid, text, text, text, double precision, double precision, text, text),
  public.complete_delivery(uuid, uuid, uuid, double precision, double precision, double precision, boolean),
  public.arrive_at_store(uuid, double precision, double precision, double precision),
  public.get_operations_board(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
