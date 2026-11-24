-- Cobrança na entrega e o contato 0800 do iFood.
-- Forward-only; hosted application requires separate approval.
--
-- 1. Payment. Each order may say how the customer pays:
--   PAID  already paid (online, in the app, at the counter): the courier collects nothing;
--   CASH  cash at the door, maybe with change for a bill ("troco para R$ 100");
--   CARD  card at the door: the courier takes the card machine;
--   PIX   Pix at the door (the card machine's QR or the store's key).
-- Anything but PAID carries the amount to collect. Orders saved before this, or brought in without
-- it, have no payment (null): the screens say "pagamento não informado".
--
-- 2. Contact. iFood hides the customer's mobile: its receipt prints "0800 718 2283 ID: 12345678",
-- the same 0800 for every customer. That number is not the customer's phone: it would merge every
-- iFood customer in "já pediu aqui" and send WhatsApp messages to the 0800. An order brought from
-- another system (printer, delivery app) may come with this contact instead of a mobile; it is kept
-- in customer_contact, for the store to call. Orders typed in the panel still need the mobile.
-- Without a mobile, no WhatsApp is queued for the order (the app already tells its customer).
--
-- create_order, import_order and update_order are rewritten with the same checks as before plus
-- these fields, all with defaults, so a panel without this version keeps working.
begin;

-- =========================================================
-- 1. Columns
-- =========================================================
alter table public.orders
  add column payment_method text,
  -- In cents. Only when the courier collects.
  add column amount_due_cents integer,
  -- In cents: the bill the customer pays with, when it needs change. Only for cash.
  add column change_for_cents integer,
  -- The delivery app's contact for this customer ("0800 718 2283 · ID 12345678"), when it hides the mobile.
  add column customer_contact text;

alter table public.orders alter column customer_phone drop not null;

alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method is null or payment_method in ('PAID', 'CASH', 'CARD', 'PIX')),
  add constraint orders_payment_amount_check
    check (case when payment_method is null or payment_method = 'PAID' then amount_due_cents is null
      else coalesce(amount_due_cents between 1 and 10000000, false) end),
  add constraint orders_payment_change_check
    check (change_for_cents is null
      or (payment_method = 'CASH' and change_for_cents > amount_due_cents and change_for_cents <= 10000000)),
  add constraint orders_customer_contact_check
    check (customer_contact is null or (char_length(customer_contact) between 1 and 80 and customer_contact !~ '[[:cntrl:]]')),
  -- Someone the store can call: the customer's mobile, or the app's contact.
  add constraint orders_customer_reach_check check (customer_phone is not null or customer_contact is not null);

-- Same rules as the payment constraints, said as RPM_ORDER_FIELDS 'payment' before anything is written.
create function private.check_order_payment(p_method text, p_amount_cents integer, p_change_cents integer)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_method is null then
    if p_amount_cents is not null or p_change_cents is not null then
      raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='payment'; end if;
    return;
  end if;
  if p_method not in ('PAID', 'CASH', 'CARD', 'PIX')
    or (p_method = 'PAID') <> (p_amount_cents is null)
    or coalesce(p_amount_cents not between 1 and 10000000, false)
    or (p_change_cents is not null and (p_method <> 'CASH'
      or p_change_cents <= p_amount_cents or p_change_cents > 10000000)) then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='payment';
  end if;
end; $$;

-- The mobile, or null when the app's contact stands for it. A typed but invalid phone is an error,
-- and so is no phone without a contact.
create function private.order_phone(p_phone text, p_contact text)
returns text language plpgsql immutable set search_path='' as $$
declare v_phone text := private.normalize_br_phone(p_phone);
begin
  if p_contact is not null and (char_length(p_contact) > 80 or p_contact ~ '[[:cntrl:]]') then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='customer_contact'; end if;
  if v_phone is null and (private.clean_text(p_phone) is not null or p_contact is null) then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='customer_phone'; end if;
  return v_phone;
end; $$;

-- =========================================================
-- 2. Orders: create, import and edit
-- =========================================================
drop function public.create_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer);
drop function public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer);
drop function public.update_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer, boolean);

-- create_order's checks (20261111120000), plus the payment and, for imports only, the app's contact.
-- A replay (same request id) answers the order already saved and changes nothing.
create function private.create_order_core(
  p_restaurant_id uuid,
  p_request_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_complement text,
  p_neighborhood text,
  p_reference text,
  p_notes text,
  p_latitude double precision,
  p_longitude double precision,
  p_address_provider text,
  p_address_provider_id text,
  p_ordered_at timestamptz,
  p_promised_minutes integer,
  p_payment_method text,
  p_amount_due_cents integer,
  p_change_for_cents integer,
  p_customer_contact text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_name text := private.clean_text(p_customer_name);
  v_contact text := private.clean_text(p_customer_contact);
  v_phone text;
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
  v_phone := private.order_phone(p_customer_phone, v_contact);
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
  perform private.check_order_payment(p_payment_method, p_amount_due_cents, p_change_for_cents);

  select default_delivery_promise_minutes into v_promise
    from public.restaurants where id = p_restaurant_id;
  v_promise := coalesce(p_promised_minutes, v_promise);
  if v_promise not between 1 and 240 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='promised_minutes'; end if;

  insert into public.orders (
    restaurant_id, customer_name, customer_phone, customer_contact, delivery_address, complement,
    neighborhood, reference, notes, latitude, longitude, address_provider,
    address_provider_id, ordered_at, promised_minutes, created_by, client_request_id,
    payment_method, amount_due_cents, change_for_cents)
  values (
    p_restaurant_id, v_name, v_phone, v_contact, v_address, v_complement,
    v_neighborhood, v_reference, v_notes, p_latitude, p_longitude, v_provider,
    v_provider_id, v_ordered_at, v_promise, auth.uid(), p_request_id,
    p_payment_method, p_amount_due_cents, p_change_for_cents)
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

-- Typed in the panel: the customer's mobile is required.
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
  p_promised_minutes integer default null,
  p_payment_method text default null,
  p_amount_due_cents integer default null,
  p_change_for_cents integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return private.create_order_core(p_restaurant_id, p_request_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_complement, p_neighborhood, p_reference, p_notes, p_latitude, p_longitude,
    p_address_provider, p_address_provider_id, p_ordered_at, p_promised_minutes,
    p_payment_method, p_amount_due_cents, p_change_for_cents, null);
end; $$;

-- import_order (20261130120000), plus the payment and the app's contact in place of a hidden mobile.
-- The same code imported again answers the order already there and changes nothing.
create function public.import_order(
  p_restaurant_id uuid,
  p_source text,
  p_external_id text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_source_app text default null,
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
  p_payment_method text default null,
  p_amount_due_cents integer default null,
  p_change_for_cents integer default null,
  p_customer_contact text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_external text := private.clean_text(p_external_id);
  v_app text := private.clean_text(p_source_app);
  v_order_id uuid;
  v_delivery_id uuid;
  v_result jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_source is null or p_source not in ('PRINTER', 'OPEN_DELIVERY') then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='source'; end if;
  if v_external is null or char_length(v_external) > 80 or v_external ~ '[[:cntrl:]]' then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='external_id'; end if;
  if char_length(v_app) > 40 then
    raise exception 'RPM_ORDER_FIELDS' using errcode='22023', detail='source_app'; end if;

  select o.id, d.id into v_order_id, v_delivery_id
    from public.orders o join public.deliveries d on d.order_id = o.id
    where o.restaurant_id = p_restaurant_id and o.source = p_source
      and coalesce(o.source_app, '') = coalesce(v_app, '') and o.external_id = v_external;
  if found then
    return jsonb_build_object('orderId', v_order_id, 'deliveryId', v_delivery_id, 'created', false);
  end if;

  -- The request id comes from the external code, so two imports of the same order at the same time
  -- meet on create_order's idempotency key and only one order is created.
  v_result := private.create_order_core(
    p_restaurant_id,
    md5(concat_ws('|', p_restaurant_id::text, p_source, coalesce(v_app, ''), v_external))::uuid,
    p_customer_name, p_customer_phone, p_delivery_address, p_complement, p_neighborhood,
    p_reference, p_notes, p_latitude, p_longitude, p_address_provider, p_address_provider_id,
    p_ordered_at, p_promised_minutes, p_payment_method, p_amount_due_cents, p_change_for_cents,
    p_customer_contact);
  if (v_result->>'created')::boolean then
    update public.orders set source = p_source, source_app = v_app, external_id = v_external
      where id = (v_result->>'orderId')::uuid;
  end if;
  return v_result;
end; $$;

-- update_order (20261122120000), plus the payment: the one sent is saved (none sent, none kept).
-- An order with the app's contact may keep no mobile; the contact itself is never removed.
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
  p_keep_location boolean default false,
  p_payment_method text default null,
  p_amount_due_cents integer default null,
  p_change_for_cents integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_name text := private.clean_text(p_customer_name);
  v_phone text;
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
  v_phone := private.order_phone(p_customer_phone, v_order.customer_contact);
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
  perform private.check_order_payment(p_payment_method, p_amount_due_cents, p_change_for_cents);

  update public.orders set
    customer_name = v_name, customer_phone = v_phone, delivery_address = v_address,
    complement = v_complement, neighborhood = v_neighborhood, reference = v_reference, notes = v_notes,
    ordered_at = v_ordered_at, promised_minutes = v_promise,
    payment_method = p_payment_method, amount_due_cents = p_amount_due_cents, change_for_cents = p_change_for_cents,
    latitude = case when v_keep then latitude else p_latitude end,
    longitude = case when v_keep then longitude else p_longitude end,
    address_provider = case when v_keep then address_provider else v_provider end,
    address_provider_id = case when v_keep then address_provider_id else v_provider_id end
  where id = p_order_id and restaurant_id = p_restaurant_id;

  return jsonb_build_object('orderId', p_order_id, 'updated', true);
end; $$;

-- =========================================================
-- 3. WhatsApp: only to a customer's mobile
-- =========================================================
create or replace function private.enqueue_route_started_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.delivery_notifications
    (restaurant_id, delivery_id, channel, type, destination, provider, status)
  select d.restaurant_id, d.id, 'WHATSAPP', 'TRACKING_LINK', o.customer_phone, 'meta_cloud', 'PENDING'
    from public.route_deliveries rd
    join public.deliveries d on d.id = rd.delivery_id
    join public.orders o on o.id = d.order_id
    where rd.route_id = new.id
      -- An order with only the app's contact: the app tells its customer.
      and o.customer_phone is not null
  on conflict (delivery_id, channel, type) do nothing;
  return null;
end; $$;

create or replace function private.enqueue_next_delivery_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_route uuid;
begin
  select r.id into v_route from public.route_deliveries rd
    join public.routes r on r.id = rd.route_id
    where rd.delivery_id = new.id and r.status = 'ON_ROUTE';
  if v_route is null then return null; end if;
  -- Nothing settled on the route yet: this is the start, covered by "saiu para entrega".
  if not exists (select 1 from public.delivery_attempts a where a.route_id = v_route) then return null; end if;
  insert into public.delivery_notifications
    (restaurant_id, delivery_id, channel, type, destination, provider, status)
  select new.restaurant_id, new.id, 'WHATSAPP', 'NEXT_DELIVERY', o.customer_phone, 'meta_cloud', 'PENDING'
    from public.orders o where o.id = new.order_id and o.customer_phone is not null
  on conflict (delivery_id, channel, type) do nothing;
  return null;
end; $$;

-- =========================================================
-- 4. Panel: the payment and the app's contact of each order on the board.
-- =========================================================
alter function public.get_operations_board(uuid) set schema private;
alter function private.get_operations_board(uuid) rename to operations_board_sources;

create function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_board jsonb := private.operations_board_sources(p_restaurant_id);
begin
  -- Membership was checked by the core.
  return v_board || jsonb_build_object(
    'orderPayments', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'deliveryId', d.id, 'method', ord.payment_method,
          'amountDueCents', ord.amount_due_cents, 'changeForCents', ord.change_for_cents)
        order by d.id), '[]')
      from jsonb_array_elements(v_board->'orders') o
      join public.deliveries d on d.id = (o->>'deliveryId')::uuid
      join public.orders ord on ord.id = d.order_id
      where ord.payment_method is not null),
    'customerContacts', (
      select coalesce(jsonb_agg(jsonb_build_object('deliveryId', d.id, 'contact', ord.customer_contact)
        order by d.id), '[]')
      from jsonb_array_elements(v_board->'orders') o
      join public.deliveries d on d.id = (o->>'deliveryId')::uuid
      join public.orders ord on ord.id = d.order_id
      where ord.customer_contact is not null));
end; $$;

-- =========================================================
-- 5. Courier: what to collect at each stop. Still no customer phone, nor the app's contact.
-- =========================================================
create or replace function public.get_courier_route()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_courier uuid := private.require_courier();
  v_route public.routes;
begin
  select * into v_route from public.routes
    where courier_id = v_courier and status in ('PREPARING','ON_ROUTE','RETURNING');
  if not found then
    return null;
  end if;

  return private.route_progress(v_route.id) || jsonb_build_object(
    'pickupReleasedAt', v_route.pickup_released_at,
    'startedAt', v_route.started_at,
    'restaurant', (select jsonb_build_object('name', r.name, 'phone', r.phone,
        'address', r.address, 'latitude', r.latitude, 'longitude', r.longitude)
      from public.restaurants r where r.id = v_route.restaurant_id),
    'stops', (select coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId', d.id,
        'sequence', rd.sequence,
        'status', d.status,
        'retryQueuedAt', rd.retry_queued_at,
        'customerName', o.customer_name,
        'address', o.delivery_address,
        'complement', o.complement,
        'neighborhood', o.neighborhood,
        'reference', o.reference,
        'notes', o.notes,
        'latitude', o.latitude,
        'longitude', o.longitude,
        'deadlineAt', o.ordered_at + make_interval(mins => o.promised_minutes),
        'attempts', (select count(*) from public.delivery_attempts a
          where a.route_id = v_route.id and a.delivery_id = d.id),
        -- Null when the store did not say how the customer pays.
        'payment', case when o.payment_method is null then null else jsonb_build_object(
          'method', o.payment_method, 'amountDueCents', o.amount_due_cents,
          'changeForCents', o.change_for_cents) end)
        order by rd.sequence), '[]'::jsonb)
      from public.route_deliveries rd
      join public.deliveries d on d.id = rd.delivery_id
      join public.orders o on o.id = d.order_id
      where rd.route_id = v_route.id));
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================
revoke all on function
  private.check_order_payment(text, integer, integer),
  private.order_phone(text, text),
  private.create_order_core(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer, text),
  private.operations_board_sources(uuid),
  private.enqueue_route_started_notifications(),
  private.enqueue_next_delivery_notification()
  from public, anon, authenticated;

revoke all on function
  public.create_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer, text),
  public.update_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, boolean, text, integer, integer),
  public.get_operations_board(uuid),
  public.get_courier_route()
  from public, anon;
grant execute on function
  public.create_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer, text),
  public.update_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, boolean, text, integer, integer),
  public.get_operations_board(uuid),
  public.get_courier_route()
  to authenticated;

notify pgrst, 'reload schema';
commit;
