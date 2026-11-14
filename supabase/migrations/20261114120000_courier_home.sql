-- RPM-CORE-006. App do motoboy: leitura única da tela inicial.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md (Fatia 6)
--
-- list_my_establishments() returns the link id, not the store id that
-- request_shift() needs, and nothing told the courier their shift status or
-- place in line. One stable read answers the courier's screen:
-- linked stores, the open shift with its place in line, and the active route
-- (the same answer as get_courier_route(), still without customer phones).
begin;

create function public.get_courier_home()
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

  -- Place in line: available couriers of the same store not reserved by a
  -- route in preparation, first available first (the panel's order).
  if v_shift.id is not null and v_shift.status = 'AVAILABLE'
    and not exists (select 1 from public.routes r
      where r.courier_shift_id = v_shift.id and r.status = 'PREPARING') then
    select count(*) + 1 into v_position from public.courier_shifts s
      where s.restaurant_id = v_shift.restaurant_id and s.status = 'AVAILABLE'
        and s.id <> v_shift.id
        and not exists (select 1 from public.routes r
          where r.courier_shift_id = s.id and r.status = 'PREPARING')
        and (s.available_since, s.requested_at, s.id)
          < (v_shift.available_since, v_shift.requested_at, v_shift.id);
  end if;

  return jsonb_build_object(
    'serverNow', now(),
    -- Approved and waiting links of active stores; a store id is what request_shift() takes.
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
        'restaurantId', r.id, 'name', r.name, 'linkStatus', rc.status)
        order by r.name, r.id)
      from public.restaurant_couriers rc
      join public.restaurants r on r.id = rc.restaurant_id
      where rc.courier_id = v_courier.id and r.is_active
        and rc.status in ('ACTIVE','PENDING')), '[]'::jsonb),
    'shift', case when v_shift.id is null then null else jsonb_build_object(
        'shiftId', v_shift.id,
        'restaurantId', v_shift.restaurant_id,
        'restaurantName', (select r.name from public.restaurants r where r.id = v_shift.restaurant_id),
        'status', v_shift.status,
        'requestedAt', v_shift.requested_at,
        'availableSince', v_shift.available_since,
        'queuePosition', v_position) end,
    'route', public.get_courier_route());
end; $$;

revoke all on function public.get_courier_home() from public, anon;
grant execute on function public.get_courier_home() to authenticated;

notify pgrst, 'reload schema';
commit;
