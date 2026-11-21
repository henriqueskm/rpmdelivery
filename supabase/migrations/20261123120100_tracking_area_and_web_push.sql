-- RPM-CORE-012 (2/2). Public tracking: the courier's approximate area before the
-- customer's turn, and browser notifications (web push) for the customer.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/customer-notifications.md
begin;

-- =========================================================
-- PUBLIC TRACKING: approximate area before the customer's turn
-- =========================================================

-- Same answer as before, plus:
--   courierArea   while the order is on the street but not next: the courier's
--                 last recent point snapped to a ~1 km grid cell (center and a
--                 radius covering the cell). The exact point would reveal where
--                 the courier stops, that is, another customer's address.
--   distanceMeters from the courier to this customer's own pin: rounded up to
--                 500 m before the turn, to 50 m when next.
--   destination   this customer's own pin, now also before the turn.
-- The exact courier position is still only for the NEXT customer.
create or replace function public.get_tracking(p_token uuid)
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
  v_area jsonb;
  v_destination jsonb;
  v_distance integer;
  v_lat double precision;
  v_lng double precision;
  v_at timestamptz;
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

    if v_order.latitude is not null then
      v_destination := jsonb_build_object('latitude', v_order.latitude, 'longitude', v_order.longitude);
    end if;

    -- Only a recent point: a stale one would show the courier standing still.
    select l.latitude::double precision, l.longitude::double precision, l.recorded_at
      into v_lat, v_lng, v_at
      from public.courier_locations l
      where l.route_id = v_route.id and l.recorded_at >= v_now - interval '10 minutes'
      order by l.recorded_at desc
      limit 1;

    if v_at is not null then
      if v_delivery.status = 'NEXT' then
        v_courier := jsonb_build_object('latitude', v_lat, 'longitude', v_lng, 'recordedAt', v_at);
      else
        -- Center of the 0.01° cell (~1.1 km × 1 km here); 800 m covers its corners.
        v_area := jsonb_build_object(
          'latitude', round(((floor(v_lat * 100) + 0.5) / 100)::numeric, 3),
          'longitude', round(((floor(v_lng * 100) + 0.5) / 100)::numeric, 3),
          'radiusMeters', 800,
          'recordedAt', date_trunc('minute', v_at));
      end if;
      if v_order.latitude is not null then
        v_distance := private.distance_meters(v_lat, v_lng, v_order.latitude, v_order.longitude);
        v_distance := case when v_delivery.status = 'NEXT'
          then greatest(50, (round(v_distance / 50.0) * 50)::integer)
          else greatest(500, (ceil(v_distance / 500.0) * 500)::integer) end;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'restaurantName', v_restaurant_name,
    'issueReason', case when v_delivery.status = 'ATTEMPT_FAILED' then v_delivery.issue_reason end,
    'stopsBefore', v_stops_before,
    'courier', v_courier,
    'courierArea', v_area,
    'distanceMeters', v_distance,
    'destination', v_destination,
    'startedAt', case when v_delivery.status not in ('WAITING','ASSIGNED','CANCELLED')
      then v_delivery.started_at end,
    'deliveredAt', v_delivery.delivered_at);
end; $$;

-- =========================================================
-- WEB PUSH SUBSCRIPTIONS (the tracking page, no login)
-- =========================================================

-- The tracking token is the only credential, as for get_tracking. The browser's
-- push endpoint must belong to a known push service: the dispatcher posts to
-- it, so it can never be pointed at another host.
create function private.valid_push_endpoint(p_endpoint text)
returns boolean language sql immutable set search_path='' as $$
  select p_endpoint is not null and length(p_endpoint) <= 1000
    and p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/[A-Za-z0-9._~%:/?=&+-]+$'
$$;

create function public.subscribe_tracking_push(p_token uuid, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_delivery public.deliveries;
  v_endpoint text := btrim(p_endpoint);
begin
  select * into v_delivery from public.deliveries where tracking_token = p_token for update;
  if not found or v_delivery.created_at < clock_timestamp() - interval '6 days' then
    raise exception 'RPM_TRACKING_NOT_FOUND' using errcode='P0002';
  end if;
  if v_delivery.status in ('DELIVERED','CANCELLED','RETURN_TO_STORE') then
    raise exception 'RPM_TRACKING_CLOSED' using errcode='55000';
  end if;
  -- P-256 public key: 65 bytes; auth secret: 16 bytes (base64url).
  if not private.valid_push_endpoint(v_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' then
    raise exception 'RPM_PUSH_FIELDS' using errcode='22023';
  end if;
  -- A handful of browsers per order (the customer's phone, a relative's).
  if (select count(*) from public.push_subscriptions
      where delivery_id = v_delivery.id and active and endpoint <> v_endpoint) >= 5 then
    raise exception 'RPM_PUSH_LIMIT' using errcode='54000';
  end if;
  insert into public.push_subscriptions (delivery_id, endpoint, p256dh, auth)
    values (v_delivery.id, v_endpoint, p_p256dh, p_auth)
  on conflict (delivery_id, endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, active = true, revoked_at = null;
  return jsonb_build_object('subscribed', true);
end; $$;

create function public.unsubscribe_tracking_push(p_token uuid, p_endpoint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_delivery uuid;
begin
  select id into v_delivery from public.deliveries where tracking_token = p_token;
  if not found then
    raise exception 'RPM_TRACKING_NOT_FOUND' using errcode='P0002';
  end if;
  update public.push_subscriptions set active = false, revoked_at = clock_timestamp()
    where delivery_id = v_delivery and endpoint = btrim(p_endpoint) and active;
  return jsonb_build_object('subscribed', false);
end; $$;

-- =========================================================
-- ENQUEUE (same outbox as WhatsApp, channel PUSH)
-- =========================================================

-- One push of each kind per delivery, only when someone asked for them. A newer
-- one replaces an older one nobody picked up yet: "chegando" makes "você é o
-- próximo" pointless, and two notifications at once are noise.
create function private.queue_push(p_delivery uuid, p_restaurant uuid, p_type text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.push_subscriptions where delivery_id = p_delivery and active) then
    return;
  end if;
  update public.delivery_notifications set status = 'FAILED', error_message = 'SUPERSEDED'
    where delivery_id = p_delivery and channel = 'PUSH' and status = 'PENDING' and claimed_at is null
      and type::text <> p_type;
  insert into public.delivery_notifications (restaurant_id, delivery_id, channel, type, provider, status)
    values (p_restaurant, p_delivery, 'PUSH', p_type::public.notification_type, 'web_push', 'PENDING')
  on conflict (delivery_id, channel, type) do nothing;
end; $$;

-- Left the store, became next, delivered.
create function private.enqueue_delivery_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status = 'NEXT' then
    perform private.queue_push(new.id, new.restaurant_id, 'NEXT_DELIVERY');
  elsif new.status = 'ON_ROUTE' and old.status = 'ASSIGNED' then
    perform private.queue_push(new.id, new.restaurant_id, 'TRACKING_LINK');
  elsif new.status = 'DELIVERED' then
    perform private.queue_push(new.id, new.restaurant_id, 'DELIVERY_COMPLETED');
  end if;
  return null;
end; $$;

create trigger deliveries_enqueue_push
after update of status on public.deliveries
for each row
when (new.status is distinct from old.status and new.status in ('NEXT','ON_ROUTE','DELIVERED'))
execute function private.enqueue_delivery_push();

-- The courier's live position moved (record_courier_locations): within 500 m of
-- the next customer's pin, that customer hears "está chegando". Once per delivery.
-- 500 m is about a minute on a motorcycle: GPS goes up every 15 s and the app
-- dispatches at most every 30 s, so the push still arrives before the courier.
create function private.enqueue_courier_nearby_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare v record;
begin
  for v in
    select d.id, d.restaurant_id, o.latitude, o.longitude
      from public.routes r
      join public.route_deliveries rd on rd.route_id = r.id
      join public.deliveries d on d.id = rd.delivery_id and d.status = 'NEXT'
      join public.orders o on o.id = d.order_id
      where r.courier_id = new.id and r.status = 'ON_ROUTE' and o.latitude is not null
        and exists (select 1 from public.push_subscriptions s where s.delivery_id = d.id and s.active)
  loop
    if private.distance_meters(new.last_latitude::double precision, new.last_longitude::double precision,
        v.latitude, v.longitude) <= 500 then
      perform private.queue_push(v.id, v.restaurant_id, 'COURIER_NEARBY');
    end if;
  end loop;
  return null;
end; $$;

create trigger couriers_enqueue_nearby_push
after update of last_latitude, last_longitude on public.couriers
for each row
when (new.last_latitude is not null and new.last_longitude is not null
  and (new.last_latitude, new.last_longitude) is distinct from (old.last_latitude, old.last_longitude))
execute function private.enqueue_courier_nearby_push();

-- =========================================================
-- DISPATCH (service_role only: the Edge Function)
-- =========================================================

-- Same rules as claim_route_notifications (route's courier or store member,
-- 2-minute claim, 3 attempts), for the PUSH channel. A push older than 15
-- minutes is dropped: "está chegando" late is wrong. Each item carries the
-- delivery's active browsers; one with none left is closed here.
create function public.claim_route_push(p_user_id uuid, p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_route public.routes;
  v_claimed jsonb;
begin
  select * into v_route from public.routes where id = p_route_id;
  if not found or p_user_id is null or not (
    exists (select 1 from public.couriers where id = v_route.courier_id and user_id = p_user_id)
    or exists (select 1 from public.restaurant_members rm join public.restaurants r on r.id = rm.restaurant_id
      where rm.restaurant_id = v_route.restaurant_id and rm.user_id = p_user_id and rm.active and r.is_active)) then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;

  update public.delivery_notifications n
    set status = 'FAILED', error_message = case
      when n.attempts >= 3 then 'MAX_ATTEMPTS'
      when n.created_at < v_now - interval '15 minutes' then 'EXPIRED'
      else 'NO_SUBSCRIPTION' end
    from public.route_deliveries rd
    where rd.route_id = p_route_id and rd.delivery_id = n.delivery_id
      and n.channel = 'PUSH' and n.status = 'PENDING'
      and (n.claimed_at is null or n.claimed_at < v_now - interval '2 minutes')
      and (n.attempts >= 3 or n.created_at < v_now - interval '15 minutes'
        or not exists (select 1 from public.push_subscriptions s where s.delivery_id = n.delivery_id and s.active));

  with candidates as (
    select n.id from public.delivery_notifications n
      join public.route_deliveries rd on rd.delivery_id = n.delivery_id and rd.route_id = p_route_id
      where n.channel = 'PUSH' and n.status = 'PENDING'
        and (n.claimed_at is null or n.claimed_at < v_now - interval '2 minutes')
      order by n.created_at, n.id
      limit 30
      for update of n skip locked
  ), claimed as (
    update public.delivery_notifications n set claimed_at = v_now, attempts = n.attempts + 1
      from candidates c where n.id = c.id
      returning n.id, n.delivery_id, n.type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'notificationId', c.id,
      'type', c.type,
      'trackingToken', d.tracking_token,
      'restaurantName', r.name,
      'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) order by s.created_at), '[]'::jsonb)
        from public.push_subscriptions s where s.delivery_id = c.delivery_id and s.active)
    ) order by c.id), '[]'::jsonb)
    into v_claimed
    from claimed c
    join public.deliveries d on d.id = c.delivery_id
    join public.restaurants r on r.id = d.restaurant_id;
  return v_claimed;
end; $$;

-- The push service said the browser is gone (404/410): stop sending to it.
create function public.revoke_push_subscription(p_subscription_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.push_subscriptions set active = false, revoked_at = clock_timestamp()
    where id = p_subscription_id and active;
$$;

-- =========================================================
-- PRIVILEGES
-- =========================================================

revoke all on function private.valid_push_endpoint(text),
  private.queue_push(uuid,uuid,text),
  private.enqueue_delivery_push(),
  private.enqueue_courier_nearby_push()
  from public, anon, authenticated;
revoke all on function public.subscribe_tracking_push(uuid,text,text,text),
  public.unsubscribe_tracking_push(uuid,text) from public;
grant execute on function public.subscribe_tracking_push(uuid,text,text,text),
  public.unsubscribe_tracking_push(uuid,text) to anon, authenticated;
revoke all on function public.claim_route_push(uuid,uuid),
  public.revoke_push_subscription(uuid) from public, anon, authenticated;
grant execute on function public.claim_route_push(uuid,uuid),
  public.revoke_push_subscription(uuid) to service_role;

-- push_subscriptions keeps no Data API privileges: only these functions touch it.
notify pgrst, 'reload schema';
commit;
