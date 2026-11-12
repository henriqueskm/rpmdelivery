-- RPM-CORE-004. Núcleo operacional, fatia 4: rastreamento público.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md, docs/architecture.md (13–16)
begin;

-- Public page /acompanhar/<token>. No login: the unguessable token is the
-- only credential, so the answer carries nothing beyond this delivery and
-- never anything about other customers, the courier's identity or the
-- order's contents.
--
-- The courier's position is shown only while this delivery is NEXT. While
-- the courier stands at another stop, the position would reveal that other
-- customer's address.
create function public.get_tracking(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_delivery public.deliveries;
  v_order public.orders;
  v_restaurant_name text;
  v_route public.routes;
  v_status text;
  v_final_at timestamptz;
  v_stops_before integer;
  v_courier jsonb;
  v_destination jsonb;
begin
  select * into v_delivery from public.deliveries where tracking_token = p_token;
  if not found then
    raise exception 'RPM_TRACKING_NOT_FOUND' using errcode='P0002';
  end if;
  -- Finished deliveries stay visible for 24 h; anything else expires a week
  -- after it was created. Expired and unknown tokens look the same.
  v_final_at := case v_delivery.status
    when 'DELIVERED' then v_delivery.delivered_at
    when 'CANCELLED' then v_delivery.cancelled_at
    else v_delivery.created_at + interval '6 days' end;
  if coalesce(v_final_at, v_delivery.updated_at) < v_now - interval '24 hours' then
    raise exception 'RPM_TRACKING_NOT_FOUND' using errcode='P0002';
  end if;

  select * into v_order from public.orders where id = v_delivery.order_id;
  select name into v_restaurant_name from public.restaurants where id = v_delivery.restaurant_id;
  -- Latest route that carried the delivery (a returned order may be retried).
  select r.* into v_route from public.route_deliveries rd
    join public.routes r on r.id = rd.route_id
    where rd.delivery_id = v_delivery.id and r.status <> 'CANCELLED'
    order by r.created_at desc
    limit 1;

  v_status := case v_delivery.status
    when 'WAITING' then 'PREPARING'
    when 'ASSIGNED' then 'PREPARING'
    when 'RETURN_TO_STORE' then 'RETURNING_TO_STORE'
    else v_delivery.status::text end;

  if v_delivery.status in ('ON_ROUTE','NEXT') and v_route.status = 'ON_ROUTE' then
    -- Same execution order as the route: first attempts, then retries.
    select q.pos - 1 into v_stops_before from (
      select rd.delivery_id, row_number() over (
        order by (rd.retry_queued_at is not null), rd.retry_queued_at, rd.sequence) as pos
      from public.route_deliveries rd
      join public.deliveries d on d.id = rd.delivery_id
      where rd.route_id = v_route.id and d.status in ('ON_ROUTE','NEXT')
    ) q where q.delivery_id = v_delivery.id;
  end if;

  if v_delivery.status = 'NEXT' and v_route.status = 'ON_ROUTE' then
    -- Only a recent point: a stale one would show the courier standing still.
    select jsonb_build_object('latitude', l.latitude, 'longitude', l.longitude,
        'recordedAt', l.recorded_at)
      into v_courier
      from public.courier_locations l
      where l.route_id = v_route.id and l.recorded_at >= v_now - interval '10 minutes'
      order by l.recorded_at desc
      limit 1;
    if v_order.latitude is not null then
      v_destination := jsonb_build_object('latitude', v_order.latitude, 'longitude', v_order.longitude);
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'restaurantName', v_restaurant_name,
    'issueReason', case when v_delivery.status = 'ATTEMPT_FAILED' then v_delivery.issue_reason end,
    'stopsBefore', v_stops_before,
    'courier', v_courier,
    'destination', v_destination,
    'startedAt', case when v_delivery.status not in ('WAITING','ASSIGNED','CANCELLED')
      then v_delivery.started_at end,
    'deliveredAt', v_delivery.delivered_at);
end; $$;

revoke all on function public.get_tracking(uuid) from public;
grant execute on function public.get_tracking(uuid) to anon, authenticated;

-- No table grants, RLS policies or GPS privileges change: the public page
-- reaches location data only through this function.
notify pgrst, 'reload schema';
commit;
