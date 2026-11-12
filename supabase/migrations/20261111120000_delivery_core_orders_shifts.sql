-- RPM-CORE-001. Núcleo operacional, fatia 1: pedidos e turnos.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md
begin;

-- =========================================================
-- SCHEMA
-- =========================================================

alter table public.restaurants
  add column default_delivery_promise_minutes integer not null default 60,
  add constraint restaurants_default_promise_check
    check (default_delivery_promise_minutes between 1 and 240);

-- Existing rows only receive NULL in the new columns, so every new
-- constraint is valid for legacy data.
alter table public.orders
  add column complement text,
  add column latitude double precision,
  add column longitude double precision,
  add column address_provider text,
  add column address_provider_id text,
  add column ordered_at timestamptz,
  add column promised_minutes integer,
  add column created_by uuid references public.profiles(id),
  add column client_request_id uuid;

alter table public.orders
  add constraint orders_coordinates_pair_check
    check ((latitude is null) = (longitude is null)),
  add constraint orders_latitude_check
    check (latitude is null or latitude between -90 and 90),
  add constraint orders_longitude_check
    check (longitude is null or longitude between -180 and 180),
  add constraint orders_address_provider_check
    check ((address_provider is null and address_provider_id is null)
      or (address_provider = 'mapbox'
        and address_provider_id ~ '^[A-Za-z0-9_-]{1,255}$'
        and latitude is not null)),
  add constraint orders_promised_minutes_check
    check (promised_minutes is null or promised_minutes between 1 and 240),
  -- Idempotency key from the client. NULL (legacy rows) never conflicts.
  add constraint orders_client_request_unique
    unique (restaurant_id, client_request_id);

-- =========================================================
-- PRIVATE HELPERS
-- =========================================================

create function private.require_restaurant_member(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  -- Keep the membership row stable until the command commits.
  perform 1 from public.restaurant_members rm
    join public.restaurants r on r.id = rm.restaurant_id
    where rm.restaurant_id = p_restaurant_id and rm.user_id = auth.uid()
      and rm.active and r.is_active
    for share of rm;
  if not found then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode='42501';
  end if;
end; $$;

-- Trimmed text or NULL when empty.
create function private.clean_text(p_value text)
returns text language sql immutable set search_path='' as $$
  select nullif(regexp_replace(coalesce(p_value,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
$$;

-- Brazilian phone (landline or mobile) normalized to +55DDNNNNNNNN(N).
-- Accepts common formatting: spaces, dashes, parentheses, with/without +55.
create function private.normalize_br_phone(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v text := regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
begin
  if length(v) in (10,11) then v := '55' || v; end if;
  v := '+' || v;
  if v ~ '^[+]55[1-9][1-9][0-9]{8,9}$' then return v; end if;
  return null;
end; $$;

-- =========================================================
-- ORDERS
-- =========================================================

create function public.create_order(
  p_restaurant_id uuid,
  p_request_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_complement text default null,
  p_neighborhood text default null,
  p_reference text default null,
  p_notes text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_address_provider text default null,
  p_address_provider_id text default null,
  p_ordered_at timestamptz default null,
  p_promised_minutes integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_name text := private.clean_text(p_customer_name);
  v_phone text := private.normalize_br_phone(p_customer_phone);
  v_address text := private.clean_text(p_delivery_address);
  v_complement text := private.clean_text(p_complement);
  v_neighborhood text := private.clean_text(p_neighborhood);
  v_reference text := private.clean_text(p_reference);
  v_notes text := private.clean_text(p_notes);
  v_provider text := private.clean_text(p_address_provider);
  v_provider_id text := private.clean_text(p_address_provider_id);
  v_ordered_at timestamptz := coalesce(p_ordered_at, v_now);
  v_promise integer;
  v_order_id uuid;
  v_delivery_id uuid;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_request_id is null then
    raise exception 'RPM_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;

  -- Replay of an already committed command returns the same result.
  select o.id, d.id into v_order_id, v_delivery_id
    from public.orders o join public.deliveries d on d.order_id = o.id
    where o.restaurant_id = p_restaurant_id and o.client_request_id = p_request_id;
  if found then
    return jsonb_build_object('orderId',v_order_id,'deliveryId',v_delivery_id,'created',false);
  end if;

  if v_name is null or char_length(v_name) > 120 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='customer_name'; end if;
  if v_phone is null then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='customer_phone'; end if;
  if v_address is null or char_length(v_address) > 500 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='delivery_address'; end if;
  if char_length(v_complement) > 120 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='complement'; end if;
  if char_length(v_neighborhood) > 120 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='neighborhood'; end if;
  if char_length(v_reference) > 200 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='reference'; end if;
  if char_length(v_notes) > 500 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='notes'; end if;
  if (p_latitude is null) <> (p_longitude is null)
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='coordinates'; end if;
  if not ((v_provider is null and v_provider_id is null)
    or (v_provider = 'mapbox' and v_provider_id ~ '^[A-Za-z0-9_-]{1,255}$'
      and p_latitude is not null)) then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='address_provider'; end if;
  -- Orders may be registered late (up to 24 h), never in the future.
  -- Five minutes of tolerance absorb device clock drift.
  if v_ordered_at < v_now - interval '24 hours' or v_ordered_at > v_now + interval '5 minutes' then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='ordered_at'; end if;
  v_ordered_at := least(v_ordered_at, v_now);

  select default_delivery_promise_minutes into v_promise
    from public.restaurants where id = p_restaurant_id;
  v_promise := coalesce(p_promised_minutes, v_promise);
  if v_promise not between 1 and 240 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='promised_minutes'; end if;

  insert into public.orders (
    restaurant_id, customer_name, customer_phone, delivery_address, complement,
    neighborhood, reference, notes, latitude, longitude, address_provider,
    address_provider_id, ordered_at, promised_minutes, created_by, client_request_id)
  values (
    p_restaurant_id, v_name, v_phone, v_address, v_complement,
    v_neighborhood, v_reference, v_notes, p_latitude, p_longitude, v_provider,
    v_provider_id, v_ordered_at, v_promise, auth.uid(), p_request_id)
  on conflict (restaurant_id, client_request_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    -- A concurrent replay committed first; return its result.
    select o.id, d.id into v_order_id, v_delivery_id
      from public.orders o join public.deliveries d on d.order_id = o.id
      where o.restaurant_id = p_restaurant_id and o.client_request_id = p_request_id;
    return jsonb_build_object('orderId',v_order_id,'deliveryId',v_delivery_id,'created',false);
  end if;

  insert into public.deliveries (restaurant_id, order_id)
    values (p_restaurant_id, v_order_id)
    returning id into v_delivery_id;

  return jsonb_build_object('orderId',v_order_id,'deliveryId',v_delivery_id,'created',true);
end; $$;

-- Only orders that are not part of any route. Cancelling on route is a
-- route-execution command (slice 3).
create function public.cancel_order(p_restaurant_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_delivery public.deliveries;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_delivery from public.deliveries
    where order_id = p_order_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_delivery.status = 'CANCELLED' then return 'CANCELLED'; end if;
  if v_delivery.status <> 'WAITING' then
    raise exception 'RPM_ORDER_NOT_CANCELLABLE' using errcode='55000';
  end if;
  update public.deliveries set status='CANCELLED', cancelled_at=clock_timestamp()
    where id = v_delivery.id;
  update public.orders set status='CANCELLED'
    where id = p_order_id and restaurant_id = p_restaurant_id;
  return 'CANCELLED';
end; $$;

-- =========================================================
-- COURIER SHIFTS
-- =========================================================

create function public.request_shift(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_courier public.couriers;
  v_name text;
  v_link_id uuid;
  v_shift public.courier_shifts;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  select * into v_courier from public.couriers where user_id = auth.uid();
  if not found then
    raise exception 'RPM_COURIER_REQUIRED' using errcode='42501';
  end if;
  select name into v_name from public.profiles where id = auth.uid();
  if not private.courier_registration_complete(v_name, v_courier.motorcycle_model,
    v_courier.motorcycle_plate, v_courier.motorcycle_color) then
    raise exception 'RPM_COURIER_REGISTRATION_INCOMPLETE' using errcode='22023';
  end if;
  select rc.id into v_link_id from public.restaurant_couriers rc
    join public.restaurants r on r.id = rc.restaurant_id
    where rc.restaurant_id = p_restaurant_id and rc.courier_id = v_courier.id
      and rc.status = 'ACTIVE' and r.is_active
    for share of rc;
  if not found then
    raise exception 'RPM_COURIER_LINK_REQUIRED' using errcode='42501';
  end if;

  -- courier_shifts_one_open_shift_per_courier_idx is the real guarantee:
  -- concurrent requests cannot both create an open shift.
  begin
    insert into public.courier_shifts (courier_id, restaurant_id, restaurant_courier_id)
      values (v_courier.id, p_restaurant_id, v_link_id)
      returning * into v_shift;
    return jsonb_build_object('shiftId',v_shift.id,'status',v_shift.status,'created',true);
  exception when unique_violation then
    select * into v_shift from public.courier_shifts
      where courier_id = v_courier.id and status not in ('ENDED','REJECTED');
  end;
  if v_shift.restaurant_id <> p_restaurant_id then
    raise exception 'RPM_SHIFT_OPEN_ELSEWHERE' using errcode='55000';
  end if;
  return jsonb_build_object('shiftId',v_shift.id,'status',v_shift.status,'created',false);
end; $$;

create function public.review_shift(p_restaurant_id uuid, p_shift_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_shift public.courier_shifts;
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
      update public.courier_shifts set status='AVAILABLE', approved_at=v_now,
        approved_by=auth.uid(), started_at=v_now, available_since=v_now
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

-- The courier may end their own shift; any active member of the shift's
-- restaurant may end it administratively. Never while a route is active.
create function public.end_shift(p_shift_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_shift public.courier_shifts;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  select * into v_shift from public.courier_shifts s
    where s.id = p_shift_id
      and (s.courier_id = private.current_courier_id()
        or private.is_restaurant_member(s.restaurant_id))
    for update;
  -- Same outcome for missing and foreign shifts: no enumeration.
  if not found then
    raise exception 'RPM_SHIFT_NOT_FOUND' using errcode='P0002';
  end if;
  if v_shift.status in ('ENDED','REJECTED') then return v_shift.status::text; end if;
  if v_shift.status in ('ON_ROUTE','RETURNING') or exists (
    select 1 from public.routes
      where courier_shift_id = v_shift.id
        and status in ('PREPARING','ON_ROUTE','RETURNING')) then
    raise exception 'RPM_SHIFT_BUSY' using errcode='55000';
  end if;
  update public.courier_shifts set status='ENDED', ended_at=clock_timestamp(), ended_by=auth.uid()
    where id = v_shift.id;
  return 'ENDED';
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================

revoke all on function private.require_restaurant_member(uuid),
  private.clean_text(text), private.normalize_br_phone(text)
  from public, anon, authenticated;

revoke all on function
  public.create_order(uuid,uuid,text,text,text,text,text,text,text,
    double precision,double precision,text,text,timestamptz,integer),
  public.cancel_order(uuid,uuid),
  public.request_shift(uuid),
  public.review_shift(uuid,uuid,boolean),
  public.end_shift(uuid)
  from public, anon;

grant execute on function
  public.create_order(uuid,uuid,text,text,text,text,text,text,text,
    double precision,double precision,text,text,timestamptz,integer),
  public.cancel_order(uuid,uuid),
  public.request_shift(uuid),
  public.review_shift(uuid,uuid,boolean),
  public.end_shift(uuid)
  to authenticated;

-- No direct table writes, RLS policies or GPS privileges are changed.
notify pgrst, 'reload schema';
commit;
