-- RPM-CORE-013. Estabelecimentos no app do motoboy: contato das lojas e vínculos recusados.
-- Forward-only; hosted application requires separate approval.
--
-- Same answer as 20261114180000, plus:
--   stores[]          an approved store (ACTIVE) carries its phone, address and pin, so the
--                     courier can call it or open the way there; a pending one carries nothing
--                     beyond its name, as before.
--   refusedStores[]   links the store refused or suspended, with when it happened, so the
--                     courier knows instead of waiting forever. Kept apart from stores[]: only
--                     stores[] can ask for a shift.
begin;

create or replace function public.get_courier_home()
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
        'queuePosition', v_position) end,
    'route', public.get_courier_route(),
    'today', private.courier_today(v_courier.id));
end; $$;

notify pgrst, 'reload schema';
commit;
