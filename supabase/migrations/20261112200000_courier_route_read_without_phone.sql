-- RPM-SEC-PRIV-001. The courier never receives the customer's phone.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md (Leitura do motoboy)
begin;

-- Until now a courier with an active route could SELECT the whole orders
-- row, customer_phone included. Grants are per role and store staff and
-- couriers are both "authenticated", so a column grant cannot hide it from
-- one and not the other: the courier leaves the orders policy and reads the
-- route through the command below instead.
alter policy orders_select_allowed on public.orders
  using (private.is_restaurant_member(restaurant_id));

-- The courier's current route (PREPARING, ON_ROUTE or RETURNING) with what
-- the stops need at the door, in planned order. No customer phone: problems
-- at the door go through the store (report_delivery_failure).
create function public.get_courier_route()
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
          where a.route_id = v_route.id and a.delivery_id = d.id))
        order by rd.sequence), '[]'::jsonb)
      from public.route_deliveries rd
      join public.deliveries d on d.id = rd.delivery_id
      join public.orders o on o.id = d.order_id
      where rd.route_id = v_route.id));
end; $$;

revoke all on function public.get_courier_route() from public, anon;
grant execute on function public.get_courier_route() to authenticated;

notify pgrst, 'reload schema';
commit;
