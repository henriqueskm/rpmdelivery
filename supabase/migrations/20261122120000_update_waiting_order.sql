-- The store edits an order while it still waits for dispatch (same rule as cancel_order):
-- once it is in a route, its address and customer are fixed. Same validation as create_order.
-- The confirmed pin stays when the address is not changed (p_keep_location); a new address
-- brings its own pin, or none when only typed.
begin;

create function public.update_order(
  p_restaurant_id uuid,
  p_order_id uuid,
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
  p_promised_minutes integer default null,
  p_keep_location boolean default false
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
  v_keep boolean := coalesce(p_keep_location, false);
  v_order public.orders;
  v_status public.delivery_status;
  v_ordered_at timestamptz;
  v_promise integer;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  -- The delivery row is the one route commands lock: holding it, no route can take the order meanwhile.
  select d.status into v_status from public.deliveries d
    where d.order_id = p_order_id and d.restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_status <> 'WAITING' then
    raise exception 'RPM_ORDER_NOT_EDITABLE' using errcode='55000';
  end if;
  select * into v_order from public.orders
    where id = p_order_id and restaurant_id = p_restaurant_id
    for update;

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
  if not v_keep then
    if (p_latitude is null) <> (p_longitude is null)
      or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='coordinates'; end if;
    if not ((v_provider is null and v_provider_id is null)
      or (v_provider = 'mapbox' and v_provider_id ~ '^[A-Za-z0-9_-]{1,255}$'
        and p_latitude is not null)) then
      raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='address_provider'; end if;
  end if;
  -- Same window as creating it, counted from when it was registered: up to 24 h before, never ahead.
  v_ordered_at := coalesce(p_ordered_at, v_order.ordered_at, v_order.created_at);
  if v_ordered_at < v_order.created_at - interval '24 hours' or v_ordered_at > v_now + interval '5 minutes' then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='ordered_at'; end if;
  v_ordered_at := least(v_ordered_at, v_now);
  v_promise := coalesce(p_promised_minutes, v_order.promised_minutes);
  if v_promise is null or v_promise not between 1 and 240 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='promised_minutes'; end if;

  update public.orders set
    customer_name = v_name, customer_phone = v_phone, delivery_address = v_address,
    complement = v_complement, neighborhood = v_neighborhood, reference = v_reference, notes = v_notes,
    ordered_at = v_ordered_at, promised_minutes = v_promise,
    latitude = case when v_keep then latitude else p_latitude end,
    longitude = case when v_keep then longitude else p_longitude end,
    address_provider = case when v_keep then address_provider else v_provider end,
    address_provider_id = case when v_keep then address_provider_id else v_provider_id end
  where id = p_order_id and restaurant_id = p_restaurant_id;

  return jsonb_build_object('orderId', p_order_id, 'updated', true);
end; $$;

revoke all on function public.update_order(uuid,uuid,text,text,text,text,text,text,text,
  double precision,double precision,text,text,timestamptz,integer,boolean) from public, anon;
grant execute on function public.update_order(uuid,uuid,text,text,text,text,text,text,text,
  double precision,double precision,text,text,timestamptz,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
