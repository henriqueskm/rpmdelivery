-- Painel: mini mapa, horário de cada entrega e link de acompanhamento.
-- Forward-only; hosted application requires separate approval.
-- The store already receives the courier's GPS (that is what the route shares)
-- and owns its orders' tracking links; the board now carries them so the panel
-- can draw "Acompanhar rotas" on a map and copy a customer's link.
begin;

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
    'storeLocation', (
      select case when s.latitude is null then null
        else jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude) end
      from public.restaurants s where s.id = p_restaurant_id));
end; $$;

revoke all on function public.get_operations_board(uuid) from public, anon;
grant execute on function public.get_operations_board(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
