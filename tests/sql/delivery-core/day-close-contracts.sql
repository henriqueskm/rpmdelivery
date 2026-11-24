-- Contracts for the day close (migration 20261205120000). A fresh store F (106), owner 46, couriers
-- 47 (back in line), 48 (still out on a route) and 49 (waiting for approval). Owner B (4) and the
-- outsider (8) are not members of F. core_test.try_as comes from courier-card-contracts.sql.
insert into auth.users(id,email,raw_user_meta_data) select core_test.id(n),'core-'||n||'@fixture.invalid',
 jsonb_build_object('name','Synthetic '||n) from generate_series(46,49) n;
insert into public.restaurants(id,name,address) values (core_test.id(106),'Synthetic F','Rua Loja 6');
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(106),core_test.id(46),'OWNER',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
 select core_test.id(204+n),core_test.id(n),'Moto '||n,'FFF1F'||n,'Azul' from generate_series(47,49) n;
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status)
 select core_test.id(304+n),core_test.id(106),core_test.id(204+n),'ACTIVE' from generate_series(47,49) n;

-- Rates first: the encosta is copied when the shift is approved, the fee when the delivery is done.
select core_test.as_actor(46,$s$select public.set_courier_pay(core_test.id(106),3000,500)$s$);
select set_config('core.dc_shift_'||n,core_test.as_actor(n,$s$select public.request_shift(core_test.id(106))$s$)->>'shiftId',false)
 from generate_series(47,49) n;
select core_test.as_actor(46,format($s$select to_jsonb(public.review_shift(core_test.id(106),%L,true))$s$,core_test.s('dc_shift_'||n)))
 from generate_series(47,48) n;

-- Six orders: cash with change, card, paid, no payment, one left waiting, one cancelled.
select set_config('core.dc_'||k,core_test.as_actor(46,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(106),p_request_id=>core_test.id(%s),
   p_customer_name=>%L,p_customer_phone=>%L,p_delivery_address=>%L,
   p_payment_method=>%s,p_amount_due_cents=>%s,p_change_for_cents=>%s)$s$,
 8900+n,'Fecha '||k,'119555530'||lpad(n::text,2,'0'),'Rua Fecha '||n,m,a,c))::text,false)
 from (values ('cash',1,'''CASH''','5000','10000'),('card',2,'''CARD''','3000','null'),('paid',3,'''PAID''','null','null'),
   ('none',4,'null','null','null'),('wait',5,'''PAID''','null','null'),('cancel',6,'''PAID''','null','null')) v(k,n,m,a,c);
select core_test.as_actor(46,format($s$select to_jsonb(public.cancel_order(core_test.id(106),%L))$s$,
 current_setting('core.dc_cancel')::jsonb->>'orderId'));

-- 48 delivers cash and card and is still on the way back; 47 delivers paid and no-payment and comes back.
select set_config('core.dc_route_'||n,core_test.as_actor(46,format(
 $s$select public.create_route(core_test.id(106),core_test.id(%s),%L,array[%L,%L]::uuid[])$s$,
 8910+n,core_test.s('dc_shift_'||n),current_setting('core.dc_'||a)::jsonb->>'deliveryId',current_setting('core.dc_'||b)::jsonb->>'deliveryId'))->>'routeId',false)
 from (values (48,'cash','card'),(47,'paid','none')) v(n,a,b);
select core_test.as_actor(46,format($s$select public.release_route_pickup(core_test.id(106),%L,1)$s$,core_test.s('dc_route_'||n)))
 from generate_series(47,48) n;
select core_test.as_actor(n,format($s$select public.start_route(%L,1)$s$,core_test.s('dc_route_'||n))) from generate_series(47,48) n;
select core_test.as_actor(n,format($s$select public.complete_delivery(core_test.id(%s),%L,%L)$s$,
 8920+i,core_test.s('dc_route_'||n),current_setting('core.dc_'||k)::jsonb->>'deliveryId'))
 from (values (48,'cash',1),(48,'card',2),(47,'paid',3),(47,'none',4)) v(n,k,i) order by i;
select core_test.as_actor(47,format($s$select public.arrive_at_store(%L)$s$,core_test.s('dc_route_47')));

-- ---------------------------------------------------------
-- Before closing: what the store sees
-- ---------------------------------------------------------
select set_config('core.dc_preview',core_test.as_actor(46,$s$select public.get_day_close(core_test.id(106))$s$)::text,false);
select core_test.check('the store sees who still has a shift open, and who is out on a route',
 (select jsonb_agg(jsonb_build_array(x->>'name',x->>'status',x->>'onRoute') order by x->>'name')
   from jsonb_array_elements(current_setting('core.dc_preview')::jsonb->'openShifts') x)
 = '[["Synthetic 47","AVAILABLE","false"],["Synthetic 48","RETURNING","true"],["Synthetic 49","PENDING","false"]]'::jsonb
 and jsonb_array_length(current_setting('core.dc_preview')::jsonb->'closes') = 0
 and jsonb_array_length(current_setting('core.dc_preview')::jsonb->'preview'->'couriers') = 2);

-- ---------------------------------------------------------
-- Closing
-- ---------------------------------------------------------
select set_config('core.dc_close',core_test.as_actor(46,$s$select public.close_store_day(core_test.id(106),core_test.id(8930))$s$)::text,false);
select set_config('core.dc_report',(current_setting('core.dc_close')::jsonb->'report')::text,false);
select core_test.check('closing ends every shift not out on a route; the one on the way back goes on',
 (select status='ENDED' and ended_by=core_test.id(46) from public.courier_shifts where id=core_test.s('dc_shift_47'))
 and (select status='ENDED' from public.courier_shifts where id=core_test.s('dc_shift_49'))
 and (select status='RETURNING' from public.courier_shifts where id=core_test.s('dc_shift_48'))
 and current_setting('core.dc_report')::jsonb->'endedShifts' = '["Synthetic 47","Synthetic 49"]'::jsonb
 and current_setting('core.dc_report')::jsonb->'stillOut' = '["Synthetic 48"]'::jsonb);
select core_test.check('each courier: deliveries, encosta and fees, and what was collected at the door',
 current_setting('core.dc_report')::jsonb->'couriers' = jsonb_build_array(
   jsonb_build_object('name','Synthetic 47','deliveries',2,'shiftFeeCents',3000,'deliveryFeesCents',1000,'totalCents',4000,
     'cashCents',0,'cardCents',0,'pixCents',0),
   jsonb_build_object('name','Synthetic 48','deliveries',2,'shiftFeeCents',3000,'deliveryFeesCents',1000,'totalCents',4000,
     'cashCents',5000,'cardCents',3000,'pixCents',0)));
select core_test.check('the orders received in the period, and the payments of what was delivered',
 current_setting('core.dc_report')::jsonb->'orders'
   = '{"received":6,"delivered":4,"cancelled":1,"waiting":1,"onTheWay":0}'::jsonb
 and current_setting('core.dc_report')::jsonb->'payments'
   = '{"paid":1,"cashCents":5000,"cardCents":3000,"pixCents":0,"notInformed":1}'::jsonb);
select core_test.check('pressing it again (same request) answers the same close',
 (core_test.as_actor(46,$s$select public.close_store_day(core_test.id(106),core_test.id(8930))$s$)->>'created')::boolean = false
 and (select count(*)=1 from private.store_day_closes where restaurant_id=core_test.id(106)));

-- The next close covers only what came after: nothing delivered, and 48 is still out.
select set_config('core.dc_close2',core_test.as_actor(46,$s$select public.close_store_day(core_test.id(106),core_test.id(8931))$s$)::text,false);
select core_test.check('the next period starts where the last one ended',
 (current_setting('core.dc_close2')::jsonb->'report'->>'periodStart')::timestamptz
   = (current_setting('core.dc_report')::jsonb->>'periodEnd')::timestamptz
 and current_setting('core.dc_close2')::jsonb->'report'->'couriers' = '[]'::jsonb
 and (current_setting('core.dc_close2')::jsonb->'report'->'orders'->>'received')::int = 0
 and current_setting('core.dc_close2')::jsonb->'report'->'stillOut' = '["Synthetic 48"]'::jsonb);

select set_config('core.dc_after',core_test.as_actor(46,$s$select public.get_day_close(core_test.id(106))$s$)::text,false);
select core_test.check('the closes are listed newest first, and each report reads as it was saved',
 (select array_agg(x.value->>'id' order by x.n)
   from jsonb_array_elements(current_setting('core.dc_after')::jsonb->'closes') with ordinality as x(value, n))
   = array[current_setting('core.dc_close2')::jsonb->>'closeId', current_setting('core.dc_close')::jsonb->>'closeId']
 and current_setting('core.dc_after')::jsonb->'closes'->1->>'closedBy' = 'Synthetic 46'
 and core_test.as_actor(46,format($s$select public.get_day_close_report(core_test.id(106),%L)$s$,
   current_setting('core.dc_close')::jsonb->>'closeId')) = current_setting('core.dc_report')::jsonb);

-- ---------------------------------------------------------
-- Who may do it
-- ---------------------------------------------------------
select core_test.check('another store and outsiders are refused, also for a saved report',
 core_test.try_as(4,$s$select public.close_store_day(core_test.id(106),core_test.id(8932))$s$)='42501'
 and core_test.try_as(8,$s$select public.get_day_close(core_test.id(106))$s$)='42501'
 and core_test.try_as(4,format($s$select public.get_day_close_report(core_test.id(102),%L)$s$,
   current_setting('core.dc_close')::jsonb->>'closeId'))='P0002'
 and core_test.try_as(48,$s$select public.close_store_day(core_test.id(106),core_test.id(8933))$s$)='42501'
 and core_test.try_as(46,$s$select public.close_store_day(core_test.id(106),null)$s$)='22023');
select core_test.check('the closes table and the helpers are out of the API',
 not has_table_privilege('authenticated','private.store_day_closes','SELECT')
 and not has_function_privilege('authenticated','private.day_report(uuid,timestamptz,timestamptz)','EXECUTE')
 and not has_function_privilege('authenticated','private.open_shifts(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.close_store_day(uuid,uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.close_store_day(uuid,uuid)','EXECUTE')
 and (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('close_store_day','get_day_close','get_day_close_report')));
