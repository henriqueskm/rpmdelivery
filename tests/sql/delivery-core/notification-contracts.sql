-- Contracts for RPM-CORE-005 (route started WhatsApp outbox). Runs after
-- privacy-contracts.sql. route_w3 (t1, t2, t3) started in
-- tracking-contracts.sql with the trigger already installed.
grant usage on schema core_test to service_role;
grant execute on all functions in schema core_test to service_role;
select set_config('core.route_w3',(select id::text from public.routes
 where courier_id=core_test.id(209) and status='ON_ROUTE'),false);
select set_config('core.t'||n,(select d.id::text from public.deliveries d join public.orders o on o.id=d.order_id
 where o.client_request_id=core_test.id(9700+n)),false) from generate_series(1,4) n;

-- ---------------------------------------------------------
-- Enqueue
-- ---------------------------------------------------------
select core_test.check('route start queued one WhatsApp per stop, to the customer',
 (select count(*)=3 and bool_and(n.channel='WHATSAPP' and n.type='TRACKING_LINK' and n.status='PENDING'
   and n.provider='meta_cloud' and n.destination=o.customer_phone and n.attempts=0)
  from public.delivery_notifications n join public.deliveries d on d.id=n.delivery_id
  join public.orders o on o.id=d.order_id
  where n.delivery_id in (core_test.s('t1'),core_test.s('t2'),core_test.s('t3'))));
select core_test.check('an order that never left queues nothing',
 not exists (select 1 from public.delivery_notifications where delivery_id=core_test.s('t4')));
select core_test.expect('one message of each kind per delivery',
 format('insert into public.delivery_notifications(restaurant_id,delivery_id,channel,type) values(%L,%L,%L,%L)',
  core_test.id(101),core_test.s('t1'),'WHATSAPP','TRACKING_LINK'),'23505');

-- The courier never reads the queue (it holds the phone); the store does.
select core_test.act(9);
set role authenticated;
select core_test.check('courier cannot read the notification queue',(select count(*) from public.delivery_notifications)=0);
select core_test.expect('courier cannot claim',
 $s$select public.claim_route_notifications(core_test.id(9),core_test.s('route_w3'))$s$,'42501');
select core_test.expect('courier cannot complete',
 $s$select public.complete_notification(gen_random_uuid(),'SENT')$s$,'42501');
reset role;
select core_test.act(2);
set role authenticated;
select core_test.check('store reads its queue',
 (select count(*) from public.delivery_notifications
   where delivery_id in (core_test.s('t1'),core_test.s('t2'),core_test.s('t3')))=3);
reset role;
set role anon;
select core_test.expect('anon cannot claim',
 $s$select public.claim_route_notifications(core_test.id(9),core_test.s('route_w3'))$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- Claim and complete (service_role: the Edge Function)
-- ---------------------------------------------------------
set role service_role;
select core_test.raises('unknown user cannot dispatch',
 $s$select public.claim_route_notifications(gen_random_uuid(),core_test.s('route_w3'))$s$,'RPM_ROUTE_NOT_FOUND');
select core_test.raises('another courier cannot dispatch',
 $s$select public.claim_route_notifications(core_test.id(13),core_test.s('route_w3'))$s$,'RPM_ROUTE_NOT_FOUND');
select core_test.raises('another store cannot dispatch',
 $s$select public.claim_route_notifications(core_test.id(4),core_test.s('route_w3'))$s$,'RPM_ROUTE_NOT_FOUND');
select set_config('core.claim',public.claim_route_notifications(core_test.id(9),core_test.s('route_w3'))::text,false);
select core_test.check('courier of the route claims its three messages with link data',
 jsonb_array_length(current_setting('core.claim')::jsonb)=3
 and (select bool_and(c->>'to' like '+55%' and c->>'trackingToken' is not null
   and c->>'restaurantName'='Synthetic A' and c->>'type'='TRACKING_LINK')
  from jsonb_array_elements(current_setting('core.claim')::jsonb) c));
select core_test.check('a concurrent dispatch finds them claimed',
 public.claim_route_notifications(core_test.id(2),core_test.s('route_w3'))='[]'::jsonb);
select set_config('core.n'||i,current_setting('core.claim')::jsonb->(i-1)->>'notificationId',false)
 from generate_series(1,3) i;
select core_test.check('sent is final',public.complete_notification(core_test.s('n1'),'SENT','wamid.TEST1')='SENT');
select core_test.raises('a final message cannot change',
 $s$select public.complete_notification(core_test.s('n1'),'FAILED',null,'late')$s$,'RPM_NOTIFICATION_STATE');
select core_test.raises('unknown outcome',
 $s$select public.complete_notification(core_test.s('n2'),'MAYBE')$s$,'RPM_NOTIFICATION_FIELDS');
select core_test.check('retry releases the claim',public.complete_notification(core_test.s('n2'),'RETRY',null,'META_500')='PENDING');
select core_test.check('released message is claimed again',
 (select array_agg(c->>'notificationId') from jsonb_array_elements(
   public.claim_route_notifications(core_test.id(9),core_test.s('route_w3'))) c)=array[core_test.s('n2')::text]);
reset role;
select core_test.check('outcomes recorded without the phone in errors',
 (select status='SENT' and sent_at is not null and provider_message_id='wamid.TEST1' and error_message is null
   from public.delivery_notifications where id=core_test.s('n1'))
 and (select status='PENDING' and attempts=2 and error_message='META_500'
   from public.delivery_notifications where id=core_test.s('n2')));

-- A stale "saiu para entrega" is dropped; three failed tries stop retrying.
update public.delivery_notifications set claimed_at=null, created_at=clock_timestamp()-interval '31 minutes'
 where id=core_test.s('n2');
update public.delivery_notifications set claimed_at=clock_timestamp()-interval '3 minutes', attempts=3
 where id=core_test.s('n3');
set role service_role;
select core_test.check('nothing left to send',
 public.claim_route_notifications(core_test.id(9),core_test.s('route_w3'))='[]'::jsonb);
reset role;
select core_test.check('late message expired and exhausted one closed',
 (select status='FAILED' and error_message='EXPIRED' from public.delivery_notifications where id=core_test.s('n2'))
 and (select status='FAILED' and error_message='MAX_ATTEMPTS' from public.delivery_notifications where id=core_test.s('n3')));

select core_test.check('dispatch functions only for service_role, definer, empty search_path',
 not exists (select 1 from (values ('public.claim_route_notifications(uuid,uuid)'),
   ('public.complete_notification(uuid,text,text,text)')) f(sig), (values ('anon'),('authenticated')) r(role)
  where has_function_privilege(r.role,f.sig,'EXECUTE'))
 and has_function_privilege('service_role','public.claim_route_notifications(uuid,uuid)','EXECUTE')
 and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
    and p.proname in ('claim_route_notifications','complete_notification','enqueue_route_started_notifications')
    and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])));
select core_test.check('still no direct writes on the queue', not exists (
 select 1 from (values ('INSERT'),('UPDATE'),('DELETE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,'public.delivery_notifications',p.priv)));
