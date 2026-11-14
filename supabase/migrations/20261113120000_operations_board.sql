-- RPM-CORE-005. Painel da loja ligado ao banco: leitura agregada.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md (Painel da loja)
begin;

-- Everything the store's operations panel shows, in one consistent snapshot:
-- open and recent orders, the couriers on shift, active and recent routes and
-- their occurrences. Read-only; every change still goes through the command
-- RPCs. Members of the store only (OPERATOR included).
--
-- "Recent" is the last 12 hours: the panel is today's counter, not history.
-- Customer phones are included because the store already reads them through
-- the orders policy; the courier never calls this function.
create function public.get_operations_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_since timestamptz := clock_timestamp() - interval '12 hours';
  v_restaurant public.restaurants;
  v_shifts jsonb;
  v_routes jsonb;
  v_orders jsonb;
  v_issues jsonb;
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

  -- Couriers on an open shift, first come first served.
  select coalesce(jsonb_agg(jsonb_build_object(
      'shiftId', s.id,
      'name', p.name,
      'status', s.status,
      'linkActive', rc.status = 'ACTIVE',
      'requestedAt', s.requested_at,
      'availableSince', s.available_since)
    order by s.available_since nulls last, s.requested_at, s.id), '[]')
    into v_shifts
    from public.courier_shifts s
    join public.couriers c on c.id = s.courier_id
    join public.profiles p on p.id = c.user_id
    join public.restaurant_couriers rc on rc.id = s.restaurant_courier_id
    where s.restaurant_id = p_restaurant_id and s.status not in ('ENDED','REJECTED');

  -- Active routes, and today's completed ones while the courier is still on shift.
  -- The reference is the route's position in the store's history (R-1, R-2...).
  with numbered as (
    select r.*, row_number() over (order by r.created_at, r.id) as number
      from public.routes r where r.restaurant_id = p_restaurant_id
  ), shown as (
    select n.* from numbered n
      join public.courier_shifts s on s.id = n.courier_shift_id
      where n.status in ('PREPARING','ON_ROUTE','RETURNING')
         or (n.status = 'COMPLETED' and n.completed_at >= v_since
             and s.status not in ('ENDED','REJECTED'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'reference', 'R-' || r.number,
      'shiftId', r.courier_shift_id,
      'status', r.status,
      'compositionVersion', r.composition_version,
      'pickupReleasedAt', r.pickup_released_at,
      'startedAt', r.started_at,
      'deliveryIds', (select coalesce(jsonb_agg(rd.delivery_id order by rd.sequence), '[]')
        from public.route_deliveries rd where rd.route_id = r.id),
      'retryDeliveryIds', (select coalesce(jsonb_agg(rd.delivery_id order by rd.retry_queued_at), '[]')
        from public.route_deliveries rd where rd.route_id = r.id and rd.retry_queued_at is not null))
    order by r.created_at desc, r.id), '[]')
    into v_routes
    from shown r;

  -- Orders still in play, today's finished ones and everything on a shown route.
  -- Without a store reference the order gets its position in the store's history.
  with numbered as (
    select o.*, row_number() over (order by o.created_at, o.id) as number
      from public.orders o where o.restaurant_id = p_restaurant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'deliveryId', d.id,
      'orderId', o.id,
      'reference', coalesce(nullif(btrim(o.reference), ''), o.number::text),
      'customer', o.customer_name,
      'phone', o.customer_phone,
      'address', o.delivery_address,
      'neighborhood', o.neighborhood,
      'complement', o.complement,
      'notes', o.notes,
      'latitude', o.latitude,
      'longitude', o.longitude,
      'orderedAt', coalesce(o.ordered_at, o.created_at),
      'createdAt', o.created_at,
      'promisedMinutes', coalesce(o.promised_minutes, v_restaurant.default_delivery_promise_minutes),
      'orderStatus', o.status,
      'deliveryStatus', d.status,
      'failedAttempts', (select count(*) from public.delivery_attempts a
        where a.delivery_id = d.id and a.outcome = 'FAILED'
          and a.route_id = (select rd.route_id from public.route_deliveries rd
            join public.routes r on r.id = rd.route_id
            where rd.delivery_id = d.id and r.status <> 'CANCELLED'
            order by r.created_at desc limit 1)))
    order by o.created_at desc, o.id), '[]')
    into v_orders
    from numbered o
    join public.deliveries d on d.order_id = o.id
    where d.status not in ('DELIVERED','CANCELLED')
       or d.updated_at >= v_since
       or exists (select 1 from jsonb_array_elements(v_routes) shown(route),
         jsonb_array_elements_text(shown.route->'deliveryIds') stop(delivery_id)
         where stop.delivery_id::uuid = d.id);

  -- Failed attempts of the shown routes, open or closed.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'deliveryId', a.delivery_id,
      'routeId', a.route_id,
      'attempt', a.attempt,
      'reason', a.reason,
      'notes', a.notes,
      'reportedAt', a.reported_at,
      'decisionDeadline', a.decision_deadline,
      'decision', a.decision,
      'decidedAt', a.decided_at,
      'decidedBy', a.decided_by)
    order by a.reported_at desc, a.id), '[]')
    into v_issues
    from public.delivery_attempts a
    where a.restaurant_id = p_restaurant_id and a.outcome = 'FAILED'
      and a.route_id in (select (r->>'id')::uuid from jsonb_array_elements(v_routes) r);

  return jsonb_build_object(
    'serverNow', v_now,
    'restaurant', jsonb_build_object(
      'defaultPromiseMinutes', v_restaurant.default_delivery_promise_minutes,
      'issueTimeoutMinutes', v_restaurant.delivery_issue_timeout_minutes),
    'couriers', v_shifts,
    'routes', v_routes,
    'orders', v_orders,
    'issues', v_issues);
end; $$;

revoke all on function public.get_operations_board(uuid) from public;
grant execute on function public.get_operations_board(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
