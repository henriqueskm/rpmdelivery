-- Contracts for the courier app's home read (get_courier_home).
-- Runs after board-contracts.sql: W (9) is on route_w3 in store A; P (16)
-- has an AVAILABLE shift in A after its route was cancelled.
create function core_test.home(actor integer) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform core_test.act(actor);
 set local role authenticated;
 v := public.get_courier_home();
 reset role;
 return v;
end; $$;
create function core_test.courier_route(actor integer) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 perform core_test.act(actor);
 set local role authenticated;
 v := public.get_courier_route();
 reset role;
 return v;
end; $$;

-- ---------------------------------------------------------
-- Who can read
-- ---------------------------------------------------------
set role anon;
select core_test.expect('anon cannot read a courier home',
 $s$select public.get_courier_home()$s$,'42501');
reset role;
select core_test.act(8);
set role authenticated;
select core_test.expect('a user without a courier profile is refused',
 $s$select public.get_courier_home()$s$,'42501');
select core_test.act(2);
select core_test.expect('a store operator is not a courier',
 $s$select public.get_courier_home()$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- On the street
-- ---------------------------------------------------------
select set_config('core.h',core_test.home(9)::text,false);
select core_test.check('courier on route sees the shift, no place in line, and the route',
 (current_setting('core.h')::jsonb->>'serverNow') is not null
 and current_setting('core.h')::jsonb->'shift'->>'status'='ON_ROUTE'
 and current_setting('core.h')::jsonb->'shift'->>'restaurantId'=core_test.id(101)::text
 and current_setting('core.h')::jsonb->'shift'->>'restaurantName'='Synthetic A'
 and current_setting('core.h')::jsonb->'shift'->'queuePosition'='null'::jsonb
 and current_setting('core.h')::jsonb->'route'->>'routeId'=core_test.s('route_w3')::text
 and current_setting('core.h')::jsonb->'route'->>'nextDeliveryId'=core_test.s('t2')::text);
select core_test.check('home route is the courier route read, still without customer phones',
 current_setting('core.h')::jsonb->'route' = core_test.courier_route(9)
 and current_setting('core.h')::jsonb::text not like '%+55%'
 and not exists (select 1 from jsonb_array_elements(current_setting('core.h')::jsonb->'route'->'stops') s
  where s ? 'phone' or s ? 'customerPhone'));
select core_test.check('approved store is listed with the id request_shift takes',
 exists (select 1 from jsonb_array_elements(current_setting('core.h')::jsonb->'stores') s
  where s->>'restaurantId'=core_test.id(101)::text and s->>'name'='Synthetic A' and s->>'linkStatus'='ACTIVE'));

-- Y (6) only has a link waiting for the store: listed, no shift, no route.
select set_config('core.h',core_test.home(6)::text,false);
select core_test.check('waiting link is listed and nothing else',
 current_setting('core.h')::jsonb->'stores'=jsonb_build_array(jsonb_build_object(
   'restaurantId',core_test.id(101),'name','Synthetic A','linkStatus','PENDING'))
 and current_setting('core.h')::jsonb->'shift'='null'::jsonb
 and current_setting('core.h')::jsonb->'route'='null'::jsonb);

-- ---------------------------------------------------------
-- Place in line
-- ---------------------------------------------------------
-- A new courier N arrives after P: pending, then right behind P.
insert into auth.users(id,email,raw_user_meta_data)
 values (core_test.id(17),'core-17@fixture.invalid',jsonb_build_object('name','Synthetic 17'));
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
 values (core_test.id(217),core_test.id(17),'Moto N','LLL1L11','Roxa');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status)
 values (core_test.id(337),core_test.id(101),core_test.id(217),'ACTIVE');
select core_test.check('before asking, the store is there and there is no shift',
 core_test.home(17)->'shift'='null'::jsonb
 and core_test.home(17)->'stores'->0->>'restaurantId'=core_test.id(101)::text);
select core_test.act(17);
set role authenticated;
select set_config('core.shift_n',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
select core_test.check('pending shift has no place in line yet',
 core_test.home(17)->'shift'->>'shiftId'=core_test.s('shift_n')::text
 and core_test.home(17)->'shift'->>'status'='PENDING'
 and core_test.home(17)->'shift'->'queuePosition'='null'::jsonb);
select core_test.act(2);
set role authenticated;
select public.review_shift(core_test.id(101),core_test.s('shift_n'),true);
reset role;
select set_config('core.p_place',core_test.home(16)->'shift'->>'queuePosition',false);
select core_test.check('approved courier is in line right behind the one who arrived first',
 current_setting('core.p_place')::int>=1
 and (core_test.home(17)->'shift'->>'queuePosition')::int=current_setting('core.p_place')::int+1);

-- A route in preparation reserves P: P leaves the line and N moves up.
select core_test.act(2);
set role authenticated;
select set_config('core.route_p',public.create_route(core_test.id(101),core_test.id(9903),core_test.s('shift_r'),
 array[core_test.s('t4')])->>'routeId',false);
reset role;
select core_test.check('reserved courier sees the route instead of a place in line',
 core_test.home(16)->'shift'->'queuePosition'='null'::jsonb
 and core_test.home(16)->'route'->>'routeId'=core_test.s('route_p')::text
 and core_test.home(16)->'route'->>'status'='PREPARING'
 and (core_test.home(17)->'shift'->>'queuePosition')::int=current_setting('core.p_place')::int);

-- Ending the shift empties the home again.
select core_test.act(17);
set role authenticated;
select public.end_shift(core_test.s('shift_n'));
reset role;
select core_test.check('ended shift is gone from the home',
 core_test.home(17)->'shift'='null'::jsonb);

select core_test.check('courier home is a definer read for signed-in users, empty search_path',
 has_function_privilege('authenticated','public.get_courier_home()','EXECUTE')
 and not has_function_privilege('anon','public.get_courier_home()','EXECUTE')
 and (select p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
  from pg_proc p where p.oid='public.get_courier_home()'::regprocedure));
