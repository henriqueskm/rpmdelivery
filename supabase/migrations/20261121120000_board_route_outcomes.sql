-- Painel: o que aconteceu com cada pedido DENTRO de cada rota.
-- Forward-only; hosted application requires separate approval.
-- A delivery that came back and left again on another route used to show its
-- current status on the old card too ("Entregue" on both). The board now says,
-- per route, which of its stops were delivered there, returned to the store or
-- cancelled; the panel shows those instead of the live status.
begin;

create or replace function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_board jsonb := private.operations_board_core(p_restaurant_id);
begin
  -- Membership was checked by the core. Same 12 hours as the rest of the board.
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
          and a.reported_at >= clock_timestamp() - interval '12 hours'),
    -- Only stops whose story on that route is over and differs from "still on it":
    -- delivered there; or no longer on it (a later route took it, or it went back to
    -- the queue); or cancelled. Stops still in play keep the live delivery status.
    'routeOutcomes', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'routeId', x.route_id, 'deliveryId', x.delivery_id, 'outcome', x.outcome)
        order by x.route_id, x.delivery_id), '[]')
      from (
        select rd.route_id, rd.delivery_id,
          case
            when exists (select 1 from public.delivery_attempts a
              where a.route_id = rd.route_id and a.delivery_id = rd.delivery_id and a.outcome = 'DELIVERED')
              then 'DELIVERED'
            when d.status = 'CANCELLED' then 'CANCELLED'
            -- No clock comparisons: the route ended without delivering it, it is back
            -- in the queue, or another route in play has it now.
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
      where x.outcome is not null));
end; $$;

revoke all on function public.get_operations_board(uuid) from public, anon;
grant execute on function public.get_operations_board(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
