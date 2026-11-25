-- Contracts for the line by arrival at the store (migration 20261208120000).
-- Store K (110) with a pin, owner 60, couriers K1 (61), K2 (62), K3 (63).
insert into auth.users(id,email,raw_user_meta_data) select core_test.id(n),'core-'||n||'@fixture.invalid',
 jsonb_build_object('name','Synthetic '||n) from generate_series(60,63) n;
insert into public.restaurants(id,name,address,latitude,longitude) values
 (core_test.id(110),'Synthetic K','Rua Loja 10, Itatiba',-23.0058,-46.8389);
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(110),core_test.id(60),'OWNER',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color) values
 (core_test.id(261),core_test.id(61),'Moto K1','KKK1K11','Azul'),
 (core_test.id(262),core_test.id(62),'Moto K2','KKK2K22','Preta'),
 (core_test.id(263),core_test.id(63),'Moto K3','KKK3K33','Branca');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status) values
 (core_test.id(361),core_test.id(110),core_test.id(261),'ACTIVE'),
 (core_test.id(362),core_test.id(110),core_test.id(262),'ACTIVE'),
 (core_test.id(363),core_test.id(110),core_test.id(263),'ACTIVE');

select set_config('core.shift_k'||n,core_test.as_actor(60+n,$s$select public.request_shift(core_test.id(110))$s$)->>'shiftId',false)
 from generate_series(1,3) n;
select core_test.check('K3 cannot arrive before the store approves',
 core_test.raised(63,'select public.arrive_for_shift()') = 'RPM_SHIFT_STATE');
select core_test.as_actor(60,format($s$select to_jsonb(public.review_shift(core_test.id(110),%L,true))$s$,core_test.s('shift_k'||n)))
 from generate_series(1,3) n;

-- ---------------------------------------------------------
-- Approved from home: "a caminho", not in line
-- ---------------------------------------------------------
select core_test.check('approved with a store pin: AVAILABLE but not arrived',
 (select count(*)=3 from public.courier_shifts where restaurant_id=core_test.id(110)
   and status='AVAILABLE' and arrived_at is null and arrival_source is null));
select core_test.check('the home says a caminho: no position in line, arrivedAt null',
 (select h->'shift'->'queuePosition'='null'::jsonb and h->'shift'->'arrivedAt'='null'::jsonb
  from core_test.as_actor(61,'select public.get_courier_home()') h));

-- ---------------------------------------------------------
-- GPS arrival needs to really be at the store
-- ---------------------------------------------------------
select core_test.check('GPS 500 m away does not enter the line',
 core_test.raised(61,'select public.arrive_for_shift(-23.0103,-46.8389,8,true)') = 'RPM_NOT_AT_STORE');
select core_test.check('GPS at the store with a poor signal (80 m) does not enter the line',
 core_test.raised(61,'select public.arrive_for_shift(-23.0060,-46.8389,80,true)') = 'RPM_NOT_AT_STORE');
select core_test.check('GPS arrival without a position is refused',
 core_test.raised(61,'select public.arrive_for_shift(null,null,null,true)') = 'RPM_NOT_AT_STORE');
select core_test.check('a malformed position is refused',
 core_test.raised(61,'select public.arrive_for_shift(-23.0058,null,8,true)') = 'RPM_LOCATION_FIELDS');

-- ---------------------------------------------------------
-- The swipe: 300 m check with a position, accepted without one
-- ---------------------------------------------------------
select core_test.check('"Cheguei na loja" 1 km away is refused with the distance',
 core_test.raised(62,'select public.arrive_for_shift(-23.0148,-46.8389,10,false)') ~ '^RPM_FAR_FROM_STORE [0-9]{3,4}$');
select set_config('core.k2_arrived',(core_test.as_actor(62,'select public.arrive_for_shift()')->>'arrivedAt'),false);
select core_test.check('K2 swipes without a position: in line, by the button',
 (select arrived_at is not null and arrival_source='BUTTON' and available_since=arrived_at
  from public.courier_shifts where id=core_test.s('shift_k2')));
select core_test.check('K2 is first in line',
 (select (h->'shift'->>'queuePosition')::int=1 and h->'shift'->>'arrivedAt' is not null
  from core_test.as_actor(62,'select public.get_courier_home()') h));

-- K1 arrives by GPS, 45 m from the pin with 10 m accuracy: behind K2, who got there first.
select core_test.check('K1 arrives by GPS',
 (select r->>'changed'='true' from core_test.as_actor(61,'select public.arrive_for_shift(-23.0062,-46.8389,10,true)') r));
select core_test.check('K1 is second in line',
 (select (h->'shift'->>'queuePosition')::int=2 from core_test.as_actor(61,'select public.get_courier_home()') h));
select core_test.check('counted from the GPS arrival',
 (select arrival_source='GPS' and available_since=arrived_at from public.courier_shifts where id=core_test.s('shift_k1')));
select core_test.check('arriving again changes nothing',
 (select r->>'changed'='false' from core_test.as_actor(61,'select public.arrive_for_shift(-23.0062,-46.8389,10,true)') r));
select core_test.check('K2 stays first',
 (select (h->'shift'->>'queuePosition')::int=1 from core_test.as_actor(62,'select public.get_courier_home()') h));

-- ---------------------------------------------------------
-- The store marks the arrival ("Chegou" in the panel)
-- ---------------------------------------------------------
select core_test.check('a courier cannot use the store command',
 core_test.raised(63,format('select public.mark_shift_arrived(core_test.id(110),%L)',core_test.s('shift_k3'))) <> 'no error');
select core_test.check('the board says who is still on the way',
 (select count(*)=1 from jsonb_array_elements(core_test.as_actor(60,'select public.get_operations_board(core_test.id(110))')->'shiftArrivals') a
   where a->>'shiftId'=core_test.s('shift_k3')::text and a->'arrivedAt'='null'::jsonb));
select core_test.check('the store marks K3 as arrived',
 (select r->>'changed'='true' from core_test.as_actor(60,format('select public.mark_shift_arrived(core_test.id(110),%L)',core_test.s('shift_k3'))) r));
select core_test.check('by the store',
 (select arrival_source='STORE' from public.courier_shifts where id=core_test.s('shift_k3')));
select core_test.check('K3 is third in line',
 (select (h->'shift'->>'queuePosition')::int=3 from core_test.as_actor(63,'select public.get_courier_home()') h));
select core_test.check('the board has every open shift of the store arrived',
 (select count(*)=3 and bool_and(a->>'arrivedAt' is not null)
  from jsonb_array_elements(core_test.as_actor(60,'select public.get_operations_board(core_test.id(110))')->'shiftArrivals') a));

-- ---------------------------------------------------------
-- Other stores and older shifts
-- ---------------------------------------------------------
select core_test.check('a store without a pin keeps the old behavior: in line at the approval',
 exists (select 1 from public.courier_shifts s join public.restaurants r on r.id=s.restaurant_id
   where r.latitude is null and s.arrival_source='NO_PIN' and s.arrived_at=s.approved_at));
select core_test.check('a route assigned before the arrival counts as arrived when it starts',
 (select count(*)=2 from public.courier_shifts where restaurant_id=core_test.id(104) and arrival_source='ROUTE'
   and arrived_at is not null));
select core_test.check('nobody approved is left in line without an arrival',
 not exists (select 1 from public.courier_shifts where status in ('ON_ROUTE','RETURNING') and arrived_at is null));

-- ---------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------
select core_test.check('anon cannot arrive or mark arrivals',
 not has_function_privilege('anon','public.arrive_for_shift(double precision,double precision,double precision,boolean)','execute')
 and not has_function_privilege('anon','public.mark_shift_arrived(uuid,uuid)','execute'));
select core_test.check('the private helpers are closed',
 not has_function_privilege('authenticated','private.enter_queue(uuid,timestamptz,text)','execute')
 and not has_function_privilege('authenticated','private.operations_board_payments(uuid)','execute'));
