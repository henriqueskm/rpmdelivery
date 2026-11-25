-- Fila por chegada na loja (docs/delivery-core-commands.md, "Fila por chegada").
-- Forward-only; hosted application requires separate approval.
--
-- Before: approving a shift put the courier in line at once, even if they were still at home.
-- Now asking for a shift and the approval can happen from anywhere ("I will work today"), but the
-- courier only enters the line on arriving at the store:
--   - by the app's GPS: a reading within 100 m of the store pin, accuracy 50 m or better;
--   - by the courier's swipe "Cheguei na loja" (300 m check when the app sends a position);
--   - by the store: "Chegou" in the panel, for a phone without GPS or an older app.
-- The line counts from the arrival (available_since = arrival). A store without a pin cannot tell,
-- so its approvals keep the old behavior (in line at approval). Shifts open before this migration
-- keep their place. Leaving the store does not remove anyone from the line (that needs GPS all day).
begin;

alter table public.courier_shifts
  add column arrived_at timestamptz,
  add column arrival_source text
    constraint courier_shifts_arrival_source_check
      check (arrival_source is null or arrival_source in ('GPS','BUTTON','STORE','NO_PIN','ROUTE','BEFORE'));

-- Approved before this migration: already in line, keep it that way.
update public.courier_shifts
  set arrived_at = coalesce(available_since, approved_at, started_at, requested_at), arrival_source = 'BEFORE'
  where status in ('AVAILABLE','ON_ROUTE','RETURNING');

-- A route started (the courier picked it up at the store) means the courier arrived, even if the
-- store assigned the route before any arrival was recorded.
create function private.courier_shift_arrival_on_route()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.arrived_at is null and new.status in ('ON_ROUTE','RETURNING') then
    new.arrived_at := clock_timestamp();
    new.arrival_source := 'ROUTE';
  end if;
  return new;
end; $$;

create trigger courier_shifts_arrival_on_route
  before update of status on public.courier_shifts
  for each row execute function private.courier_shift_arrival_on_route();

-- Enters the line: arrived now, the line counts from now. Caller holds the shift lock and has
-- checked the shift is AVAILABLE and not arrived yet.
create function private.enter_queue(p_shift_id uuid, p_now timestamptz, p_source text)
returns void language sql security definer set search_path='' as $$
  update public.courier_shifts set arrived_at = p_now, available_since = p_now, arrival_source = p_source
    where id = p_shift_id and status = 'AVAILABLE' and arrived_at is null
$$;

-- Same as 20261111120000, except the approval no longer puts the courier in line when the store
-- has a pin: the courier is "a caminho" until arriving.
create or replace function public.review_shift(p_restaurant_id uuid, p_shift_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_shift public.courier_shifts;
  v_pinless boolean;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_approve is null then
    raise exception 'RPM_SHIFT_DECISION_REQUIRED' using errcode='22023';
  end if;
  select * into v_shift from public.courier_shifts
    where id = p_shift_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_SHIFT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_shift.status = 'PENDING' then
    if p_approve then
      perform 1 from public.restaurant_couriers
        where id = v_shift.restaurant_courier_id and status = 'ACTIVE'
        for share;
      if not found then
        raise exception 'RPM_COURIER_LINK_REQUIRED' using errcode='55000';
      end if;
      v_pinless := not exists (select 1 from public.restaurants
        where id = p_restaurant_id and latitude is not null and longitude is not null);
      update public.courier_shifts set status='AVAILABLE', approved_at=v_now,
        approved_by=auth.uid(), started_at=v_now, available_since=v_now,
        arrived_at = case when v_pinless then v_now end,
        arrival_source = case when v_pinless then 'NO_PIN' end
        where id = v_shift.id;
      return 'AVAILABLE';
    end if;
    update public.courier_shifts set status='REJECTED', ended_at=v_now, ended_by=auth.uid()
      where id = v_shift.id;
    return 'REJECTED';
  end if;

  -- Retrying the decision that was already applied is a success.
  if (p_approve and v_shift.status in ('AVAILABLE','ON_ROUTE','RETURNING'))
    or (not p_approve and v_shift.status = 'REJECTED') then
    return v_shift.status::text;
  end if;
  raise exception 'RPM_SHIFT_STATE' using errcode='55000';
end; $$;

-- The courier arrives at the store of their approved shift.
--   p_auto = true: the app's GPS saw the phone there. Needs a position within 100 m of the pin with
--     accuracy 50 m or better (RPM_NOT_AT_STORE otherwise); never without a pin.
--   p_auto = false: the swipe. With a position more than 300 m away, RPM_FAR_FROM_STORE <meters>;
--     without a position (or a store without a pin), accepted, as "Cheguei na loja" on the way back.
-- Repeating after the arrival is a success that changes nothing.
create function public.arrive_for_shift(
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy double precision default null,
  p_auto boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_shift public.courier_shifts;
  v_store record;
  v_meters integer;
begin
  perform private.check_position(p_latitude, p_longitude, p_accuracy);
  select * into v_shift from public.courier_shifts
    where courier_id = v_courier and status not in ('ENDED','REJECTED')
    for update;
  if not found then
    raise exception 'RPM_SHIFT_NOT_FOUND' using errcode='P0002';
  end if;
  if v_shift.arrived_at is not null then
    return jsonb_build_object('shiftId', v_shift.id, 'arrivedAt', v_shift.arrived_at, 'changed', false);
  end if;
  if v_shift.status <> 'AVAILABLE' then
    raise exception 'RPM_SHIFT_STATE' using errcode='55000';
  end if;

  select latitude, longitude into v_store from public.restaurants where id = v_shift.restaurant_id;
  if p_latitude is not null and v_store.latitude is not null then
    v_meters := private.distance_meters(p_latitude, p_longitude,
      v_store.latitude::double precision, v_store.longitude::double precision);
  end if;
  if coalesce(p_auto, false) then
    if v_meters is null or v_meters > 100 or coalesce(p_accuracy, 0) > 50 then
      raise exception 'RPM_NOT_AT_STORE' using errcode='55000';
    end if;
  elsif v_meters is not null and private.is_far(v_meters, p_accuracy) then
    raise exception 'RPM_FAR_FROM_STORE %', v_meters using errcode='55000', detail=v_meters::text;
  end if;

  perform private.enter_queue(v_shift.id, v_now, case when coalesce(p_auto, false) then 'GPS' else 'BUTTON' end);
  return jsonb_build_object('shiftId', v_shift.id, 'arrivedAt', v_now, 'changed', true);
end; $$;

-- The store sees the courier at the counter: "Chegou" in the panel (any active member).
create function public.mark_shift_arrived(p_restaurant_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_shift public.courier_shifts;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_shift from public.courier_shifts
    where id = p_shift_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_SHIFT_NOT_FOUND' using errcode='P0002';
  end if;
  if v_shift.arrived_at is not null then
    return jsonb_build_object('shiftId', v_shift.id, 'arrivedAt', v_shift.arrived_at, 'changed', false);
  end if;
  if v_shift.status <> 'AVAILABLE' then
    raise exception 'RPM_SHIFT_STATE' using errcode='55000';
  end if;
  perform private.enter_queue(v_shift.id, v_now, 'STORE');
  return jsonb_build_object('shiftId', v_shift.id, 'arrivedAt', v_now, 'changed', true);
end; $$;

-- Same as 20261124120000, except: only couriers who arrived are in line (queuePosition), and the
-- shift says when the courier arrived (arrivedAt, null while "a caminho").
create or replace function private.courier_home_core()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_courier public.couriers;
  v_shift public.courier_shifts;
  v_position integer;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  select * into v_courier from public.couriers where user_id = auth.uid();
  if not found then
    raise exception 'RPM_COURIER_REQUIRED' using errcode='42501';
  end if;

  select * into v_shift from public.courier_shifts
    where courier_id = v_courier.id and status not in ('ENDED','REJECTED');

  if v_shift.id is not null and v_shift.status = 'AVAILABLE' and v_shift.arrived_at is not null
    and not exists (select 1 from public.routes r
      where r.courier_shift_id = v_shift.id and r.status = 'PREPARING') then
    select count(*) + 1 into v_position from public.courier_shifts s
      where s.restaurant_id = v_shift.restaurant_id and s.status = 'AVAILABLE'
        and s.arrived_at is not null
        and s.id <> v_shift.id
        and not exists (select 1 from public.routes r
          where r.courier_shift_id = s.id and r.status = 'PREPARING')
        and (s.available_since, s.requested_at, s.id)
          < (v_shift.available_since, v_shift.requested_at, v_shift.id);
  end if;

  return jsonb_build_object(
    'serverNow', now(),
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
        'restaurantId', r.id, 'name', r.name, 'linkStatus', rc.status,
        'phone', case when rc.status = 'ACTIVE' then r.phone end,
        'address', case when rc.status = 'ACTIVE' then r.address end,
        'latitude', case when rc.status = 'ACTIVE' then r.latitude end,
        'longitude', case when rc.status = 'ACTIVE' then r.longitude end)
        order by r.name, r.id)
      from public.restaurant_couriers rc
      join public.restaurants r on r.id = rc.restaurant_id
      where rc.courier_id = v_courier.id and r.is_active
        and rc.status in ('ACTIVE','PENDING')), '[]'::jsonb),
    'refusedStores', coalesce((select jsonb_agg(jsonb_build_object(
        'restaurantId', r.id, 'name', r.name, 'linkStatus', rc.status,
        'since', coalesce(rc.suspended_at, rc.updated_at))
        order by coalesce(rc.suspended_at, rc.updated_at) desc, r.id)
      from public.restaurant_couriers rc
      join public.restaurants r on r.id = rc.restaurant_id
      where rc.courier_id = v_courier.id and r.is_active
        and rc.status in ('REJECTED','SUSPENDED')), '[]'::jsonb),
    'shift', case when v_shift.id is null then null else jsonb_build_object(
        'shiftId', v_shift.id,
        'restaurantId', v_shift.restaurant_id,
        'restaurantName', (select r.name from public.restaurants r where r.id = v_shift.restaurant_id),
        'status', v_shift.status,
        'requestedAt', v_shift.requested_at,
        'availableSince', v_shift.available_since,
        'arrivedAt', v_shift.arrived_at,
        'queuePosition', v_position) end,
    'route', public.get_courier_route(),
    'today', private.courier_today(v_courier.id));
end; $$;

-- Panel: when each open shift arrived (null = "a caminho").
alter function public.get_operations_board(uuid) set schema private;
alter function private.get_operations_board(uuid) rename to operations_board_payments;

create function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_board jsonb := private.operations_board_payments(p_restaurant_id);
begin
  -- Membership was checked by the core.
  return v_board || jsonb_build_object('shiftArrivals', (
    select coalesce(jsonb_agg(jsonb_build_object('shiftId', s.id, 'arrivedAt', s.arrived_at) order by s.id), '[]')
    from public.courier_shifts s
    where s.restaurant_id = p_restaurant_id and s.status in ('PENDING','AVAILABLE','ON_ROUTE','RETURNING')));
end; $$;

revoke all on function private.courier_shift_arrival_on_route() from public, anon, authenticated;
revoke all on function private.enter_queue(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function private.operations_board_payments(uuid) from public, anon, authenticated;
revoke all on function public.arrive_for_shift(double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.arrive_for_shift(double precision, double precision, double precision, boolean) to authenticated;
revoke all on function public.mark_shift_arrived(uuid, uuid) from public, anon;
grant execute on function public.mark_shift_arrived(uuid, uuid) to authenticated;
revoke all on function public.get_operations_board(uuid) from public, anon;
grant execute on function public.get_operations_board(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
