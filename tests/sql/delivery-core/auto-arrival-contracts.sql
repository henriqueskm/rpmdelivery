-- Contracts for the automatic arrival at the store by GPS (migration 20261203120000).
-- A fresh store D (104) with a pin, owner 30, couriers G (31, GPS on) and H (32, GPS off).
insert into auth.users(id,email,raw_user_meta_data) select core_test.id(n),'core-'||n||'@fixture.invalid',
 jsonb_build_object('name','Synthetic '||n) from generate_series(30,32) n;
insert into public.restaurants(id,name,address,latitude,longitude) values
 (core_test.id(104),'Synthetic D','Rua Loja 4, Itatiba',-23.0058,-46.8389);
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(104),core_test.id(30),'OWNER',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color) values
 (core_test.id(231),core_test.id(31),'Moto G','GGG1G11','Azul'),
 (core_test.id(232),core_test.id(32),'Moto H','HHH1H11','Preta');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status) values
 (core_test.id(331),core_test.id(104),core_test.id(231),'ACTIVE'),
 (core_test.id(332),core_test.id(104),core_test.id(232),'ACTIVE');

-- One order each, ~1 km from the store; each courier takes one and delivers it at the door.
select set_config('core.shift_'||c,core_test.as_actor(n,$s$select public.request_shift(core_test.id(104))$s$)->>'shiftId',false)
 from (values ('g',31),('h',32)) v(c,n);
select core_test.as_actor(30,format($s$select to_jsonb(public.review_shift(core_test.id(104),%L,true))$s$,core_test.s('shift_'||c)))
 from (values ('g'),('h')) v(c);
select set_config('core.a'||c,core_test.as_actor(30,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(104),p_request_id=>core_test.id(%s),
   p_customer_name=>'Chegada %s',p_customer_phone=>'1195555100%s',p_delivery_address=>'Rua Volta %s',
   p_latitude=>-23.0148,p_longitude=>-46.8389,p_address_provider=>'mapbox',p_address_provider_id=>%L)$s$,
 9980+n,c,n,n,'addr_auto_'||c))->>'deliveryId',false)
 from (values ('g',1),('h',2)) v(c,n);
select set_config('core.route_'||c,core_test.as_actor(30,format(
 $s$select public.create_route(core_test.id(104),core_test.id(%s),%L,array[%L]::uuid[])$s$,
 9984+n,core_test.s('shift_'||c),core_test.s('a'||c)))->>'routeId',false)
 from (values ('g',1),('h',2)) v(c,n);
select core_test.as_actor(30,format($s$select public.release_route_pickup(core_test.id(104),%L,1)$s$,core_test.s('route_'||c)))
 from (values ('g'),('h')) v(c);
select core_test.as_actor(n,format($s$select public.start_route(%L,1)$s$,core_test.s('route_'||c)))
 from (values ('g',31),('h',32)) v(c,n);

-- G passes by the store BEFORE delivering: that point never counts as the arrival.
select core_test.as_actor(31,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0058,'longitude',-46.8389,'accuracy',5,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_g')));
select core_test.as_actor(n,format($s$select public.complete_delivery(core_test.id(%s),%L,%L,-23.0148,-46.8389,8)$s$,
 9986+k,core_test.s('route_'||c),core_test.s('a'||c)))
 from (values ('g',31,1),('h',32,2)) v(c,n,k);
select core_test.check('both routes head back to the store',
 (select count(*)=2 from public.routes where id in (core_test.s('route_g'),core_test.s('route_h')) and status='RETURNING'));

-- ---------------------------------------------------------
-- G: GPS on
-- ---------------------------------------------------------
select core_test.as_actor(31,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0100,'longitude',-46.8389,'accuracy',8,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_g')));
select core_test.check('on the way, 470 m away: still heading back (the point at the store before the delivery does not count)',
 (select status='RETURNING' from public.routes where id=core_test.s('route_g')));

select core_test.as_actor(31,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
 'latitude',-23.0062,'longitude',-46.8389,'accuracy',80,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_g')));
select core_test.check('near the store with a poor signal (80 m): still heading back',
 (select status='RETURNING' from public.routes where id=core_test.s('route_g')));

-- At the store (45 m off the pin, 10 m accuracy), followed by a later point in the same batch.
select set_config('core.at_store',(clock_timestamp())::text,false);
select set_config('core.points_stored',core_test.as_actor(31,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(
 jsonb_build_object('latitude',-23.0062,'longitude',-46.8389,'accuracy',10,'recordedAt',%L),
 jsonb_build_object('latitude',-23.0059,'longitude',-46.8389,'accuracy',6,'recordedAt',%L))))$s$,
 core_test.s('route_g'),current_setting('core.at_store'),(current_setting('core.at_store')::timestamptz+interval '20 seconds')::text))::text,false);
select core_test.check('the points are stored as before',current_setting('core.points_stored')='2');
select core_test.check('at the store: the route closes by itself, by the GPS',
 (select status='COMPLETED' and arrival_source='GPS' and arrived_at=current_setting('core.at_store')::timestamptz
   from public.routes where id=core_test.s('route_g')));
select core_test.check('back in line from the moment the GPS saw the courier there',
 (select status='AVAILABLE' and available_since=current_setting('core.at_store')::timestamptz
   from public.courier_shifts where id=core_test.s('shift_g')));
select core_test.check('the app sees no active route: the courier is in line',
 coalesce(core_test.as_actor(31,$s$select public.get_courier_route()$s$),'null'::jsonb)='null'::jsonb);
select core_test.check('a swipe after that is not refused and changes nothing',
 core_test.as_actor(31,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_g')))->>'changed'='false');
select core_test.check('a late point after closing is still stored and changes nothing',
 core_test.as_actor(31,format($s$select to_jsonb(public.record_courier_locations(%L,jsonb_build_array(jsonb_build_object(
   'latitude',-23.0058,'longitude',-46.8389,'accuracy',5,'recordedAt',clock_timestamp()))))$s$,core_test.s('route_g')))::text='1'
 and (select available_since=current_setting('core.at_store')::timestamptz from public.courier_shifts where id=core_test.s('shift_g')));

-- ---------------------------------------------------------
-- H: GPS off, the swipe as before
-- ---------------------------------------------------------
select core_test.check('without GPS the route waits for the swipe',
 (select status='RETURNING' from public.routes where id=core_test.s('route_h')));
select set_config('core.before_swipe',(clock_timestamp())::text,false);
select core_test.check('the swipe closes the route',
 core_test.as_actor(32,format($s$select public.arrive_at_store(%L)$s$,core_test.s('route_h')))->>'changed'='true');
select core_test.check('by the button, back in line at the time of the swipe',
 (select r.arrival_source='BUTTON' and s.status='AVAILABLE' and s.available_since >= current_setting('core.before_swipe')::timestamptz
   from public.routes r join public.courier_shifts s on s.id=r.courier_shift_id where r.id=core_test.s('route_h')));
select core_test.check('G arrived first, so G is ahead of H in line',
 (select g.available_since < h.available_since from public.courier_shifts g, public.courier_shifts h
   where g.id=core_test.s('shift_g') and h.id=core_test.s('shift_h')));

select core_test.check('the helpers are not reachable through the API',
 not has_function_privilege('authenticated','private.store_arrival_at(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.finish_return(public.routes,timestamptz,timestamptz,text)','EXECUTE')
 and not has_function_privilege('authenticated','private.arrive_at_store_core(uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.record_courier_locations(uuid,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.record_courier_locations(uuid,jsonb)','EXECUTE'));
