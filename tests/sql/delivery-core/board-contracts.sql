-- Contracts for the store panel's aggregated read (get_operations_board).
-- Runs after notification-contracts.sql: W on route_w3 (t1 delivered,
-- t2 failed and queued for a retry, t3 next); t4 waits at the store.
select set_config('core.route_w3',(select id::text from public.routes
 where courier_id=core_test.id(209) and status='ON_ROUTE'),false);
select set_config('core.shift_w3',(select courier_shift_id::text from public.routes
 where id=core_test.s('route_w3')),false);
select set_config('core.t'||n,(select d.id::text from public.deliveries d join public.orders o on o.id=d.order_id
 where o.client_request_id=core_test.id(9700+n)),false) from generate_series(1,4) n;

create function core_test.board(actor integer, restaurant integer) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform core_test.act(actor);
 set local role authenticated;
 v := public.get_operations_board(core_test.id(restaurant));
 reset role;
 return v;
end; $$;
create function core_test.board_order(b jsonb, k text) returns jsonb language sql as $$
 select o from jsonb_array_elements(b->'orders') o where o->>'deliveryId'=core_test.s(k)::text
$$;

-- ---------------------------------------------------------
-- Who can read
-- ---------------------------------------------------------
select core_test.act(8);
set role authenticated;
select core_test.expect('outsider cannot read the board',
 $s$select public.get_operations_board(core_test.id(101))$s$,'42501');
select core_test.act(3);
select core_test.expect('inactive member cannot read the board',
 $s$select public.get_operations_board(core_test.id(101))$s$,'42501');
select core_test.act(4);
select core_test.expect('owner of another store cannot read this board',
 $s$select public.get_operations_board(core_test.id(101))$s$,'42501');
select core_test.act(9);
select core_test.expect('courier cannot read the store board',
 $s$select public.get_operations_board(core_test.id(101))$s$,'42501');
reset role;
set role anon;
select core_test.expect('anon cannot call the board',
 $s$select public.get_operations_board(core_test.id(101))$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- What the operator sees
-- ---------------------------------------------------------
select set_config('core.b',core_test.board(2,101)::text,false);
select core_test.check('board carries the store settings and server time',
 (current_setting('core.b')::jsonb->'restaurant'->>'issueTimeoutMinutes')::int=10
 and (current_setting('core.b')::jsonb->'restaurant'->>'defaultPromiseMinutes')::int=60
 and (current_setting('core.b')::jsonb->>'serverNow') is not null);
select core_test.check('route on the street with its stops in planned order',
 exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'routes') r
  where r->>'id'=core_test.s('route_w3')::text and r->>'status'='ON_ROUTE'
   and r->>'shiftId'=core_test.s('shift_w3')::text and r->>'reference' ~ '^R-[0-9]+$'
   and (r->>'compositionVersion')::int>=1 and r->>'pickupReleasedAt' is not null
   and r->'deliveryIds'=jsonb_build_array(core_test.s('t1'),core_test.s('t2'),core_test.s('t3'))
   and r->'retryDeliveryIds'=jsonb_build_array(core_test.s('t2'))));
select core_test.check('orders show each stop status and the waiting one, with the phone for the store',
 core_test.board_order(current_setting('core.b')::jsonb,'t1')->>'deliveryStatus'='DELIVERED'
 and core_test.board_order(current_setting('core.b')::jsonb,'t2')->>'deliveryStatus'='ON_ROUTE'
 and core_test.board_order(current_setting('core.b')::jsonb,'t3')->>'deliveryStatus'='NEXT'
 and (core_test.board_order(current_setting('core.b')::jsonb,'t2')->>'failedAttempts')::int=1
 and core_test.board_order(current_setting('core.b')::jsonb,'t4')->>'deliveryStatus'='WAITING'
 and core_test.board_order(current_setting('core.b')::jsonb,'t4')->>'orderStatus'='OPEN'
 and core_test.board_order(current_setting('core.b')::jsonb,'t4')->>'phone' like '+55%'
 and core_test.board_order(current_setting('core.b')::jsonb,'t2')->>'latitude' is not null
 and (core_test.board_order(current_setting('core.b')::jsonb,'t4')->>'promisedMinutes')::int=60);
select core_test.check('an order without a store reference gets its number',
 core_test.board_order(current_setting('core.b')::jsonb,'t4')->>'reference' ~ '^[0-9]+$');
select core_test.check('courier on shift with name and live link',
 exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'couriers') c
  where c->>'shiftId'=core_test.s('shift_w3')::text and c->>'status'='ON_ROUTE'
   and c->>'name'='Synthetic 9' and (c->>'linkActive')::boolean));
select core_test.check('decided occurrence with reason, report and who decided',
 exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'issues') i
  where i->>'deliveryId'=core_test.s('t2')::text and i->>'routeId'=core_test.s('route_w3')::text
   and i->>'reason'='OTHER' and i->>'notes'='interfone quebrado' and i->>'decision'='RETRY'
   and i->>'decidedBy' is not null
   and (i->>'decisionDeadline')::timestamptz > (i->>'reportedAt')::timestamptz));
select core_test.check('nothing from another store',
 not exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'orders') o
  join public.orders x on x.id=(o->>'orderId')::uuid where x.restaurant_id<>core_test.id(101))
 and not exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'couriers') c
  join public.courier_shifts s on s.id=(c->>'shiftId')::uuid where s.restaurant_id<>core_test.id(101)));
select core_test.check('owner reads the same board',
 core_test.board(1,101)->'routes'=current_setting('core.b')::jsonb->'routes');

-- ---------------------------------------------------------
-- The board follows the commands
-- ---------------------------------------------------------
select core_test.act(9);
set role authenticated;
select public.report_delivery_failure(core_test.id(9902),core_test.s('route_w3'),core_test.s('t3'),
 'CUSTOMER_NOT_RESPONDING','ninguém atende');
reset role;
select set_config('core.b',core_test.board(2,101)::text,false);
select core_test.check('new failure opens an occurrence with a deadline and moves the next stop',
 exists (select 1 from jsonb_array_elements(current_setting('core.b')::jsonb->'issues') i
  where i->>'deliveryId'=core_test.s('t3')::text and i->>'decision' is null and i->>'reason'='CUSTOMER_NOT_RESPONDING'
   and (i->>'decisionDeadline')::timestamptz > (i->>'reportedAt')::timestamptz)
 and core_test.board_order(current_setting('core.b')::jsonb,'t3')->>'deliveryStatus'='ATTEMPT_FAILED'
 and core_test.board_order(current_setting('core.b')::jsonb,'t2')->>'deliveryStatus'='NEXT');
select core_test.act(1);
set role authenticated;
select public.decide_delivery_failure(core_test.id(101),core_test.s('t3'),'RETURN');
reset role;
select core_test.check('return decision closes the occurrence with who decided',
 exists (select 1 from jsonb_array_elements(core_test.board(2,101)->'issues') i
  where i->>'deliveryId'=core_test.s('t3')::text and i->>'decision'='RETURN' and i->>'decidedBy'=core_test.id(1)::text)
 and core_test.board_order(core_test.board(2,101),'t3')->>'deliveryStatus'='RETURN_TO_STORE');

-- A new courier (P) asks for a shift; a cancelled route disappears and its
-- stop is back at the counter.
insert into auth.users(id,email,raw_user_meta_data)
 values (core_test.id(16),'core-16@fixture.invalid',jsonb_build_object('name','Synthetic 16'));
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
 values (core_test.id(216),core_test.id(16),'Moto P','KKK1K11','Laranja');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status)
 values (core_test.id(336),core_test.id(101),core_test.id(216),'ACTIVE');
select core_test.act(16);
set role authenticated;
select set_config('core.shift_r',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
select core_test.check('pending shift shows on the board for approval',
 exists (select 1 from jsonb_array_elements(core_test.board(2,101)->'couriers') c
  where c->>'shiftId'=core_test.s('shift_r')::text and c->>'status'='PENDING' and c->>'availableSince' is null));
select core_test.act(2);
set role authenticated;
select public.review_shift(core_test.id(101),core_test.s('shift_r'),true);
select set_config('core.route_r',public.create_route(core_test.id(101),core_test.id(9901),core_test.s('shift_r'),
 array[core_test.s('t4')])->>'routeId',false);
reset role;
select core_test.check('assigned stop is on the new route',
 core_test.board_order(core_test.board(2,101),'t4')->>'deliveryStatus'='ASSIGNED'
 and exists (select 1 from jsonb_array_elements(core_test.board(2,101)->'routes') r
  where r->>'id'=core_test.s('route_r')::text and r->>'status'='PREPARING' and r->>'pickupReleasedAt' is null));
select core_test.act(2);
set role authenticated;
select public.cancel_route(core_test.id(101),core_test.s('route_r'));
reset role;
select core_test.check('cancelled route is gone and the stop waits again',
 not exists (select 1 from jsonb_array_elements(core_test.board(2,101)->'routes') r
  where r->>'id'=core_test.s('route_r')::text)
 and core_test.board_order(core_test.board(2,101),'t4')->>'deliveryStatus'='WAITING');

-- Finished orders leave the board after 12 hours.
update public.deliveries set updated_at=clock_timestamp()-interval '13 hours'
 where id in (select d.id from public.deliveries d where d.restaurant_id=core_test.id(101)
   and d.status='CANCELLED' and not exists (select 1 from public.route_deliveries rd where rd.delivery_id=d.id));
select core_test.check('old finished orders are not on the board',
 exists (select 1 from public.deliveries d where d.restaurant_id=core_test.id(101) and d.status='CANCELLED')
 and not exists (select 1 from jsonb_array_elements(core_test.board(2,101)->'orders') o
  join public.deliveries d on d.id=(o->>'deliveryId')::uuid
  where d.status='CANCELLED' and d.updated_at < clock_timestamp()-interval '12 hours'));

select core_test.check('board is a definer read for members only, empty search_path',
 has_function_privilege('authenticated','public.get_operations_board(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.get_operations_board(uuid)','EXECUTE')
 and (select p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
  from pg_proc p where p.oid='public.get_operations_board(uuid)'::regprocedure));
