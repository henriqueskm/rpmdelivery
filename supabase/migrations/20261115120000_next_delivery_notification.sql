-- RPM-CORE-009. Aviso "você é o próximo" (WhatsApp Cloud API).
-- Forward-only; hosted application requires separate approval.
-- Design: docs/customer-notifications.md
--
-- When a stop becomes the courier's next one, its customer is queued a
-- NEXT_DELIVERY message (same outbox, same dispatch as "saiu para entrega").
-- Not for the first stop when the route starts: that customer gets "saiu
-- para entrega" at the same moment, with the same link showing "você é o
-- próximo". Once per delivery: a stop retried later never messages twice
-- (delivery_notifications_once_idx).
begin;

create function private.enqueue_next_delivery_notification()
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
    from public.orders o where o.id = new.order_id
  on conflict (delivery_id, channel, type) do nothing;
  return null;
end; $$;

create trigger deliveries_enqueue_next_notification
after update of status on public.deliveries
for each row
when (new.status = 'NEXT' and old.status is distinct from 'NEXT')
execute function private.enqueue_next_delivery_notification();

revoke all on function private.enqueue_next_delivery_notification() from public, anon, authenticated;

commit;
