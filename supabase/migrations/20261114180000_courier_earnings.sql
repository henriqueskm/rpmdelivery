-- RPM-CORE-008. Ganhos do motoboy: taxa de encosta e valor por entrega.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md (Fatia 8)
--
-- Each store sets a daily "taxa de encosta" and a fixed value per delivery.
-- Values are copied at the moment they are earned (shift approval, delivery),
-- so changing the rates later never rewrites what was already earned.
-- Days are counted in America/Sao_Paulo. Only DELIVERED stops pay; the
-- encosta pays once per day per store, however many shifts that day.
begin;

-- =========================================================
-- SCHEMA
-- =========================================================

alter table public.restaurants
  add column courier_shift_fee_cents integer not null default 0,
  add column courier_delivery_fee_cents integer not null default 0,
  add constraint restaurants_courier_shift_fee_check
    check (courier_shift_fee_cents between 0 and 100000),
  add constraint restaurants_courier_delivery_fee_check
    check (courier_delivery_fee_cents between 0 and 100000);

-- NULL on rows from before this migration: they count as R$ 0.
alter table public.courier_shifts
  add column shift_fee_cents integer,
  add constraint courier_shifts_shift_fee_check
    check (shift_fee_cents is null or shift_fee_cents between 0 and 100000);

alter table public.delivery_attempts
  add column courier_fee_cents integer,
  add constraint delivery_attempts_courier_fee_check
    check (courier_fee_cents is null or courier_fee_cents between 0 and 100000);

-- =========================================================
-- SNAPSHOTS
-- =========================================================

-- The encosta of the day is the store's rate when it approved the shift.
create function private.snapshot_shift_fee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status = 'AVAILABLE' and old.status = 'PENDING' and new.shift_fee_cents is null then
    select r.courier_shift_fee_cents into new.shift_fee_cents
      from public.restaurants r where r.id = new.restaurant_id;
  end if;
  return new;
end; $$;

create trigger courier_shifts_snapshot_fee
  before update of status on public.courier_shifts
  for each row execute function private.snapshot_shift_fee();

-- A delivery pays the store's rate when the courier marked it delivered.
create function private.snapshot_delivery_fee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.outcome = 'DELIVERED' and new.courier_fee_cents is null then
    select r.courier_delivery_fee_cents into new.courier_fee_cents
      from public.restaurants r where r.id = new.restaurant_id;
  end if;
  return new;
end; $$;

create trigger delivery_attempts_snapshot_fee
  before insert on public.delivery_attempts
  for each row execute function private.snapshot_delivery_fee();

revoke all on function private.snapshot_shift_fee() from public;
revoke all on function private.snapshot_delivery_fee() from public;

-- =========================================================
-- EARNINGS BY DAY
-- =========================================================

-- One row per local day, store and courier with something earned.
-- p_courier or p_restaurant NULL means "any"; callers always pass one of them.
create function private.courier_earnings(p_courier uuid, p_restaurant uuid, p_from date, p_to date)
returns table (day date, restaurant_id uuid, restaurant_name text, courier_id uuid,
  deliveries integer, shift_fee_cents integer, delivery_fees_cents integer)
language sql stable security definer set search_path='' as $$
  with bounds as (
    select (p_from::timestamp at time zone 'America/Sao_Paulo') as since,
           ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as until
  ), encosta as (
    select (s.approved_at at time zone 'America/Sao_Paulo')::date as day, s.restaurant_id, s.courier_id,
           -- The day's first approved shift sets the encosta; a second shift that day adds nothing.
           (array_agg(coalesce(s.shift_fee_cents, 0) order by s.approved_at, s.id))[1] as fee
      from public.courier_shifts s, bounds b
      where s.approved_at >= b.since and s.approved_at < b.until
        and (p_courier is null or s.courier_id = p_courier)
        and (p_restaurant is null or s.restaurant_id = p_restaurant)
      group by 1, 2, 3
  ), delivered as (
    select (a.reported_at at time zone 'America/Sao_Paulo')::date as day, r.restaurant_id, r.courier_id,
           count(*)::integer as n, sum(coalesce(a.courier_fee_cents, 0))::integer as fees
      from public.delivery_attempts a
      join public.routes r on r.id = a.route_id
      cross join bounds b
      where a.outcome = 'DELIVERED' and a.reported_at >= b.since and a.reported_at < b.until
        and (p_courier is null or r.courier_id = p_courier)
        and (p_restaurant is null or r.restaurant_id = p_restaurant)
      group by 1, 2, 3
  )
  select coalesce(e.day, d.day), rr.id, rr.name, coalesce(e.courier_id, d.courier_id),
         coalesce(d.n, 0), coalesce(e.fee, 0), coalesce(d.fees, 0)
    from encosta e
    full join delivered d on d.day = e.day and d.restaurant_id = e.restaurant_id and d.courier_id = e.courier_id
    join public.restaurants rr on rr.id = coalesce(e.restaurant_id, d.restaurant_id);
$$;

revoke all on function private.courier_earnings(uuid, uuid, date, date) from public;

create function private.local_today()
returns date language sql stable set search_path='' as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- =========================================================
-- STORE: RATES AND THE DAY'S SETTLEMENT
-- =========================================================

-- Owner or manager only. Values in cents, from R$ 0 to R$ 1.000.
create function public.set_courier_pay(p_restaurant_id uuid, p_shift_fee_cents integer, p_delivery_fee_cents integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_courier_invite_manager(p_restaurant_id);
  if p_shift_fee_cents is null or p_shift_fee_cents not between 0 and 100000 then
    raise exception 'RPM_PAY_FIELDS' using errcode='22023', detail='shift_fee';
  end if;
  if p_delivery_fee_cents is null or p_delivery_fee_cents not between 0 and 100000 then
    raise exception 'RPM_PAY_FIELDS' using errcode='22023', detail='delivery_fee';
  end if;
  update public.restaurants
    set courier_shift_fee_cents = p_shift_fee_cents, courier_delivery_fee_cents = p_delivery_fee_cents
    where id = p_restaurant_id and is_active;
  if not found then
    raise exception 'RPM_MANAGER_REQUIRED' using errcode='42501';
  end if;
  return jsonb_build_object('shiftFeeCents', p_shift_fee_cents, 'deliveryFeeCents', p_delivery_fee_cents);
end; $$;

-- Any active member (OPERATOR included) sees the rates and what each courier earned on a day.
create function public.get_courier_pay(p_restaurant_id uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_day date := coalesce(p_day, private.local_today());
  v_restaurant public.restaurants;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode='42501';
  end if;
  select * into v_restaurant from public.restaurants where id = p_restaurant_id and is_active;
  if not found then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode='42501';
  end if;
  return jsonb_build_object(
    'day', v_day,
    'shiftFeeCents', v_restaurant.courier_shift_fee_cents,
    'deliveryFeeCents', v_restaurant.courier_delivery_fee_cents,
    'canEdit', exists (select 1 from public.restaurant_members m
      where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid() and m.active and m.role in ('OWNER','MANAGER')),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'deliveries', e.deliveries,
        'shiftFeeCents', e.shift_fee_cents,
        'deliveryFeesCents', e.delivery_fees_cents,
        'totalCents', e.shift_fee_cents + e.delivery_fees_cents)
        order by p.name, e.courier_id)
      from private.courier_earnings(null, p_restaurant_id, v_day, v_day) e
      join public.couriers c on c.id = e.courier_id
      join public.profiles p on p.id = c.user_id), '[]'::jsonb));
end; $$;

-- =========================================================
-- COURIER: TODAY ON THE HOME SCREEN, AND THE HISTORY
-- =========================================================

create function private.courier_today(p_courier uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'deliveries', coalesce(sum(e.deliveries), 0),
    'shiftFeeCents', coalesce(sum(e.shift_fee_cents), 0),
    'deliveryFeesCents', coalesce(sum(e.delivery_fees_cents), 0),
    'totalCents', coalesce(sum(e.shift_fee_cents + e.delivery_fees_cents), 0))
  from private.courier_earnings(p_courier, null, private.local_today(), private.local_today()) e;
$$;

revoke all on function private.courier_today(uuid) from public;

-- Same answer as slice 6, plus "today": deliveries and earnings across stores.
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
    'route', public.get_courier_route(),
    'today', private.courier_today(v_courier.id));
end; $$;

-- The courier's own days, newest first: 1 to 90 days back from today.
create function public.get_courier_history(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_courier uuid := private.require_courier();
  v_days integer := coalesce(p_days, 30);
begin
  if v_days not between 1 and 90 then
    raise exception 'RPM_HISTORY_FIELDS' using errcode='22023', detail='days';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'day', e.day,
      'restaurantName', e.restaurant_name,
      'deliveries', e.deliveries,
      'shiftFeeCents', e.shift_fee_cents,
      'deliveryFeesCents', e.delivery_fees_cents,
      'totalCents', e.shift_fee_cents + e.delivery_fees_cents)
      order by e.day desc, e.restaurant_name, e.restaurant_id)
    from private.courier_earnings(v_courier, null, private.local_today() - (v_days - 1), private.local_today()) e),
    '[]'::jsonb);
end; $$;

revoke all on function public.set_courier_pay(uuid, integer, integer) from public, anon;
revoke all on function public.get_courier_pay(uuid, date) from public, anon;
revoke all on function public.get_courier_history(integer) from public, anon;
grant execute on function public.set_courier_pay(uuid, integer, integer) to authenticated;
grant execute on function public.get_courier_pay(uuid, date) to authenticated;
grant execute on function public.get_courier_history(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
