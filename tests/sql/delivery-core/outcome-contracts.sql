-- Contracts for the per-route outcome on the store board. Runs after distance-contracts.sql
-- (store C, owner 19, courier F 21, helpers core_test.as_actor / core_test.raised).
-- The case from the first real test: a stop comes back on one route and is delivered on another.
create function core_test.outcome(p_route uuid, p_delivery uuid) returns text language sql as $$
 select o->>'outcome' from jsonb_array_elements(
   core_test.as_actor(19,format($s$select public.get_operations_board(%L)$s$,core_test.id(103)))->'routeOutcomes') o
 where (o->>'routeId')::uuid=p_route and (o->>'deliveryId')::uuid=p_delivery
$$;

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
-- The last stop failed: it goes back to the store on its own (no store decision today).
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
select core_test.as_actor(21,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_g2')));
