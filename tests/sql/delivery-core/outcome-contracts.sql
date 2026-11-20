-- Contracts for the per-route outcome on the store board. Runs after distance-contracts.sql
-- (store C, owner 19, courier F 21, helpers core_test.as_actor / core_test.raised).
-- The case from the first real test: a stop comes back on one route and is delivered on another.
create function core_test.outcome(p_route uuid, p_delivery uuid) returns text language sql as $$
 select o->>'outcome' from jsonb_array_elements(
   core_test.as_actor(19,format($s$select public.get_operations_board(%L)$s$,core_test.id(103)))->'routeOutcomes') o
 where (o->>'routeId')::uuid=p_route and (o->>'deliveryId')::uuid=p_delivery
$$;

-- Each file runs in its own session on PostgreSQL 17: re-derive what distance-contracts.sql left.
select set_config('core.shift_f',(select id::text from public.courier_shifts
 where courier_id=core_test.id(221) and status not in ('ENDED','REJECTED')),false);

select set_config('core.g'||n,core_test.as_actor(19,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(103),p_request_id=>core_test.id(%s),
   p_customer_name=>'Volta %s',p_customer_phone=>'1194444000%s',p_delivery_address=>'Rua G%s')$s$,
 9950+n,n,n,n))->>'deliveryId',false) from generate_series(1,2) n;

-- Route 1: g1 delivered, g2 fails and the store sends it back.
select set_config('core.route_g1',core_test.as_actor(19,format(
 $s$select public.create_route(core_test.id(103),core_test.id(9960),%L,array[%L,%L]::uuid[])$s$,
 core_test.s('shift_f'),core_test.s('g1'),core_test.s('g2')))->>'routeId',false);
select core_test.as_actor(19,format($s$select public.release_route_pickup(core_test.id(103),%L,1)$s$,core_test.s('route_g1')));
select core_test.as_actor(21,format($s$select public.start_route(%L,1)$s$,core_test.s('route_g1')));
select core_test.check('a stop still on its route has no outcome yet',
 core_test.outcome(core_test.s('route_g1')::uuid,core_test.s('g1')::uuid) is null);
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9961),%L,%L)$s$,core_test.s('route_g1'),core_test.s('g1')));
select core_test.as_actor(21,format($s$select public.report_delivery_failure(core_test.id(9962),%L,%L,'CUSTOMER_NOT_FOUND',null)$s$,
 core_test.s('route_g1'),core_test.s('g2')));
-- The last stop failed: the store decides (back to the store), then the courier returns.
select core_test.as_actor(19,format($s$select to_jsonb(public.decide_delivery_failure(core_test.id(103),%L,'RETURN'))$s$,core_test.s('g2')));
select core_test.as_actor(21,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_g1')));
select core_test.check('route 1: the delivered stop says delivered',
 core_test.outcome(core_test.s('route_g1')::uuid,core_test.s('g1')::uuid)='DELIVERED');

-- Back in the queue: route 1 shows it as returned.
select core_test.as_actor(19,format($s$select to_jsonb(public.requeue_delivery(core_test.id(103),%L))$s$,core_test.s('g2')));
select core_test.check('back in the queue: returned on route 1',
 core_test.outcome(core_test.s('route_g1')::uuid,core_test.s('g2')::uuid)='RETURNED');

-- Route 2 takes it and delivers it: route 1 still says returned, route 2 delivered.
select set_config('core.route_g2',core_test.as_actor(19,format(
 $s$select public.create_route(core_test.id(103),core_test.id(9963),%L,array[%L]::uuid[])$s$,
 core_test.s('shift_f'),core_test.s('g2')))->>'routeId',false);
select core_test.check('on a new route: returned on route 1, nothing yet on route 2',
 core_test.outcome(core_test.s('route_g1')::uuid,core_test.s('g2')::uuid)='RETURNED'
 and core_test.outcome(core_test.s('route_g2')::uuid,core_test.s('g2')::uuid) is null);
select core_test.as_actor(19,format($s$select public.release_route_pickup(core_test.id(103),%L,1)$s$,core_test.s('route_g2')));
select core_test.as_actor(21,format($s$select public.start_route(%L,1)$s$,core_test.s('route_g2')));
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9964),%L,%L)$s$,core_test.s('route_g2'),core_test.s('g2')));
select core_test.check('delivered on route 2, still returned on route 1',
 core_test.outcome(core_test.s('route_g2')::uuid,core_test.s('g2')::uuid)='DELIVERED'
 and core_test.outcome(core_test.s('route_g1')::uuid,core_test.s('g2')::uuid)='RETURNED');

-- ---------------------------------------------------------
-- Board extras: delivery time, the courier on the map, links, the store pin
-- ---------------------------------------------------------
select set_config('core.bc',core_test.as_actor(20,format($s$select public.get_operations_board(%L)$s$,core_test.id(103)))::text,false);
select core_test.check('a delivered stop carries when it was delivered',
 exists (select 1 from jsonb_array_elements(current_setting('core.bc')::jsonb->'routeOutcomes') o
  where (o->>'routeId')::uuid=core_test.s('route_g2')::uuid and o->>'outcome'='DELIVERED' and (o->>'at')::timestamptz is not null));
select core_test.check('every order on the board has its tracking link token',
 (select count(*) from jsonb_array_elements(current_setting('core.bc')::jsonb->'orders'))
 = (select count(*) from jsonb_array_elements(current_setting('core.bc')::jsonb->'trackingTokens')));
select core_test.check('the store pin comes with the board',
 (current_setting('core.bc')::jsonb->'storeLocation'->>'latitude')::double precision = -23.0059);
-- A route on the street with a recent GPS point shows the courier on the map.
select core_test.as_actor(21,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0050,'longitude',-46.8380,'accuracy',9,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_g2')));
select core_test.check('only routes on the street are on the map: route 2 is heading back, route 1 is closed',
 exists (select 1 from jsonb_array_elements(core_test.as_actor(20,format($s$select public.get_operations_board(%L)$s$,
   core_test.id(103)))->'routePositions') p where (p->>'routeId')::uuid=core_test.s('route_g2')::uuid
   and (p->>'latitude')::double precision=-23.0050)
 and not exists (select 1 from jsonb_array_elements(core_test.as_actor(20,format($s$select public.get_operations_board(%L)$s$,
   core_test.id(103)))->'routePositions') p where (p->>'routeId')::uuid=core_test.s('route_g1')::uuid));
select core_test.as_actor(21,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_g2')));

-- ---------------------------------------------------------
-- The store never decides: past the deadline the courier's app settles the route
-- ---------------------------------------------------------
select set_config('core.g3',core_test.as_actor(19,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(103),p_request_id=>core_test.id(9970),
   p_customer_name=>'Prazo',p_customer_phone=>'11944440009',p_delivery_address=>'Rua G3')$s$))->>'deliveryId',false);
select set_config('core.route_g3',core_test.as_actor(19,format(
 $s$select public.create_route(core_test.id(103),core_test.id(9971),%L,array[%L]::uuid[])$s$,
 core_test.s('shift_f'),core_test.s('g3')))->>'routeId',false);
select core_test.as_actor(19,format($s$select public.release_route_pickup(core_test.id(103),%L,1)$s$,core_test.s('route_g3')));
select core_test.as_actor(21,format($s$select public.start_route(%L,1)$s$,core_test.s('route_g3')));
select core_test.as_actor(21,format($s$select public.report_delivery_failure(core_test.id(9972),%L,%L,'CUSTOMER_NOT_RESPONDING',null)$s$,
 core_test.s('route_g3'),core_test.s('g3')));
select core_test.check('only the route''s courier settles it',
 core_test.raised(9,format($s$select public.settle_courier_route(%L)$s$,core_test.s('route_g3')))='RPM_ROUTE_NOT_FOUND');
select core_test.check('before the deadline the courier still waits',
 core_test.as_actor(21,format($s$select public.settle_courier_route(%L)$s$,core_test.s('route_g3')))->>'status'='ON_ROUTE');
update public.delivery_attempts set decision_deadline=clock_timestamp()-interval '1 second'
 where client_request_id=core_test.id(9972);
select set_config('core.settled',core_test.as_actor(21,format($s$select public.settle_courier_route(%L)$s$,core_test.s('route_g3')))->>'status',false);
select core_test.check('past the deadline: the route returns',current_setting('core.settled')='RETURNING');
select core_test.check('past the deadline: the occurrence closed by TIMEOUT, without actor',
 (select decision='TIMEOUT' and decided_by is null from public.delivery_attempts where client_request_id=core_test.id(9972)));
select core_test.check('past the deadline: the order goes back to the store',
 (select status='RETURN_TO_STORE' from public.deliveries where id=core_test.s('g3')));
select core_test.check('settling again changes nothing',
 core_test.as_actor(21,format($s$select public.settle_courier_route(%L)$s$,core_test.s('route_g3')))->>'status'='RETURNING');
select core_test.as_actor(21,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_g3')));
select core_test.check('settling is for signed-in couriers only',
 has_function_privilege('authenticated','public.settle_courier_route(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.settle_courier_route(uuid)','EXECUTE'));
