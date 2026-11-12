-- Contracts for RPM-SEC-PRIV-001: the courier never receives the customer's
-- phone. Runs after tracking-contracts.sql (W on route_w3: t1 delivered,
-- t3 NEXT, t2 queued for retry).
select set_config('core.route_w3',(select id::text from public.routes
 where courier_id=core_test.id(209) and status='ON_ROUTE'),false);
select set_config('core.t'||n,(select d.id::text from public.deliveries d join public.orders o on o.id=d.order_id
 where o.client_request_id=core_test.id(9700+n)),false) from generate_series(1,3) n;

select core_test.act(9);
set role authenticated;
select set_config('core.w_route',public.get_courier_route()::text,false);
select core_test.check('courier reads the own route with its stops in planned order',
 (current_setting('core.w_route')::jsonb->>'routeId')=core_test.s('route_w3')::text
 and current_setting('core.w_route')::jsonb->>'status'='ON_ROUTE'
 and current_setting('core.w_route')::jsonb->>'nextDeliveryId'=core_test.s('t3')::text
 and (select array_agg(s->>'deliveryId' order by (s->>'sequence')::int)
   from jsonb_array_elements(current_setting('core.w_route')::jsonb->'stops') s)
   =array[core_test.s('t1')::text,core_test.s('t2')::text,core_test.s('t3')::text]);
select core_test.check('stops carry what the door needs',
 (select s->>'customerName'='Cliente Sigiloso 2' and s->>'address'='Rua Secreta 2'
   and (s->>'latitude')::numeric=-23.55 and s->>'deadlineAt' is not null
   and (s->>'attempts')::int=1 and s->>'retryQueuedAt' is not null and s->>'status'='ON_ROUTE'
   from jsonb_array_elements(current_setting('core.w_route')::jsonb->'stops') s
   where s->>'deliveryId'=core_test.s('t2')::text)
 and current_setting('core.w_route')::jsonb->'restaurant'->>'name'='Synthetic A');
select core_test.check('no customer phone anywhere in the courier route',
 position('5555000' in current_setting('core.w_route'))=0
 and not exists (select 1 from jsonb_array_elements(current_setting('core.w_route')::jsonb->'stops') s
   where s ? 'customerPhone' or s ? 'phone'));
select core_test.check('courier cannot read the orders table, so no phone column either',
 (select count(*) from public.orders)=0);
select core_test.check('courier still reads the deliveries of the route',
 (select count(*) from public.deliveries where id in (core_test.s('t1'),core_test.s('t2'),core_test.s('t3')))=3);
reset role;

select core_test.act(13);
set role authenticated;
select core_test.check('courier without an active route gets nothing',public.get_courier_route() is null);
reset role;
select core_test.act(2);
set role authenticated;
select core_test.raises('store member is not a courier',$s$select public.get_courier_route()$s$,'RPM_COURIER_REQUIRED');
select core_test.check('store still reads orders with the phone',
 (select bool_and(customer_phone like '+55%') and count(*)>0 from public.orders
   where id in (select order_id from public.deliveries where id=core_test.s('t2'))));
reset role;
set role anon;
select core_test.expect('anon cannot read a courier route',$s$select public.get_courier_route()$s$,'42501');
reset role;
select core_test.check('courier route read is definer with an empty search_path',
 has_function_privilege('authenticated','public.get_courier_route()','EXECUTE')
 and not has_function_privilege('anon','public.get_courier_route()','EXECUTE')
 and (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.get_courier_route()'::regprocedure));
select core_test.check('orders policy no longer admits couriers',
 (select qual not like '%courier%' from pg_policies where schemaname='public' and tablename='orders'
   and policyname='orders_select_allowed'));
