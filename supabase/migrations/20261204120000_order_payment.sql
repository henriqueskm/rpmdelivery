-- Cobrança na entrega: se o pedido já está pago, ou quanto e como o motoboy cobra.
-- Forward-only; hosted application requires separate approval.
--
-- Each order may say how the customer pays:
--   PAID  already paid (online, in the app, at the counter): the courier collects nothing;
--   CASH  cash at the door, maybe with change for a bill ("troco para R$ 100");
--   CARD  card at the door: the courier takes the card machine;
--   PIX   Pix at the door (the card machine's QR or the store's key).
-- Anything but PAID carries the amount to collect. Orders saved before this, or brought in without
-- it, have no payment (null): the screens say "pagamento não informado".
--
-- create_order, import_order and update_order keep their checks in private *_core functions and gain
-- three parameters with defaults, so a panel or app without this version keeps working. The board and
-- the courier's route carry the payment of each order.
begin;

alter table public.orders
  add column payment_method text,
  -- In cents. Only when the courier collects.
  add column amount_due_cents integer,
  -- In cents: the bill the customer pays with, when it needs change. Only for cash.
  add column change_for_cents integer;

alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method is null or payment_method in ('PAID', 'CASH', 'CARD', 'PIX')),
  add constraint orders_payment_amount_check
    check (case when payment_method is null or payment_method = 'PAID' then amount_due_cents is null
      else coalesce(amount_due_cents between 1 and 10000000, false) end),
  add constraint orders_payment_change_check
    check (change_for_cents is null
      or (payment_method = 'CASH' and change_for_cents > amount_due_cents and change_for_cents <= 10000000));

-- Same rules as the constraints, said as RPM_ORDER_FIELDS 'payment' before anything is written.
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

-- =========================================================
-- 1. Orders: create, import and edit with the payment.
-- =========================================================
alter function public.create_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) set schema private;
alter function private.create_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) rename to create_order_core;
alter function public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) set schema private;
alter function private.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) rename to import_order_core;
alter function public.update_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer, boolean) set schema private;
alter function private.update_order(uuid, uuid, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer, boolean) rename to update_order_core;

-- A replay (same request id) answers the order already saved and changes nothing, payment included.
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
declare
  v_result jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  perform private.check_order_payment(p_payment_method, p_amount_due_cents, p_change_for_cents);
  v_result := private.create_order_core(p_restaurant_id, p_request_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_complement, p_neighborhood, p_reference, p_notes, p_latitude, p_longitude,
    p_address_provider, p_address_provider_id, p_ordered_at, p_promised_minutes);
  if (v_result->>'created')::boolean then
    update public.orders set payment_method = p_payment_method, amount_due_cents = p_amount_due_cents,
      change_for_cents = p_change_for_cents
      where id = (v_result->>'orderId')::uuid;
  end if;
  return v_result;
end; $$;

-- The same code imported again answers the order already there and changes nothing, payment included.
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
  p_change_for_cents integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_result jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  perform private.check_order_payment(p_payment_method, p_amount_due_cents, p_change_for_cents);
  v_result := private.import_order_core(p_restaurant_id, p_source, p_external_id, p_customer_name,
    p_customer_phone, p_delivery_address, p_source_app, p_complement, p_neighborhood, p_reference, p_notes,
    p_latitude, p_longitude, p_address_provider, p_address_provider_id, p_ordered_at, p_promised_minutes);
  if (v_result->>'created')::boolean then
    update public.orders set payment_method = p_payment_method, amount_due_cents = p_amount_due_cents,
      change_for_cents = p_change_for_cents
      where id = (v_result->>'orderId')::uuid;
  end if;
  return v_result;
end; $$;

-- Editing (only while waiting for dispatch, as before) saves the payment sent: none sent, none kept.
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
  v_result jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  perform private.check_order_payment(p_payment_method, p_amount_due_cents, p_change_for_cents);
  -- The core locks the delivery and refuses an order already in a route.
  v_result := private.update_order_core(p_restaurant_id, p_order_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_complement, p_neighborhood, p_reference, p_notes, p_latitude, p_longitude,
    p_address_provider, p_address_provider_id, p_ordered_at, p_promised_minutes, p_keep_location);
  update public.orders set payment_method = p_payment_method, amount_due_cents = p_amount_due_cents,
    change_for_cents = p_change_for_cents
    where id = p_order_id and restaurant_id = p_restaurant_id;
  return v_result;
end; $$;

-- =========================================================
-- 2. Panel: the payment of each order on the board.
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
      where ord.payment_method is not null));
end; $$;

-- =========================================================
-- 3. Courier: what to collect at each stop. Still no customer phone.
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
  private.create_order_core(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer),
  private.import_order_core(uuid, text, text, text, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer),
  private.update_order_core(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, boolean),
  private.operations_board_sources(uuid)
  from public, anon, authenticated;

revoke all on function
  public.create_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.update_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, boolean, text, integer, integer),
  public.get_operations_board(uuid),
  public.get_courier_route()
  from public, anon;
grant execute on function
  public.create_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, text, integer, integer),
  public.update_order(uuid, uuid, text, text, text, text, text, text, text,
    double precision, double precision, text, text, timestamptz, integer, boolean, text, integer, integer),
  public.get_operations_board(uuid),
  public.get_courier_route()
  to authenticated;

notify pgrst, 'reload schema';
commit;
