-- Contracts for courier earnings (taxa de encosta + value per delivery).
-- Runs after home-contracts.sql. A fresh courier E (18) works in store B (102),
-- whose only member is owner 4, so nothing from the other files interferes.
insert into auth.users(id,email,raw_user_meta_data)
 values (core_test.id(18),'core-18@fixture.invalid',jsonb_build_object('name','Synthetic 18'));
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
 values (core_test.id(218),core_test.id(18),'Moto E','MMM1M11','Bege');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status)
 values (core_test.id(338),core_test.id(102),core_test.id(218),'ACTIVE');

create function core_test.as_actor(actor integer, statement text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform core_test.act(actor);
 set local role authenticated;
 execute statement into v;
 reset role;
 return v;
end; $$;

-- ---------------------------------------------------------
-- Who sets and reads the rates
-- ---------------------------------------------------------
select core_test.check('new columns start at zero',
 (select courier_shift_fee_cents=0 and courier_delivery_fee_cents=0 from public.restaurants where id=core_test.id(101)));
select core_test.act(2);
set role authenticated;
select core_test.expect('an operator cannot change the courier pay',
 $s$select public.set_courier_pay(core_test.id(101),1000,500)$s$,'42501');
select core_test.check('an operator reads the rates without editing',
 (public.get_courier_pay(core_test.id(101))->>'canEdit')::boolean is false);
select core_test.act(8);
select core_test.expect('an outsider cannot read the pay',
 $s$select public.get_courier_pay(core_test.id(101))$s$,'42501');
select core_test.act(9);
select core_test.expect('a courier cannot read the store pay',
 $s$select public.get_courier_pay(core_test.id(101))$s$,'42501');
select core_test.act(1);
select core_test.expect('negative value is refused',
 $s$select public.set_courier_pay(core_test.id(101),-1,500)$s$,'22023');
select core_test.expect('more than R$ 1.000 is refused',
 $s$select public.set_courier_pay(core_test.id(101),100001,500)$s$,'22023');
select core_test.expect('owner of A cannot set B',
 $s$select public.set_courier_pay(core_test.id(102),1000,500)$s$,'42501');
reset role;
set role anon;
select core_test.expect('anon cannot read the pay',
 $s$select public.get_courier_pay(core_test.id(101))$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- A day of work in B
-- ---------------------------------------------------------
select core_test.check('owner sets B: R$ 30,00 encosta and R$ 7,00 per delivery',
 core_test.as_actor(4,$s$select public.set_courier_pay(core_test.id(102),3000,700)$s$)
  = jsonb_build_object('shiftFeeCents',3000,'deliveryFeeCents',700));
select set_config('core.shift_e',core_test.as_actor(18,$s$select public.request_shift(core_test.id(102))$s$)->>'shiftId',false);
select core_test.as_actor(4,format($s$select to_jsonb(public.review_shift(core_test.id(102),%L,true))$s$,core_test.s('shift_e')));
select core_test.check('approval copies the encosta into the shift',
 (select shift_fee_cents from public.courier_shifts where id=core_test.s('shift_e'))=3000);

select set_config('core.e'||n,core_test.as_actor(4,format(
 $s$select public.create_order(core_test.id(102),core_test.id(%s),'Ganho %s','1196666100%s','Rua G%s')$s$,9800+n,n,n,n))->>'deliveryId',false)
 from generate_series(1,2) n;
select set_config('core.route_e',core_test.as_actor(4,format(
 $s$select public.create_route(core_test.id(102),core_test.id(9810),%L,array[%L,%L]::uuid[])$s$,
 core_test.s('shift_e'),core_test.s('e1'),core_test.s('e2')))->>'routeId',false);
select core_test.as_actor(4,format($s$select public.release_route_pickup(core_test.id(102),%L,1)$s$,core_test.s('route_e')));
select core_test.as_actor(18,format($s$select public.start_route(%L,1)$s$,core_test.s('route_e')));
select core_test.as_actor(18,format($s$select public.complete_delivery(core_test.id(9811),%L,%L)$s$,core_test.s('route_e'),core_test.s('e1')));
select core_test.check('a delivery copies the rate of the moment',
 (select courier_fee_cents from public.delivery_attempts where client_request_id=core_test.id(9811))=700);

-- The store raises the rates mid-day: what was earned stays.
select core_test.as_actor(4,$s$select public.set_courier_pay(core_test.id(102),5000,900)$s$);
select core_test.as_actor(18,format($s$select public.report_delivery_failure(core_test.id(9812),%L,%L,'CUSTOMER_NOT_RESPONDING',null)$s$,
 core_test.s('route_e'),core_test.s('e2')));
select core_test.check('a failed stop pays nothing',
 (select courier_fee_cents from public.delivery_attempts where client_request_id=core_test.id(9812)) is null);
select core_test.as_actor(18,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_e')));

-- A second shift the same day adds no second encosta.
select core_test.as_actor(18,format($s$select to_jsonb(public.end_shift(%L))$s$,core_test.s('shift_e')));
select set_config('core.shift_e2',core_test.as_actor(18,$s$select public.request_shift(core_test.id(102))$s$)->>'shiftId',false);
select core_test.as_actor(4,format($s$select to_jsonb(public.review_shift(core_test.id(102),%L,true))$s$,core_test.s('shift_e2')));
select core_test.check('the second shift keeps its own copy of the new rate',
 (select shift_fee_cents from public.courier_shifts where id=core_test.s('shift_e2'))=5000);

select set_config('core.today',core_test.as_actor(18,$s$select public.get_courier_home()$s$)->>'today',false);
select core_test.check('home shows today: 1 delivery, first encosta of the day, R$ 37,00',
 current_setting('core.today')::jsonb = jsonb_build_object(
  'deliveries',1,'shiftFeeCents',3000,'deliveryFeesCents',700,'totalCents',3700));
select core_test.check('history has the day in B with the same numbers',
 core_test.as_actor(18,$s$select public.get_courier_history(7)$s$) = jsonb_build_array(jsonb_build_object(
  'day',(now() at time zone 'America/Sao_Paulo')::date,'restaurantName','Synthetic B',
  'deliveries',1,'shiftFeeCents',3000,'deliveryFeesCents',700,'totalCents',3700)));
select set_config('core.pay',core_test.as_actor(4,$s$select public.get_courier_pay(core_test.id(102))$s$)::text,false);
select core_test.check('the store settlement shows the courier with the same total and the current rates',
 (current_setting('core.pay')::jsonb->>'shiftFeeCents')::int=5000
 and (current_setting('core.pay')::jsonb->>'deliveryFeeCents')::int=900
 and (current_setting('core.pay')::jsonb->>'canEdit')::boolean
 and current_setting('core.pay')::jsonb->'couriers'=jsonb_build_array(jsonb_build_object(
  'name','Synthetic 18','deliveries',1,'shiftFeeCents',3000,'deliveryFeesCents',700,'totalCents',3700)));
select core_test.check('another store sees nothing of B',
 not exists (select 1 from jsonb_array_elements(core_test.as_actor(1,$s$select public.get_courier_pay(core_test.id(101))$s$)->'couriers') c
  where c->>'name'='Synthetic 18'));

-- Days split at midnight in Sao Paulo: yesterday's delivery leaves today.
update public.delivery_attempts set reported_at=reported_at-interval '1 day' where client_request_id=core_test.id(9811);
select core_test.check('yesterday''s delivery is on its own day',
 core_test.as_actor(18,$s$select public.get_courier_home()$s$)->'today' = jsonb_build_object(
  'deliveries',0,'shiftFeeCents',3000,'deliveryFeesCents',0,'totalCents',3000)
 and jsonb_array_length(core_test.as_actor(18,$s$select public.get_courier_history(7)$s$))=2
 and (core_test.as_actor(18,$s$select public.get_courier_history(7)$s$)->1->>'deliveries')::int=1);
select core_test.check('a past day can be read by the store',
 (core_test.as_actor(4,format($s$select public.get_courier_pay(core_test.id(102),%L::date)$s$,
   (now() at time zone 'America/Sao_Paulo')::date-1))->'couriers'->0->>'totalCents')::int=700);
select core_test.act(18);
set role authenticated;
select core_test.expect('history is limited to 90 days',
 $s$select public.get_courier_history(91)$s$,'22023');
select core_test.expect('history needs at least a day',
 $s$select public.get_courier_history(0)$s$,'22023');
reset role;

select core_test.check('earnings functions are definer, signed-in only, empty search_path',
 (select bool_and(p.prosecdef and p.proconfig=array['search_path=""']
   and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
  from pg_proc p where p.oid in ('public.set_courier_pay(uuid,integer,integer)'::regprocedure,
   'public.get_courier_pay(uuid,date)'::regprocedure,'public.get_courier_history(integer)'::regprocedure)));

-- "Você é o próximo" on a fresh route: none at the start, one when the second stop came up.
select core_test.check('route e: next-stop message only for the stop that came up after the first',
 (select count(*) from public.delivery_notifications where type='NEXT_DELIVERY' and delivery_id=core_test.s('e2'))=1
 and not exists (select 1 from public.delivery_notifications where type='NEXT_DELIVERY' and delivery_id=core_test.s('e1')));
