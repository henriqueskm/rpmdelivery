-- Contracts for the courier's approximate area on the tracking page and the
-- browser notifications (migration 20261123120100). Runs after order-edit-contracts.sql:
-- store C (103), owner 19, operator 20, courier F (21), helpers core_test.as_actor,
-- core_test.raised and core_test.public_view. Each value is re-read here: the
-- PostgreSQL runner uses one session per file.
select set_config('core.shift_f',(select id::text from public.courier_shifts
 where courier_id=core_test.id(221) and status not in ('ENDED','REJECTED')),false);

-- What an anonymous caller (the tracking page) gets back, or the error it raised.
create function core_test.anon(statement text) returns text language plpgsql as $$
declare v text;
begin
 set local role anon;
 begin execute statement into v;
 exception when others then v := sqlerrm; end;
 reset role;
 return v;
end; $$;
create function core_test.token(k text) returns uuid language sql stable as $$
 select tracking_token from public.deliveries where id=core_test.s(k)
$$;
create function core_test.subscribe(k text, endpoint text) returns text language sql as $$
 select core_test.anon(format($s$select public.subscribe_tracking_push(%L,%L,%L,%L)::text$s$,
  core_test.token(k), endpoint, repeat('B',87), repeat('a',22)))
$$;
create function core_test.pushes(k text) returns text language sql stable as $$
 select coalesce(string_agg(type::text||':'||status::text||coalesce(':'||error_message,''),',' order by type::text),'')
  from public.delivery_notifications where delivery_id=core_test.s(k) and channel='PUSH'
$$;

-- p1 and p2 with pins in Itatiba, p3 without anyone asking for notifications.
select set_config('core.p'||n,core_test.as_actor(19,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(103),p_request_id=>core_test.id(%s),
   p_customer_name=>'Aviso %s',p_customer_phone=>'1193333000%s',p_delivery_address=>'Rua P%s',
   p_latitude=>%s,p_longitude=>%s)$s$,
 9980+n,n,n,n,(array['-23.0100','-23.0200','null'])[n],(array['-46.8300','-46.8500','null'])[n]))->>'deliveryId',false)
 from generate_series(1,3) n;

-- ---------------------------------------------------------
-- Subscribing from the tracking page
-- ---------------------------------------------------------
select core_test.check('the page subscribes a browser to its order',
 core_test.subscribe('p1','https://fcm.googleapis.com/fcm/send/abc123:XYZ')='{"subscribed": true}');
select core_test.check('Apple and Mozilla push services are accepted',
 core_test.subscribe('p2','https://web.push.apple.com/QGx1-endpoint')='{"subscribed": true}'
 and core_test.subscribe('p2','https://updates.push.services.mozilla.com/wpush/v2/gAAA')='{"subscribed": true}');
select core_test.check('subscribing the same browser again keeps one row',
 core_test.subscribe('p1','https://fcm.googleapis.com/fcm/send/abc123:XYZ')='{"subscribed": true}'
 and (select count(*) from public.push_subscriptions where delivery_id=core_test.s('p1'))=1);
select core_test.check('an endpoint outside the push services is refused',
 core_test.subscribe('p1','https://evil.example/collect')='RPM_PUSH_FIELDS'
 and core_test.subscribe('p1','http://fcm.googleapis.com/fcm/send/x')='RPM_PUSH_FIELDS'
 and core_test.subscribe('p1','https://fcm.googleapis.com.evil.example/x')='RPM_PUSH_FIELDS');
select core_test.check('malformed browser keys are refused',
 core_test.anon(format($s$select public.subscribe_tracking_push(%L,'https://fcm.googleapis.com/fcm/send/k','short','a')::text$s$,
  core_test.token('p1')))='RPM_PUSH_FIELDS');
select core_test.check('an unknown link cannot subscribe',
 core_test.anon($s$select public.subscribe_tracking_push(gen_random_uuid(),'https://fcm.googleapis.com/fcm/send/k',
  repeat('B',87),repeat('a',22))::text$s$)='RPM_TRACKING_NOT_FOUND');
select core_test.check('at most five browsers per order',
 (select bool_and(core_test.subscribe('p1','https://fcm.googleapis.com/fcm/send/extra'||n)='{"subscribed": true}')
   from generate_series(1,4) n)
 and core_test.subscribe('p1','https://fcm.googleapis.com/fcm/send/extra5')='RPM_PUSH_LIMIT');
select core_test.anon(format($s$select public.unsubscribe_tracking_push(%L,%L)::text$s$,core_test.token('p1'),
 'https://fcm.googleapis.com/fcm/send/extra'||n)) from generate_series(1,4) n;
select core_test.check('unsubscribing switches the browser off',
 (select count(*) from public.push_subscriptions where delivery_id=core_test.s('p1') and active)=1
 and (select count(*) from public.push_subscriptions where delivery_id=core_test.s('p1') and not active and revoked_at is not null)=4);
select core_test.check('the page cannot read the subscriptions',
 core_test.anon('select count(*)::text from public.push_subscriptions')='permission denied for table push_subscriptions');

-- ---------------------------------------------------------
-- The route starts: who hears what
-- ---------------------------------------------------------
select set_config('core.route_p',core_test.as_actor(19,format(
 $s$select public.create_route(core_test.id(103),core_test.id(9990),%L,array[%L,%L,%L]::uuid[])$s$,
 core_test.s('shift_f'),core_test.s('p1'),core_test.s('p2'),core_test.s('p3')))->>'routeId',false);
select core_test.as_actor(19,format($s$select public.release_route_pickup(core_test.id(103),%L,1)$s$,core_test.s('route_p')));
select core_test.as_actor(21,format($s$select public.start_route(%L,1)$s$,core_test.s('route_p')));
select core_test.check('first stop: only "você é o próximo" (it replaces "saiu" queued in the same instant)',
 core_test.pushes('p1')='NEXT_DELIVERY:PENDING,TRACKING_LINK:FAILED:SUPERSEDED');
select core_test.check('second stop: "saiu para entrega"',core_test.pushes('p2')='TRACKING_LINK:PENDING');
select core_test.check('nobody asked on the third stop: nothing queued',core_test.pushes('p3')='');

-- ---------------------------------------------------------
-- Approximate area before the turn, exact position on the turn
-- ---------------------------------------------------------
select core_test.check('no recent point: no area and no distance',
 core_test.public_view('p2')->'courierArea'='null'::jsonb and core_test.public_view('p2')->'distanceMeters'='null'::jsonb
 and (core_test.public_view('p2')->'destination'->>'latitude')::numeric=-23.0200);
select core_test.as_actor(21,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0153,'longitude',-46.8327,'accuracy',8,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_p')));
select core_test.check('before the turn: the area cell, never the point',
 core_test.public_view('p2')->'courier'='null'::jsonb
 and (core_test.public_view('p2')->'courierArea'->>'latitude')::numeric=-23.015
 and (core_test.public_view('p2')->'courierArea'->>'longitude')::numeric=-46.835
 and (core_test.public_view('p2')->'courierArea'->>'radiusMeters')::int=800
 and position('-23.0153' in core_test.public_view('p2')::text)=0);
select core_test.check('before the turn: distance rounded up to 500 m',
 (core_test.public_view('p2')->>'distanceMeters')::int % 500=0
 and (core_test.public_view('p2')->>'distanceMeters')::int between 1500 and 2500);
select core_test.check('on the turn: the exact point and distance to 50 m, no area',
 (core_test.public_view('p1')->'courier'->>'latitude')::numeric=-23.0153
 and core_test.public_view('p1')->'courierArea'='null'::jsonb
 and (core_test.public_view('p1')->>'distanceMeters')::int % 50=0
 and (core_test.public_view('p1')->>'distanceMeters')::int between 550 and 750);
select core_test.check('a stop without a pin gets the area but no distance',
 core_test.public_view('p3')->'courierArea'<>'null'::jsonb and core_test.public_view('p3')->'distanceMeters'='null'::jsonb);
select core_test.check('650 m away is not "chegando" yet',position('COURIER_NEARBY' in core_test.pushes('p1'))=0);

-- ---------------------------------------------------------
-- Dispatch (service_role: the Edge Function)
-- ---------------------------------------------------------
set role service_role;
select core_test.raises('another courier cannot dispatch',
 $s$select public.claim_route_push(core_test.id(9),core_test.s('route_p'))$s$,'RPM_ROUTE_NOT_FOUND');
select set_config('core.push_claim',public.claim_route_push(core_test.id(21),core_test.s('route_p'))::text,false);
reset role;
select core_test.check('the courier''s dispatch claims both pushes with the browsers and link',
 jsonb_array_length(current_setting('core.push_claim')::jsonb)=2
 and (select bool_and(c->>'trackingToken' is not null and c->>'restaurantName' is not null
   and jsonb_array_length(c->'subscriptions')>=1 and c->'subscriptions'->0->>'endpoint' like 'https://%'
   and c->'subscriptions'->0->>'p256dh' is not null and c->'subscriptions'->0->>'auth' is not null)
  from jsonb_array_elements(current_setting('core.push_claim')::jsonb) c)
 and (select jsonb_array_length(c->'subscriptions') from jsonb_array_elements(current_setting('core.push_claim')::jsonb) c
  where c->>'type'='TRACKING_LINK')=2);
set role service_role;
select core_test.check('WhatsApp dispatch never picks up a push',
 not exists (select 1 from jsonb_array_elements(public.claim_route_notifications(core_test.id(21),core_test.s('route_p'))) c
  where (c->>'notificationId')::uuid in (select id from public.delivery_notifications where channel='PUSH')));
select public.complete_notification((c->>'notificationId')::uuid,'SENT')
 from jsonb_array_elements(current_setting('core.push_claim')::jsonb) c;
reset role;
select core_test.check('sent pushes are final',
 core_test.pushes('p1')='NEXT_DELIVERY:SENT,TRACKING_LINK:FAILED:SUPERSEDED' and core_test.pushes('p2')='TRACKING_LINK:SENT');

-- ---------------------------------------------------------
-- "Está chegando", delivered, and a browser that is gone
-- ---------------------------------------------------------
select core_test.as_actor(21,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0108,'longitude',-46.8304,'accuracy',8,'recordedAt',clock_timestamp()+interval '1 second'))))$s$,core_test.s('route_p')));
select core_test.as_actor(21,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0102,'longitude',-46.8301,'accuracy',8,'recordedAt',clock_timestamp()+interval '2 seconds'))))$s$,core_test.s('route_p')));
select core_test.check('within 500 m of the next customer: "está chegando", once',
 core_test.pushes('p1')='COURIER_NEARBY:PENDING,NEXT_DELIVERY:SENT,TRACKING_LINK:FAILED:SUPERSEDED');
select core_test.check('the others are not told',position('COURIER_NEARBY' in core_test.pushes('p2'))=0);
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9991),%L,%L)$s$,core_test.s('route_p'),core_test.s('p1')));
select core_test.check('delivered: "entregue" replaces the "chegando" nobody picked up',
 core_test.pushes('p1')='COURIER_NEARBY:FAILED:SUPERSEDED,DELIVERY_COMPLETED:PENDING,NEXT_DELIVERY:SENT,TRACKING_LINK:FAILED:SUPERSEDED');
select core_test.check('the new next customer hears it',
 core_test.pushes('p2')='NEXT_DELIVERY:PENDING,TRACKING_LINK:SENT');

-- The push service answered 404/410 for p1's browser: it is switched off and
-- the pending push closes on the next claim.
select set_config('core.gone',(select id::text from public.push_subscriptions
 where delivery_id=core_test.s('p1') and active),false);
set role service_role;
select public.revoke_push_subscription(core_test.s('gone'));
select set_config('core.push_claim',public.claim_route_push(core_test.id(19),core_test.s('route_p'))::text,false);
reset role;
select core_test.check('a push with no browser left is closed, not sent',
 position('DELIVERY_COMPLETED:FAILED:NO_SUBSCRIPTION' in core_test.pushes('p1'))>0
 and (select array_agg(c->>'type') from jsonb_array_elements(current_setting('core.push_claim')::jsonb) c)=array['NEXT_DELIVERY']);

-- Leave the courier free for anything after this file.
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9992),%L,%L)$s$,core_test.s('route_p'),core_test.s('p2')));
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9993),%L,%L)$s$,core_test.s('route_p'),core_test.s('p3')));
select core_test.check('a delivered order cannot subscribe any more',
 core_test.subscribe('p3','https://fcm.googleapis.com/fcm/send/later')='RPM_TRACKING_CLOSED');
select core_test.as_actor(21,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_p')));

-- ---------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------
select core_test.check('the page reaches only subscribe and unsubscribe; dispatch is service_role only',
 has_function_privilege('anon','public.subscribe_tracking_push(uuid,text,text,text)','EXECUTE')
 and has_function_privilege('anon','public.unsubscribe_tracking_push(uuid,text)','EXECUTE')
 and not exists (select 1 from (values ('public.claim_route_push(uuid,uuid)'),('public.revoke_push_subscription(uuid)'),
   ('private.queue_push(uuid,uuid,text)')) f(sig), (values ('anon'),('authenticated')) r(role)
  where has_function_privilege(r.role,f.sig,'EXECUTE'))
 and has_function_privilege('service_role','public.claim_route_push(uuid,uuid)','EXECUTE')
 and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (('public','subscribe_tracking_push'),('public','unsubscribe_tracking_push'),
    ('public','claim_route_push'),('public','revoke_push_subscription'),('public','get_tracking'),
    ('private','queue_push'),('private','enqueue_delivery_push'),('private','enqueue_courier_nearby_push'))
    and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])));
select core_test.check('still no Data API access to the subscriptions', not exists (
 select 1 from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,'public.push_subscriptions',p.priv)));
