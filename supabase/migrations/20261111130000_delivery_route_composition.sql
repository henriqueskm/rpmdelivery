-- RPM-CORE-002. Núcleo operacional, fatia 2: montagem de rota.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md, docs/delivery-deadlines-pickup.md
begin;

-- =========================================================
-- SCHEMA
-- =========================================================

alter table public.routes
  add column composition_version integer not null default 1,
  add column pickup_released_at timestamptz,
  add column pickup_released_by uuid references public.profiles(id),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column created_by uuid references public.profiles(id),
  add column client_request_id uuid;

alter table public.routes
  add constraint routes_composition_version_check check (composition_version > 0),
  add constraint routes_pickup_release_pair_check
    check ((pickup_released_at is null) = (pickup_released_by is null)),
  -- Pickup release only exists while the route is still being prepared
  -- or after it started from a released state.
  add constraint routes_pickup_release_state_check
    check (pickup_released_at is null or status <> 'CANCELLED'),
  add constraint routes_client_request_unique unique (restaurant_id, client_request_id);

-- =========================================================
-- PRIVATE HELPERS
-- =========================================================

-- 1..30 distinct, non-null ids.
create function private.check_route_delivery_ids(p_ids uuid[])
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 30
    or array_position(p_ids, null) is not null
    or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'RPM_ROUTE_FIELDS' using errcode='22023', detail='delivery_ids';
  end if;
end; $$;

-- Locks the given deliveries of the restaurant in id order (deadlock-free
-- across concurrent commands) and returns how many exist there.
create function private.lock_deliveries(p_restaurant_id uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  with locked as (
    select id from public.deliveries
      where restaurant_id = p_restaurant_id and id = any(p_ids)
      order by id
      for update
  ) select count(*) into n from locked;
  return n;
end; $$;

-- Inserts the planned sequence and marks WAITING deliveries as ASSIGNED.
-- Callers must hold the delivery locks and have validated availability.
create function private.assign_route_deliveries(p_route_id uuid, p_restaurant_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.route_deliveries (restaurant_id, route_id, delivery_id, sequence)
    select p_restaurant_id, p_route_id, t.id, t.ord::integer
    from unnest(p_ids) with ordinality as t(id, ord);
  update public.deliveries set status='ASSIGNED', assigned_at=clock_timestamp()
    where restaurant_id = p_restaurant_id and id = any(p_ids) and status = 'WAITING';
end; $$;

create function private.route_delivery_ids(p_route_id uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(delivery_id order by sequence), '{}')
  from public.route_deliveries where route_id = p_route_id;
$$;

create function private.route_state(v public.routes)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('routeId', v.id, 'status', v.status,
    'version', v.composition_version, 'pickupReleasedAt', v.pickup_released_at);
$$;

-- =========================================================
-- COMMANDS
-- =========================================================

create function public.create_route(
  p_restaurant_id uuid, p_request_id uuid, p_shift_id uuid, p_delivery_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_shift public.courier_shifts;
  v_route public.routes;
  v_locked integer;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_request_id is null then
    raise exception 'RPM_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;
  perform private.check_route_delivery_ids(p_delivery_ids);

  -- Lock order: shift -> route -> deliveries. The shift lock also
  -- serializes every route creation for this courier.
  select * into v_shift from public.courier_shifts
    where id = p_shift_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_SHIFT_NOT_FOUND' using errcode='P0002';
  end if;

  -- Replay check after the lock: a concurrent replay sees the committed route.
  select * into v_route from public.routes
    where restaurant_id = p_restaurant_id and client_request_id = p_request_id;
  if found then
    return private.route_state(v_route) || jsonb_build_object('created', false);
  end if;

  if v_shift.status <> 'AVAILABLE' then
    raise exception 'RPM_SHIFT_NOT_AVAILABLE' using errcode='55000';
  end if;
  perform 1 from public.restaurant_couriers
    where id = v_shift.restaurant_courier_id and status = 'ACTIVE'
    for share;
  if not found then
    raise exception 'RPM_COURIER_LINK_REQUIRED' using errcode='55000';
  end if;
  if exists (select 1 from public.routes where courier_id = v_shift.courier_id
    and status in ('PREPARING','ON_ROUTE','RETURNING')) then
    raise exception 'RPM_COURIER_BUSY' using errcode='55000';
  end if;

  -- Lock and check MUST be separate statements: under READ COMMITTED a
  -- single expression keeps the snapshot taken before waiting for the lock
  -- and would still see a concurrently assigned delivery as WAITING.
  v_locked := private.lock_deliveries(p_restaurant_id, p_delivery_ids);
  if v_locked <> cardinality(p_delivery_ids) or exists (select 1 from public.deliveries
    where id = any(p_delivery_ids) and status <> 'WAITING') then
    -- Foreign, unknown and already assigned deliveries share one outcome.
    raise exception 'RPM_DELIVERY_UNAVAILABLE' using errcode='55000';
  end if;

  insert into public.routes (restaurant_id, courier_id, courier_shift_id, created_by, client_request_id)
    values (p_restaurant_id, v_shift.courier_id, v_shift.id, auth.uid(), p_request_id)
    returning * into v_route;
  perform private.assign_route_deliveries(v_route.id, p_restaurant_id, p_delivery_ids);
  return private.route_state(v_route) || jsonb_build_object('created', true);
end; $$;

create function public.update_route_composition(
  p_restaurant_id uuid, p_route_id uuid, p_expected_version integer, p_delivery_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_route public.routes;
  v_current uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_same_set boolean;
  v_locked integer;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  perform private.check_route_delivery_ids(p_delivery_ids);
  select * into v_route from public.routes
    where id = p_route_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;
  if v_route.status <> 'PREPARING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  if p_expected_version is distinct from v_route.composition_version then
    raise exception 'RPM_ROUTE_STALE' using errcode='55000';
  end if;

  v_current := private.route_delivery_ids(v_route.id);
  if v_current = p_delivery_ids then
    return private.route_state(v_route) || jsonb_build_object('changed', false);
  end if;
  v_added := array(select x from unnest(p_delivery_ids) x except select y from unnest(v_current) y);
  v_removed := array(select y from unnest(v_current) y except select x from unnest(p_delivery_ids) x);
  v_same_set := cardinality(v_added) = 0 and cardinality(v_removed) = 0;

  -- One ordered lock pass over every touched delivery, then a separate
  -- statement (fresh snapshot) to check availability. See create_route.
  v_locked := private.lock_deliveries(p_restaurant_id, v_added || v_removed);
  if v_locked <> cardinality(v_added) + cardinality(v_removed)
    or exists (select 1 from public.deliveries
      where id = any(v_added) and status <> 'WAITING') then
    raise exception 'RPM_DELIVERY_UNAVAILABLE' using errcode='55000';
  end if;

  update public.deliveries set status='WAITING', assigned_at=null
    where id = any(v_removed) and status = 'ASSIGNED';
  delete from public.route_deliveries where route_id = v_route.id;
  perform private.assign_route_deliveries(v_route.id, p_restaurant_id, p_delivery_ids);

  -- Reordering keeps the release; changing which orders go clears it.
  update public.routes set composition_version = composition_version + 1,
    pickup_released_at = case when v_same_set then pickup_released_at end,
    pickup_released_by = case when v_same_set then pickup_released_by end
    where id = v_route.id
    returning * into v_route;
  return private.route_state(v_route) || jsonb_build_object('changed', true);
end; $$;

create function public.release_route_pickup(
  p_restaurant_id uuid, p_route_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_route public.routes;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_route from public.routes
    where id = p_route_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;
  if v_route.status <> 'PREPARING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  -- Releasing a composition the operator no longer sees is refused.
  if p_expected_version is distinct from v_route.composition_version then
    raise exception 'RPM_ROUTE_STALE' using errcode='55000';
  end if;
  if v_route.pickup_released_at is null then
    update public.routes set pickup_released_at=clock_timestamp(), pickup_released_by=auth.uid()
      where id = v_route.id
      returning * into v_route;
  end if;
  return private.route_state(v_route);
end; $$;

create function public.revoke_route_pickup(p_restaurant_id uuid, p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_route public.routes;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_route from public.routes
    where id = p_route_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;
  -- If the courier already started, the start won the race: refuse.
  if v_route.status <> 'PREPARING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  if v_route.pickup_released_at is not null then
    update public.routes set pickup_released_at=null, pickup_released_by=null
      where id = v_route.id
      returning * into v_route;
  end if;
  return private.route_state(v_route);
end; $$;

create function public.cancel_route(p_restaurant_id uuid, p_route_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_route public.routes;
  v_ids uuid[];
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_route from public.routes
    where id = p_route_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;
  if v_route.status = 'CANCELLED' then return 'CANCELLED'; end if;
  if v_route.status <> 'PREPARING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  v_ids := private.route_delivery_ids(v_route.id);
  perform private.lock_deliveries(p_restaurant_id, v_ids);
  update public.deliveries set status='WAITING', assigned_at=null
    where id = any(v_ids) and status = 'ASSIGNED';
  -- route_deliveries rows are kept as history of the cancelled route.
  update public.routes set status='CANCELLED', cancelled_at=clock_timestamp(),
    cancelled_by=auth.uid(), pickup_released_at=null, pickup_released_by=null
    where id = v_route.id;
  return 'CANCELLED';
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================

revoke all on function private.check_route_delivery_ids(uuid[]),
  private.lock_deliveries(uuid,uuid[]),
  private.assign_route_deliveries(uuid,uuid,uuid[]),
  private.route_delivery_ids(uuid),
  private.route_state(public.routes)
  from public, anon, authenticated;

revoke all on function
  public.create_route(uuid,uuid,uuid,uuid[]),
  public.update_route_composition(uuid,uuid,integer,uuid[]),
  public.release_route_pickup(uuid,uuid,integer),
  public.revoke_route_pickup(uuid,uuid),
  public.cancel_route(uuid,uuid)
  from public, anon;

grant execute on function
  public.create_route(uuid,uuid,uuid,uuid[]),
  public.update_route_composition(uuid,uuid,integer,uuid[]),
  public.release_route_pickup(uuid,uuid,integer),
  public.revoke_route_pickup(uuid,uuid),
  public.cancel_route(uuid,uuid)
  to authenticated;

-- No direct table writes, RLS policies or GPS privileges are changed.
notify pgrst, 'reload schema';
commit;
