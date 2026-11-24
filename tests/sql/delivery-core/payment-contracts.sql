-- Contracts for the payment collected at the door (migration 20261204120000).
-- A fresh store E (105), owner 40, courier 41. Owner B (4) is not a member of E.
insert into auth.users(id,email,raw_user_meta_data) select core_test.id(n),'core-'||n||'@fixture.invalid',
 jsonb_build_object('name','Synthetic '||n) from generate_series(40,41) n;
insert into public.restaurants(id,name,address) values (core_test.id(105),'Synthetic E','Rua Loja 5');
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(105),core_test.id(40),'OWNER',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color) values
 (core_test.id(240),core_test.id(41),'Moto E','EEE1E11','Vermelha');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status) values
 (core_test.id(340),core_test.id(105),core_test.id(240),'ACTIVE');

-- ---------------------------------------------------------
-- Creating with the payment
-- ---------------------------------------------------------
select set_config('core.pay_'||k,core_test.as_actor(40,format(
 $s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(%s),
   p_customer_name=>%L,p_customer_phone=>%L,p_delivery_address=>%L,
   p_payment_method=>%L,p_amount_due_cents=>%s,p_change_for_cents=>%s)$s$,
 8800+n,'Cliente '||k,'119555520'||lpad(n::text,2,'0'),'Rua Paga '||n,m,a,c))->>'orderId',false)
 from (values ('paid',1,'PAID','null','null'),('cash',2,'CASH','5290','10000'),
  ('card',3,'CARD','4500','null'),('pix',4,'PIX','3000','null')) v(k,n,m,a,c);
select set_config('core.pay_none',core_test.as_actor(40,format(
 $s$select public.create_order(core_test.id(105),core_test.id(8805),'Sem Info','11955552005','Rua Antiga 5')$s$))->>'orderId',false);

select core_test.check('each order keeps how the customer pays',
 (select payment_method='PAID' and amount_due_cents is null and change_for_cents is null
   from public.orders where id=core_test.s('pay_paid'))
 and (select payment_method='CASH' and amount_due_cents=5290 and change_for_cents=10000
   from public.orders where id=core_test.s('pay_cash'))
 and (select payment_method='CARD' and amount_due_cents=4500 and change_for_cents is null
   from public.orders where id=core_test.s('pay_card'))
 and (select payment_method='PIX' and amount_due_cents=3000 from public.orders where id=core_test.s('pay_pix')));
select core_test.check('a panel without this version still creates orders, with no payment',
 (select payment_method is null and amount_due_cents is null from public.orders where id=core_test.s('pay_none')));

select core_test.check('a replay answers the saved order and does not change its payment',
 (core_test.as_actor(40,format($s$select public.create_order(p_restaurant_id=>core_test.id(105),
   p_request_id=>core_test.id(8802),p_customer_name=>'Cliente cash',p_customer_phone=>'11955552002',
   p_delivery_address=>'Rua Paga 2',p_payment_method=>'PAID')$s$))->>'created')::boolean = false
 and (select payment_method='CASH' and amount_due_cents=5290 from public.orders where id=core_test.s('pay_cash')));

-- ---------------------------------------------------------
-- What is refused (and nothing is created)
-- ---------------------------------------------------------
select core_test.check('payments that make no sense are refused',
 core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8810),
   p_customer_name=>'X',p_customer_phone=>'11955552010',p_delivery_address=>'Rua X',p_payment_method=>'CARD')$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8811),
   p_customer_name=>'X',p_customer_phone=>'11955552011',p_delivery_address=>'Rua X',p_payment_method=>'PAID',
   p_amount_due_cents=>1000)$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8812),
   p_customer_name=>'X',p_customer_phone=>'11955552012',p_delivery_address=>'Rua X',p_payment_method=>'CARD',
   p_amount_due_cents=>1000,p_change_for_cents=>2000)$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8813),
   p_customer_name=>'X',p_customer_phone=>'11955552013',p_delivery_address=>'Rua X',p_payment_method=>'CASH',
   p_amount_due_cents=>5000,p_change_for_cents=>5000)$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8814),
   p_customer_name=>'X',p_customer_phone=>'11955552014',p_delivery_address=>'Rua X',p_payment_method=>'CASH',
   p_amount_due_cents=>0)$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8815),
   p_customer_name=>'X',p_customer_phone=>'11955552015',p_delivery_address=>'Rua X',p_payment_method=>'BOLETO',
   p_amount_due_cents=>1000)$s$)='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8816),
   p_customer_name=>'X',p_customer_phone=>'11955552016',p_delivery_address=>'Rua X',p_amount_due_cents=>1000)$s$)='22023'
 and not exists (select 1 from public.orders where client_request_id between core_test.id(8810) and core_test.id(8816)));
select core_test.check('another store is refused before the payment is even read',
 core_test.try_as(4,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8817),
   p_customer_name=>'X',p_customer_phone=>'11955552017',p_delivery_address=>'Rua X',p_payment_method=>'CARD')$s$)='42501');

do $$ begin
  begin
    update public.orders set amount_due_cents = null where id = core_test.s('pay_card');
    raise exception 'CORE CHECK FAILED: a card order lost its amount';
  exception when check_violation then null;
  end;
  begin
    update public.orders set change_for_cents = 9000 where id = core_test.s('pay_card');
    raise exception 'CORE CHECK FAILED: a card order took change';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------
-- Importing and editing
-- ---------------------------------------------------------
select set_config('core.pay_import',core_test.as_actor(40,format(
 $s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',p_external_id=>'77 · 24/11/2026',
   p_customer_name=>'Impresso',p_customer_phone=>'11955552030',p_delivery_address=>'Rua Cupom 3',
   p_payment_method=>'CARD',p_amount_due_cents=>6190)$s$,core_test.id(105)))->>'orderId',false);
select core_test.check('a printed order comes in with its payment',
 (select payment_method='CARD' and amount_due_cents=6190 and source='PRINTER'
   from public.orders where id=core_test.s('pay_import')));
select core_test.check('the same receipt again does not change the payment',
 (core_test.as_actor(40,format($s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',
   p_external_id=>'77 · 24/11/2026',p_customer_name=>'Impresso',p_customer_phone=>'11955552030',
   p_delivery_address=>'Rua Cupom 3',p_payment_method=>'PAID')$s$,core_test.id(105)))->>'created')::boolean = false
 and (select payment_method='CARD' from public.orders where id=core_test.s('pay_import')));

select core_test.as_actor(40,format($s$select public.update_order(p_restaurant_id=>core_test.id(105),p_order_id=>%L,
  p_customer_name=>'Cliente card',p_customer_phone=>'11955552003',p_delivery_address=>'Rua Paga 3',
  p_keep_location=>true,p_payment_method=>'CASH',p_amount_due_cents=>4500,p_change_for_cents=>5000)$s$,
  core_test.s('pay_card')));
select core_test.check('editing a waiting order changes how it is paid',
 (select payment_method='CASH' and amount_due_cents=4500 and change_for_cents=5000
   from public.orders where id=core_test.s('pay_card')));
select core_test.check('an invalid payment on edit changes nothing',
 core_test.try_as(40,format($s$select public.update_order(p_restaurant_id=>core_test.id(105),p_order_id=>%L,
  p_customer_name=>'Trocado',p_customer_phone=>'11955552003',p_delivery_address=>'Rua Paga 3',
  p_payment_method=>'PIX')$s$,core_test.s('pay_card')))='22023'
 and (select customer_name='Cliente card' and payment_method='CASH' from public.orders where id=core_test.s('pay_card')));

-- ---------------------------------------------------------
-- The panel and the courier see it
-- ---------------------------------------------------------
select core_test.check('the board lists the payment of each order that has one',
 (select count(*)=5 from jsonb_array_elements(core_test.board(40,105)->'orderPayments'))
 and exists (select 1 from jsonb_array_elements(core_test.board(40,105)->'orderPayments') p
   where p->>'method'='CASH' and (p->>'amountDueCents')::int=5290 and (p->>'changeForCents')::int=10000)
 and core_test.board(40,105) ? 'orderSources');

-- ---------------------------------------------------------
-- The app's contact in place of a hidden mobile (iFood: the same 0800 for every customer)
-- ---------------------------------------------------------
select set_config('core.pay_app',core_test.as_actor(40,format(
 $s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',p_external_id=>'4821 · 24/11/2026',
   p_source_app=>'iFood',p_customer_name=>'Cliente iFood',p_customer_phone=>null,p_delivery_address=>'Rua do App 7',
   p_customer_contact=>'0800 718 2283 · ID 12345678',p_payment_method=>'PAID')$s$,core_test.id(105)))->>'orderId',false);
select core_test.check('a printed order with only the app''s contact is saved, with no mobile',
 (select customer_phone is null and customer_contact='0800 718 2283 · ID 12345678' and source='PRINTER'
   from public.orders where id=core_test.s('pay_app')));
select core_test.check('the 0800 is never taken as the mobile, and the panel still needs the mobile',
 core_test.try_as(40,format($s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',p_external_id=>'4822',
   p_customer_name=>'X',p_customer_phone=>'0800 718 2283',p_delivery_address=>'Rua X',
   p_customer_contact=>'0800 718 2283 · ID 1')$s$,core_test.id(105)))='22023'
 and core_test.try_as(40,format($s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',p_external_id=>'4823',
   p_customer_name=>'X',p_customer_phone=>null,p_delivery_address=>'Rua X')$s$,core_test.id(105)))='22023'
 and core_test.try_as(40,format($s$select public.import_order(p_restaurant_id=>%L,p_source=>'PRINTER',p_external_id=>'4824',
   p_customer_name=>'X',p_customer_phone=>null,p_delivery_address=>'Rua X',p_customer_contact=>%L)$s$,
   core_test.id(105),repeat('9',81)))='22023'
 and core_test.try_as(40,$s$select public.create_order(p_restaurant_id=>core_test.id(105),p_request_id=>core_test.id(8830),
   p_customer_name=>'X',p_customer_phone=>null,p_delivery_address=>'Rua X',p_payment_method=>'PAID')$s$)='22023'
 and not exists (select 1 from public.orders where external_id in ('4822','4823','4824') or client_request_id=core_test.id(8830)));
select core_test.as_actor(40,format($s$select public.update_order(p_restaurant_id=>core_test.id(105),p_order_id=>%L,
  p_customer_name=>'Cliente iFood Editado',p_customer_phone=>null,p_delivery_address=>'Rua do App 7',
  p_payment_method=>'PAID')$s$,core_test.s('pay_app')));
select core_test.check('editing it keeps the contact, and a mobile may be added later',
 (select customer_name='Cliente iFood Editado' and customer_phone is null and customer_contact is not null
   from public.orders where id=core_test.s('pay_app'))
 and core_test.try_as(40,format($s$select public.update_order(p_restaurant_id=>core_test.id(105),p_order_id=>%L,
  p_customer_name=>'Sem contato',p_customer_phone=>null,p_delivery_address=>'Rua Paga 3')$s$,core_test.s('pay_card')))='22023');
select core_test.check('the board says the app''s contact; the order has no phone there',
 exists (select 1 from jsonb_array_elements(core_test.board(40,105)->'customerContacts') c
   where c->>'contact'='0800 718 2283 · ID 12345678')
 and (select o->'phone' from jsonb_array_elements(core_test.board(40,105)->'orders') o
   where o->>'customer'='Cliente iFood Editado') = 'null'::jsonb);
do $$ begin
  begin
    update public.orders set customer_contact = null where id = core_test.s('pay_app');
    raise exception 'CORE CHECK FAILED: an order kept no way to reach the customer';
  exception when check_violation then null;
  end;
end $$;

select set_config('core.pay_shift',core_test.as_actor(41,$s$select public.request_shift(core_test.id(105))$s$)->>'shiftId',false);
select core_test.as_actor(40,format($s$select to_jsonb(public.review_shift(core_test.id(105),%L,true))$s$,core_test.s('pay_shift')));
select set_config('core.pay_stops',(select string_agg(d.id::text,',' order by o.client_request_id)
 from public.deliveries d join public.orders o on o.id=d.order_id
 where o.id in (core_test.s('pay_paid'),core_test.s('pay_cash'),core_test.s('pay_pix'),core_test.s('pay_none')))
 || ',' || (select d.id::text from public.deliveries d where d.order_id=core_test.s('pay_app')),false);
select set_config('core.pay_route',core_test.as_actor(40,format(
 $s$select public.create_route(core_test.id(105),core_test.id(8820),%L,string_to_array(%L,',')::uuid[])$s$,
 core_test.s('pay_shift'),current_setting('core.pay_stops')))->>'routeId',false);
select set_config('core.pay_courier',core_test.as_actor(41,$s$select public.get_courier_route()$s$)::text,false);
select core_test.check('the courier reads what to collect at each stop',
 (select array_agg(coalesce(s->'payment'->>'method','none') || ':' || coalesce(s->'payment'->>'amountDueCents','-')
     || ':' || coalesce(s->'payment'->>'changeForCents','-') order by (s->>'sequence')::int)
   from jsonb_array_elements(current_setting('core.pay_courier')::jsonb->'stops') s)
 = array['PAID:-:-','CASH:5290:10000','PIX:3000:-','none:-:-','PAID:-:-']);
select core_test.check('and never the customer phone nor the app''s contact',
 position('9555520' in current_setting('core.pay_courier'))=0
 and position('0800' in current_setting('core.pay_courier'))=0);

-- Starting the route queues WhatsApp to the customers with a mobile only, and never fails for the others.
select core_test.as_actor(40,format($s$select public.release_route_pickup(core_test.id(105),%L,1)$s$,core_test.s('pay_route')));
select core_test.as_actor(41,format($s$select public.start_route(%L,1)$s$,core_test.s('pay_route')));
select core_test.check('the route starts with the app''s contact order on it; no WhatsApp for it',
 (select status='ON_ROUTE' from public.routes where id=core_test.s('pay_route'))
 and (select count(*)=4 from public.delivery_notifications n join public.deliveries d on d.id=n.delivery_id
   join public.orders o on o.id=d.order_id where o.restaurant_id=core_test.id(105) and n.type='TRACKING_LINK')
 and not exists (select 1 from public.delivery_notifications n join public.deliveries d on d.id=n.delivery_id
   where d.order_id=core_test.s('pay_app')));

select core_test.check('payment and contact helpers are not callable from the API',
 not exists (select 1 from (values ('private.check_order_payment(text,integer,integer)'),
  ('private.order_phone(text,text)'),
  ('private.create_order_core(uuid,uuid,text,text,text,text,text,text,text,double precision,double precision,text,text,timestamptz,integer,text,integer,integer,text)'),
  ('private.operations_board_sources(uuid)')) f(sig), (values ('anon'),('authenticated')) r(role)
  where has_function_privilege(r.role,f.sig,'EXECUTE'))
 and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('create_order','import_order','update_order')
    and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
      or has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE')))
 and (select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_order'));
