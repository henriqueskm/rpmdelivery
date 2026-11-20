-- Contracts for "Dados da loja" and the distance checks on the courier's swipes.
-- Runs after earnings-contracts.sql (uses core_test.as_actor). A fresh store C (103),
-- owner 19, operator 20 and courier F (21) in Itatiba, so nothing else interferes.
insert into auth.users(id,email,raw_user_meta_data) select core_test.id(n),'core-'||n||'@fixture.invalid',
 jsonb_build_object('name','Synthetic '||n) from generate_series(19,21) n;
insert into public.restaurants(id,name,address,latitude,longitude) values
 (core_test.id(103),'Synthetic C','Rua Loja 1, Itatiba',-23.0058,-46.8389);
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(103),core_test.id(19),'OWNER',true),
 (core_test.id(103),core_test.id(20),'OPERATOR',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
 values (core_test.id(221),core_test.id(21),'Moto F','NNN1N11','Cinza');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status)
 values (core_test.id(341),core_test.id(103),core_test.id(221),'ACTIVE');

-- The message an actor's statement raised, or 'no error'.
create function core_test.raised(actor integer, statement text) returns text language plpgsql as $$
declare v text;
begin
 perform core_test.act(actor);
 set local role authenticated;
 begin execute statement; v := 'no error';
 exception when others then v := sqlerrm; end;
 reset role;
 return v;
end; $$;

-- ---------------------------------------------------------
-- Dados da loja
-- ---------------------------------------------------------
select core_test.check('an operator cannot change the store data',
 core_test.raised(20,$s$select public.update_restaurant_profile(core_test.id(103),'Outro','')$s$)='RPM_STORE_MANAGER_REQUIRED');
select core_test.check('a courier cannot change the store data',
 core_test.raised(21,$s$select public.update_restaurant_profile(core_test.id(103),'Outro','')$s$)='RPM_STORE_MANAGER_REQUIRED');
select core_test.check('the owner of another store cannot change it',
 core_test.raised(4,$s$select public.update_restaurant_profile(core_test.id(103),'Outro','')$s$)='RPM_STORE_MANAGER_REQUIRED');
select core_test.check('a blank name is refused',
 core_test.raised(19,$s$select public.update_restaurant_profile(core_test.id(103),'  ','')$s$)='RPM_STORE_FIELDS');
select core_test.check('a landline is refused',
 core_test.raised(19,$s$select public.update_restaurant_profile(core_test.id(103),'C','1133334444')$s$)='RPM_STORE_PHONE');
select core_test.check('an address without a confirmed location is refused',
 core_test.raised(19,$s$select public.update_restaurant_profile(core_test.id(103),'C','',p_address=>'Rua Nova 2')$s$)='RPM_STORE_ADDRESS');
select core_test.check('name and phone change, the address stays',
 core_test.as_actor(19,$s$select public.update_restaurant_profile(core_test.id(103),' Cozinha C ','(11) 98765-4321')$s$)
  = jsonb_build_object('id',core_test.id(103),'name','Cozinha C','phone','+5511987654321',
    'address','Rua Loja 1, Itatiba','latitude',-23.0058,'longitude',-46.8389));
select core_test.as_actor(19,$s$select public.update_restaurant_profile(core_test.id(103),'Cozinha C','',
 p_address=>'Rua Loja 9, Itatiba',p_latitude=>-23.0059,p_longitude=>-46.8390,
 p_address_provider=>'mapbox',p_address_provider_id=>'addr_store_c')$s$);
select core_test.check('a confirmed address moves the store pin and clears the phone',
 (select address='Rua Loja 9, Itatiba' and latitude=-23.0059 and longitude=-46.8390
   and address_provider_id='addr_store_c' and phone is null from public.restaurants where id=core_test.id(103)));
select core_test.check('only signed-in users reach the store data command',
 has_function_privilege('authenticated','public.update_restaurant_profile(uuid,text,text,text,double precision,double precision,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.update_restaurant_profile(uuid,text,text,text,double precision,double precision,text,text)','EXECUTE'));

-- ---------------------------------------------------------
-- A route with pins: near, far, far by the last GPS point, no pin
-- ---------------------------------------------------------
select set_config('core.shift_f',core_test.as_actor(21,$s$select public.request_shift(core_test.id(103))$s$)->>'shiftId',false);
select core_test.as_actor(19,format($s$select to_jsonb(public.review_shift(core_test.id(103),%L,true))$s$,core_test.s('shift_f')));
select set_config('core.f'||n,core_test.as_actor(19,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(103),p_request_id=>core_test.id(%s),
   p_customer_name=>'Distância %s',p_customer_phone=>'1195555000%s',p_delivery_address=>'Rua F%s',
   p_latitude=>%s,p_longitude=>%s,p_address_provider=>%L,p_address_provider_id=>%L)$s$,
 9900+n,n,n,n,
 case n when 3 then 'null' else (array['-23.0048','-23.0070','','-23.0100'])[n] end,
 case n when 3 then 'null' else (array['-46.8371','-46.8674','','-46.8100'])[n] end,
 case n when 3 then null else 'mapbox' end, case n when 3 then null else 'addr_f'||n end))->>'deliveryId',false)
 from generate_series(1,4) n;
select set_config('core.route_f',core_test.as_actor(19,format(
 $s$select public.create_route(core_test.id(103),core_test.id(9910),%L,array[%L,%L,%L,%L]::uuid[])$s$,
 core_test.s('shift_f'),core_test.s('f1'),core_test.s('f2'),core_test.s('f4'),core_test.s('f3')))->>'routeId',false);
select core_test.as_actor(19,format($s$select public.release_route_pickup(core_test.id(103),%L,1)$s$,core_test.s('route_f')));
select core_test.as_actor(21,format($s$select public.start_route(%L,1)$s$,core_test.s('route_f')));

select core_test.check('half a position is refused',
 core_test.raised(21,format($s$select public.complete_delivery(core_test.id(9911),%L,%L,p_latitude=>-23.0)$s$,
  core_test.s('route_f'),core_test.s('f1')))='RPM_LOCATION_FIELDS');

-- 1. At the door (a few meters off the pin).
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9911),%L,%L,-23.00485,-46.83712,12)$s$,
 core_test.s('route_f'),core_test.s('f1')));
select core_test.check('at the door: delivered, distance kept, not far',
 (select outcome='DELIVERED' and distance_meters < 20 and not far_from_address
   from public.delivery_attempts where client_request_id=core_test.id(9911)));

-- 2. Three km away: stopped until the courier confirms.
select core_test.check('far from the address: stopped with the distance in meters',
 core_test.raised(21,format($s$select public.complete_delivery(core_test.id(9912),%L,%L,-23.0058,-46.8389,10)$s$,
  core_test.s('route_f'),core_test.s('f2'))) ~ '^RPM_FAR_FROM_ADDRESS [0-9]{4}$');
select core_test.check('nothing was applied while stopped',
 not exists (select 1 from public.delivery_attempts where client_request_id=core_test.id(9912))
 and (select status='NEXT' from public.deliveries where id=core_test.s('f2')));
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9912),%L,%L,-23.0058,-46.8389,10,true)$s$,
 core_test.s('route_f'),core_test.s('f2')));
select core_test.check('confirmed far: delivered and flagged with the distance',
 (select outcome='DELIVERED' and far_from_address and distance_meters between 2500 and 3500
   from public.delivery_attempts where client_request_id=core_test.id(9912)));
select core_test.check('a replay of the confirmed delivery is not stopped again',
 core_test.raised(21,format($s$select public.complete_delivery(core_test.id(9912),%L,%L,-23.0058,-46.8389,10)$s$,
  core_test.s('route_f'),core_test.s('f2')))='no error');

-- 3. No position from the app (old version, no permission): never stopped,
-- measured from the last GPS point and flagged when far.
select core_test.as_actor(21,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0058,'longitude',-46.8389,'accuracy',8,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_f')));
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9914),%L,%L)$s$,
 core_test.s('route_f'),core_test.s('f4')));
select core_test.check('without the app position: delivered, flagged from the last GPS point',
 (select outcome='DELIVERED' and far_from_address and distance_meters > 300
   from public.delivery_attempts where client_request_id=core_test.id(9914)));

-- 4. An order saved without a pin: nothing to compare.
select core_test.as_actor(21,format($s$select public.complete_delivery(core_test.id(9913),%L,%L,-23.5,-46.6,5)$s$,
 core_test.s('route_f'),core_test.s('f3')));
select core_test.check('no pin on the order: delivered, no distance',
 (select outcome='DELIVERED' and distance_meters is null and not far_from_address
   from public.delivery_attempts where client_request_id=core_test.id(9913)));

select core_test.check('the panel lists the far deliveries, not the near ones',
 (select count(*) from jsonb_array_elements(core_test.as_actor(20,
   $s$select public.get_operations_board(core_test.id(103))$s$)->'farDeliveries') f
   where (f->>'deliveryId')::uuid in (core_test.s('f2'),core_test.s('f4')) and (f->>'distanceMeters')::int > 300)=2
 and not exists (select 1 from jsonb_array_elements(core_test.as_actor(20,
   $s$select public.get_operations_board(core_test.id(103))$s$)->'farDeliveries') f
   where (f->>'deliveryId')::uuid in (core_test.s('f1'),core_test.s('f3'))));

-- ---------------------------------------------------------
-- Back at the store
-- ---------------------------------------------------------
select core_test.check('"cheguei" far from the store is refused with the distance',
 core_test.raised(21,format($s$select public.arrive_at_store(%L,-23.0070,-46.8674,10)$s$,core_test.s('route_f')))
  ~ '^RPM_FAR_FROM_STORE [0-9]{4}$');
select core_test.check('the route is still heading back',
 (select status='RETURNING' from public.routes where id=core_test.s('route_f')));
select core_test.check('"cheguei" at the store closes the route',
 core_test.as_actor(21,format($s$select public.arrive_at_store(%L,-23.00595,-46.83905,15)$s$,core_test.s('route_f')))->>'status'='COMPLETED');
select core_test.check('a repeated "cheguei" after closing is not refused for distance',
 core_test.raised(21,format($s$select public.arrive_at_store(%L,-23.0070,-46.8674,10)$s$,core_test.s('route_f')))='no error');

select core_test.check('the original commands are no longer reachable through the API',
 not has_function_privilege('authenticated','private.complete_delivery_core(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.arrive_at_store_core(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.operations_board_core(uuid)','EXECUTE'));
