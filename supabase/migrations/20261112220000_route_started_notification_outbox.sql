-- RPM-CORE-005. Aviso automático "saiu para entrega" (WhatsApp Cloud API).
-- Forward-only; hosted application requires separate approval.
-- Design: docs/customer-notifications.md
begin;

-- delivery_notifications becomes an outbox: the route start enqueues, the
-- dispatch-notifications Edge Function claims, sends and records the result.
alter table public.delivery_notifications
  add column claimed_at timestamptz,
  add column attempts integer not null default 0,
  add constraint delivery_notifications_attempts_check check (attempts between 0 and 10);

-- One message of each kind per delivery and channel: a retried dispatch or a
-- returned order that goes out again never messages the customer twice.
create unique index delivery_notifications_once_idx
  on public.delivery_notifications (delivery_id, channel, type);

-- =========================================================
-- ENQUEUE ON ROUTE START
-- =========================================================

-- Fires inside start_route's transaction, so an order is queued if and
-- only if the route really started. The phone stays in the database: the
-- courier who triggered the start never receives it.
create function private.enqueue_route_started_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.delivery_notifications
    (restaurant_id, delivery_id, channel, type, destination, provider, status)
  select d.restaurant_id, d.id, 'WHATSAPP', 'TRACKING_LINK', o.customer_phone, 'meta_cloud', 'PENDING'
    from public.route_deliveries rd
    join public.deliveries d on d.id = rd.delivery_id
    join public.orders o on o.id = d.order_id
    where rd.route_id = new.id
  on conflict (delivery_id, channel, type) do nothing;
  return null;
end; $$;

create trigger routes_enqueue_started_notifications
after update of status on public.routes
for each row
when (old.status = 'PREPARING' and new.status = 'ON_ROUTE')
execute function private.enqueue_route_started_notifications();

-- =========================================================
-- DISPATCH (service_role only: the Edge Function)
-- =========================================================

-- Claims the pending WhatsApp messages of a route for the user the Edge
-- Function authenticated: the route's courier or an active store member.
-- A claim holds for 2 minutes, so concurrent dispatches never send the same
-- message twice and a crashed one is retried. Messages older than 30 min
-- ("saiu para entrega" that would arrive too late) and messages that
-- already failed 3 times are closed as FAILED.
create function public.claim_route_notifications(p_user_id uuid, p_route_id uuid)
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
    set status='FAILED', error_message=case when n.attempts >= 3 then 'MAX_ATTEMPTS' else 'EXPIRED' end
    from public.route_deliveries rd
    where rd.route_id = p_route_id and rd.delivery_id = n.delivery_id
      and n.channel = 'WHATSAPP' and n.status = 'PENDING'
      and (n.claimed_at is null or n.claimed_at < v_now - interval '2 minutes')
      and (n.attempts >= 3 or n.created_at < v_now - interval '30 minutes');

  with candidates as (
    select n.id from public.delivery_notifications n
      join public.route_deliveries rd on rd.delivery_id = n.delivery_id and rd.route_id = p_route_id
      where n.channel = 'WHATSAPP' and n.status = 'PENDING'
        and (n.claimed_at is null or n.claimed_at < v_now - interval '2 minutes')
      order by n.created_at, n.id
      limit 30
      for update of n skip locked
  ), claimed as (
    update public.delivery_notifications n set claimed_at = v_now, attempts = n.attempts + 1
      from candidates c where n.id = c.id
      returning n.id, n.delivery_id, n.type, n.destination
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'notificationId', c.id,
      'type', c.type,
      'to', c.destination,
      'trackingToken', d.tracking_token,
      'restaurantName', r.name) order by c.id), '[]'::jsonb)
    into v_claimed
    from claimed c
    join public.deliveries d on d.id = c.delivery_id
    join public.restaurants r on r.id = d.restaurant_id;
  return v_claimed;
end; $$;

-- Result of one send. SENT and FAILED are final; RETRY releases the claim.
-- Only a message this dispatch still holds can change.
create function public.complete_notification(
  p_notification_id uuid, p_outcome text, p_provider_message_id text default null, p_error text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_status public.notification_status;
begin
  if p_outcome is null or p_outcome not in ('SENT','RETRY','FAILED') then
    raise exception 'RPM_NOTIFICATION_FIELDS' using errcode='22023', detail='outcome';
  end if;
  update public.delivery_notifications set
      status = case p_outcome when 'SENT' then 'SENT'::public.notification_status
        when 'FAILED' then 'FAILED'::public.notification_status else status end,
      sent_at = case when p_outcome = 'SENT' then clock_timestamp() else sent_at end,
      provider_message_id = case when p_outcome = 'SENT'
        then left(p_provider_message_id, 200) else provider_message_id end,
      error_message = case when p_outcome = 'SENT' then null else left(p_error, 300) end,
      claimed_at = case when p_outcome = 'RETRY' then null else claimed_at end
    where id = p_notification_id and status = 'PENDING' and claimed_at is not null
    returning status into v_status;
  if not found then
    raise exception 'RPM_NOTIFICATION_STATE' using errcode='55000';
  end if;
  return v_status::text;
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================

revoke all on function private.enqueue_route_started_notifications() from public, anon, authenticated;
revoke all on function public.claim_route_notifications(uuid,uuid),
  public.complete_notification(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_route_notifications(uuid,uuid),
  public.complete_notification(uuid,text,text,text)
  to service_role;

-- delivery_notifications keeps its store-only SELECT policy; still no
-- direct writes for API roles.
notify pgrst, 'reload schema';
commit;
