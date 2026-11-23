-- Pedidos que chegam de fora: origem e código externo.
-- Forward-only; hosted application requires separate approval.
-- Prepares the integrations (the print capture tool, Open Delivery). Each order records where it came
-- from, and an order brought from another system keeps that system's code, so the same order imported
-- twice (a reprint, a webhook delivered again) answers the order already created instead of a copy.
begin;

alter table public.orders
  add column source text not null default 'PANEL',
  -- The app or system the order came from, as the store knows it ("99Food", "Keeta", "Balcão").
  add column source_app text,
  -- The order's code in that system.
  add column external_id text;

alter table public.orders
  add constraint orders_source_check check (source in ('PANEL', 'PRINTER', 'OPEN_DELIVERY')),
  add constraint orders_source_app_check check (source_app is null or char_length(source_app) between 1 and 40),
  add constraint orders_external_id_check
    check (external_id is null or (char_length(external_id) between 1 and 80 and external_id !~ '[[:cntrl:]]')),
  -- Orders typed in the panel carry no external code; imported ones always do.
  add constraint orders_external_source_check check ((source = 'PANEL') = (external_id is null));

-- One order per external code, per store, system and app.
create unique index orders_external_unique
  on public.orders (restaurant_id, source, coalesce(source_app, ''), external_id)
  where external_id is not null;

-- Brings an order from another system. Same checks and answer as create_order; when the store already
-- has the order with this code, answers it with created=false and changes nothing.
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
  p_promised_minutes integer default null
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
  v_result := public.create_order(
    p_restaurant_id,
    md5(concat_ws('|', p_restaurant_id::text, p_source, coalesce(v_app, ''), v_external))::uuid,
    p_customer_name, p_customer_phone, p_delivery_address, p_complement, p_neighborhood,
    p_reference, p_notes, p_latitude, p_longitude, p_address_provider, p_address_provider_id,
    p_ordered_at, p_promised_minutes);
  if (v_result->>'created')::boolean then
    update public.orders set source = p_source, source_app = v_app, external_id = v_external
      where id = (v_result->>'orderId')::uuid;
  end if;
  return v_result;
end; $$;

revoke all on function public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) from public, anon;
grant execute on function public.import_order(uuid, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, timestamptz, integer) to authenticated;

-- The board shows where each imported order came from (orders typed in the panel are not listed).
create or replace function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_board jsonb := private.operations_board_core(p_restaurant_id);
  v_since timestamptz := clock_timestamp() - interval '12 hours';
begin
  -- Membership was checked by the core.
  return v_board || jsonb_build_object(
    'farDeliveries', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'deliveryId', a.delivery_id,
          'routeId', a.route_id,
          'distanceMeters', a.distance_meters,
          'reportedAt', a.reported_at)
        order by a.reported_at desc, a.id), '[]')
        from public.delivery_attempts a
        where a.restaurant_id = p_restaurant_id and a.outcome = 'DELIVERED' and a.far_from_address
          and a.reported_at >= v_since),
    -- How each stop ended on each route ("at": when it was delivered there).
    'routeOutcomes', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'routeId', x.route_id, 'deliveryId', x.delivery_id, 'outcome', x.outcome, 'at', x.at)
        order by x.route_id, x.delivery_id), '[]')
      from (
        select rd.route_id, rd.delivery_id,
          (select max(a.reported_at) from public.delivery_attempts a
            where a.route_id = rd.route_id and a.delivery_id = rd.delivery_id and a.outcome = 'DELIVERED') as at,
          case
            when exists (select 1 from public.delivery_attempts a
              where a.route_id = rd.route_id and a.delivery_id = rd.delivery_id and a.outcome = 'DELIVERED')
              then 'DELIVERED'
            when d.status = 'CANCELLED' then 'CANCELLED'
            when r.status = 'COMPLETED' or d.status = 'WAITING' or exists (
              select 1 from public.route_deliveries other
                join public.routes o on o.id = other.route_id
                where other.delivery_id = rd.delivery_id and other.route_id <> rd.route_id
                  and o.status in ('PREPARING','ON_ROUTE','RETURNING'))
              then 'RETURNED'
          end as outcome
        from jsonb_array_elements(v_board->'routes') shown
        join public.routes r on r.id = (shown->>'id')::uuid
        join public.route_deliveries rd on rd.route_id = r.id
        join public.deliveries d on d.id = rd.delivery_id
      ) x
      where x.outcome is not null),
    -- Last GPS point of each route on the street, if it is from the last 15 minutes.
    'routePositions', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'routeId', p.route_id, 'latitude', p.latitude, 'longitude', p.longitude, 'recordedAt', p.recorded_at)
        order by p.route_id), '[]')
      from jsonb_array_elements(v_board->'routes') shown
      join public.routes r on r.id = (shown->>'id')::uuid and r.status in ('ON_ROUTE','RETURNING')
      cross join lateral (
        select l.route_id, l.latitude::double precision as latitude, l.longitude::double precision as longitude, l.recorded_at
          from public.courier_locations l
          where l.route_id = r.id and l.recorded_at >= clock_timestamp() - interval '15 minutes'
          order by l.recorded_at desc limit 1) p),
    -- The customer's tracking link of each order on the board (the store sends it).
    'trackingTokens', (
      select coalesce(jsonb_agg(jsonb_build_object('deliveryId', d.id, 'token', d.tracking_token)
        order by d.id), '[]')
      from jsonb_array_elements(v_board->'orders') o
      join public.deliveries d on d.id = (o->>'deliveryId')::uuid
      where d.tracking_token is not null),
    -- Where each imported order on the board came from.
    'orderSources', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'deliveryId', d.id, 'source', ord.source, 'app', ord.source_app, 'externalId', ord.external_id)
        order by d.id), '[]')
      from jsonb_array_elements(v_board->'orders') o
      join public.deliveries d on d.id = (o->>'deliveryId')::uuid
      join public.orders ord on ord.id = d.order_id
      where ord.source <> 'PANEL'),
    'storeLocation', (
      select case when s.latitude is null then null
        else jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude) end
      from public.restaurants s where s.id = p_restaurant_id));
end; $$;

revoke all on function public.get_operations_board(uuid) from public, anon;
grant execute on function public.get_operations_board(uuid) to authenticated;

commit;
