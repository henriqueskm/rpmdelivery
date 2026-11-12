-- Contracts for RPM-CORE-001. Actor identity always comes from auth.uid().
-- Values that cross statements are kept in custom settings (core.*).

-- ---------------------------------------------------------
-- Orders: owner A
-- ---------------------------------------------------------
select core_test.act(1);
set role authenticated;
do $$declare v jsonb; r jsonb; o record;begin
 v:=public.create_order(core_test.id(101),core_test.id(9001),' Cliente Um ','(11) 99999-8888',
   'Rua Fictícia, 10',p_neighborhood=>'Centro',p_latitude=>-23.5,p_longitude=>-46.6,
   p_address_provider=>'mapbox',p_address_provider_id=>'abc_123');
 perform core_test.check('order created',(v->>'created')::boolean);
 perform set_config('core.order_a',v->>'orderId',false);
 select ord.customer_name,ord.customer_phone,ord.status,ord.promised_minutes,ord.created_by,
   ord.ordered_at,d.status dstatus,d.id did into o
   from public.orders ord join public.deliveries d on d.order_id=ord.id where ord.id=(v->>'orderId')::uuid;
 perform core_test.check('name trimmed, phone normalized',o.customer_name='Cliente Um' and o.customer_phone='+5511999998888');
 perform core_test.check('order OPEN, delivery WAITING',o.status='OPEN' and o.dstatus='WAITING' and o.did=(v->>'deliveryId')::uuid);
 perform core_test.check('restaurant default promise used',o.promised_minutes=60);
 perform core_test.check('actor recorded from auth.uid()',o.created_by=core_test.id(1) and o.ordered_at is not null);
 r:=public.create_order(core_test.id(101),core_test.id(9001),'Outro nome','11988887777','Outro endereço');
 perform core_test.check('replay returns same ids without creating',not (r->>'created')::boolean
   and r->>'orderId'=v->>'orderId' and r->>'deliveryId'=v->>'deliveryId');
 perform core_test.check('replay did not duplicate',(select count(*) from public.orders where client_request_id=core_test.id(9001))=1);
 v:=public.create_order(core_test.id(101),core_test.id(9002),'Cliente Dois','+55 11 3333-4444','Rua B',
   p_ordered_at=>clock_timestamp()-interval '30 minutes',p_promised_minutes=>90);
 perform core_test.check('landline accepted, overrides kept',
   (select customer_phone='+551133334444' and promised_minutes=90 and ordered_at<clock_timestamp()-interval '29 minutes'
    from public.orders where id=(v->>'orderId')::uuid));
end;$$;
select core_test.expect('request id required',
 $s$select public.create_order(core_test.id(101),null,'A','11999998888','Rua')$s$,'22023');
select core_test.expect('empty name rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'   ','11999998888','Rua')$s$,'22023');
select core_test.expect('invalid phone rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','12345','Rua')$s$,'22023');
select core_test.expect('empty address rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','')$s$,'22023');
select core_test.expect('half coordinate rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_latitude=>-23.5)$s$,'22023');
select core_test.expect('out of range coordinate rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_latitude=>-123.5,p_longitude=>1)$s$,'22023');
select core_test.expect('provider without coordinates rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_address_provider=>'mapbox',p_address_provider_id=>'x')$s$,'22023');
select core_test.expect('future order time rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_ordered_at=>clock_timestamp()+interval '1 hour')$s$,'22023');
select core_test.expect('order older than 24h rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_ordered_at=>clock_timestamp()-interval '25 hours')$s$,'22023');
select core_test.expect('promise out of range rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_promised_minutes=>0)$s$,'22023');
select core_test.expect('oversized notes rejected',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua',p_notes=>repeat('x',501))$s$,'22023');
select core_test.expect('cannot create in another restaurant',
 $s$select public.create_order(core_test.id(102),gen_random_uuid(),'A','11999998888','Rua')$s$,'42501');
select core_test.expect('direct order insert blocked',
 $s$insert into public.orders(restaurant_id,customer_name,customer_phone,delivery_address) values(core_test.id(101),'x','x','x')$s$,'42501');
select core_test.expect('direct delivery update blocked',
 $s$update public.deliveries set status='DELIVERED'$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- Orders: operator, inactive member, other restaurant
-- ---------------------------------------------------------
select core_test.act(2);
set role authenticated;
do $$declare v jsonb;begin
 v:=public.create_order(core_test.id(101),core_test.id(9003),'Cliente Três','11977776666','Rua C');
 perform set_config('core.order_c',v->>'orderId',false);
 perform core_test.check('operator creates orders',(v->>'created')::boolean);
 perform core_test.check('operator cancels waiting order',
   public.cancel_order(core_test.id(101),(v->>'orderId')::uuid)='CANCELLED');
 perform core_test.check('cancel retry is success',
   public.cancel_order(core_test.id(101),(v->>'orderId')::uuid)='CANCELLED');
 perform core_test.check('order and delivery both cancelled',
   (select o.status='CANCELLED' and d.status='CANCELLED' and d.cancelled_at is not null
    from public.orders o join public.deliveries d on d.order_id=o.id where o.id=(v->>'orderId')::uuid));
end;$$;
select core_test.expect('cancel unknown order',
 $s$select public.cancel_order(core_test.id(101),gen_random_uuid())$s$,'P0002');
reset role;

select core_test.act(3);
set role authenticated;
select core_test.expect('inactive member cannot create',
 $s$select public.create_order(core_test.id(101),gen_random_uuid(),'A','11999998888','Rua')$s$,'42501');
reset role;

select core_test.act(4);
set role authenticated;
select core_test.check('other restaurant sees no foreign orders',
 (select count(*) from public.orders where restaurant_id=core_test.id(101))=0);
select core_test.expect('cannot cancel foreign order through own restaurant',
 format('select public.cancel_order(core_test.id(102),%L::uuid)',current_setting('core.order_a')),'P0002');
select core_test.expect('cannot cancel foreign order through foreign restaurant',
 format('select public.cancel_order(core_test.id(101),%L::uuid)',current_setting('core.order_a')),'42501');
do $$declare v jsonb;begin
 v:=public.create_order(core_test.id(102),core_test.id(9004),'Cliente B','11966665555','Rua D');
 perform core_test.check('restaurant B default promise used',
   (select promised_minutes=45 from public.orders where id=(v->>'orderId')::uuid));
 perform core_test.check('same request id is scoped per restaurant',
   (public.create_order(core_test.id(102),core_test.id(9001),'Cliente B2','11966665555','Rua E')->>'created')::boolean);
end;$$;
reset role;

-- Delivery already in a route cannot be cancelled by cancel_order.
update public.deliveries set status='ASSIGNED'
 where order_id=current_setting('core.order_a')::uuid;
select core_test.act(1);
set role authenticated;
select core_test.expect('assigned delivery not cancellable here',
 format('select public.cancel_order(core_test.id(101),%L::uuid)',current_setting('core.order_a')),'55000');
reset role;

-- ---------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------
select core_test.act(5);
set role authenticated;
do $$declare v jsonb; r jsonb;begin
 v:=public.request_shift(core_test.id(101));
 perform core_test.check('courier requests shift as PENDING',(v->>'created')::boolean and v->>'status'='PENDING');
 perform set_config('core.shift_x',v->>'shiftId',false);
 r:=public.request_shift(core_test.id(101));
 perform core_test.check('repeat request returns same shift',not (r->>'created')::boolean and r->>'shiftId'=v->>'shiftId');
end;$$;
select core_test.expect('open shift blocks another store',
 $s$select public.request_shift(core_test.id(102))$s$,'55000');
select core_test.expect('courier cannot review shifts',
 format('select public.review_shift(core_test.id(101),%L::uuid,true)',current_setting('core.shift_x')),'42501');
select core_test.check('courier sees own shift',
 (select count(*)=1 from public.courier_shifts where id=current_setting('core.shift_x')::uuid));
select core_test.check('courier with shift sees no orders',(select count(*) from public.orders)=0);
select core_test.expect('direct shift update blocked',
 $s$update public.courier_shifts set status='AVAILABLE'$s$,'42501');
reset role;

select core_test.act(6);
set role authenticated;
select core_test.expect('pending link cannot request shift',
 $s$select public.request_shift(core_test.id(101))$s$,'42501');
reset role;
select core_test.act(7);
set role authenticated;
select core_test.expect('incomplete registration cannot request shift',
 $s$select public.request_shift(core_test.id(101))$s$,'22023');
reset role;
select core_test.act(8);
set role authenticated;
select core_test.expect('non courier cannot request shift',
 $s$select public.request_shift(core_test.id(101))$s$,'42501');
select core_test.expect('outsider cannot end shift',
 format('select public.end_shift(%L::uuid)',current_setting('core.shift_x')),'P0002');
reset role;

select core_test.act(4);
set role authenticated;
select core_test.expect('other store cannot review through own id',
 format('select public.review_shift(core_test.id(102),%L::uuid,true)',current_setting('core.shift_x')),'P0002');
select core_test.expect('other store cannot review through foreign id',
 format('select public.review_shift(core_test.id(101),%L::uuid,true)',current_setting('core.shift_x')),'42501');
reset role;

select core_test.act(2);
set role authenticated;
select core_test.expect('decision required',
 format('select public.review_shift(core_test.id(101),%L::uuid,null)',current_setting('core.shift_x')),'22023');
select core_test.check('operator approves shift',
 public.review_shift(core_test.id(101),current_setting('core.shift_x')::uuid,true)='AVAILABLE');
select core_test.check('approval retry is success',
 public.review_shift(core_test.id(101),current_setting('core.shift_x')::uuid,true)='AVAILABLE');
select core_test.expect('cannot reject an approved shift',
 format('select public.review_shift(core_test.id(101),%L::uuid,false)',current_setting('core.shift_x')),'55000');
select core_test.check('approval enters the queue',
 (select status='AVAILABLE' and started_at is not null and available_since=started_at
   and approved_by=core_test.id(2) from public.courier_shifts where id=current_setting('core.shift_x')::uuid));
reset role;

-- A reserved (PREPARING) route keeps the shift busy.
insert into public.routes(id,restaurant_id,courier_id,courier_shift_id)
 values(core_test.id(501),core_test.id(101),core_test.id(205),current_setting('core.shift_x')::uuid);
select core_test.act(5);
set role authenticated;
select core_test.expect('cannot end shift with reserved route',
 format('select public.end_shift(%L::uuid)',current_setting('core.shift_x')),'55000');
reset role;
update public.routes set status='CANCELLED' where id=core_test.id(501);
update public.courier_shifts set status='ON_ROUTE' where id=current_setting('core.shift_x')::uuid;
select core_test.act(5);
set role authenticated;
select core_test.expect('cannot end shift on route',
 format('select public.end_shift(%L::uuid)',current_setting('core.shift_x')),'55000');
reset role;
update public.courier_shifts set status='AVAILABLE' where id=current_setting('core.shift_x')::uuid;

select core_test.act(5);
set role authenticated;
select core_test.check('courier ends own shift',public.end_shift(current_setting('core.shift_x')::uuid)='ENDED');
select core_test.check('end retry is success',public.end_shift(current_setting('core.shift_x')::uuid)='ENDED');
do $$declare v jsonb;begin
 v:=public.request_shift(core_test.id(102));
 perform core_test.check('after ending, can request in other store',v->>'status'='PENDING' and (v->>'created')::boolean);
 perform set_config('core.shift_x2',v->>'shiftId',false);
end;$$;
reset role;

select core_test.act(4);
set role authenticated;
select core_test.check('store rejects shift',
 public.review_shift(core_test.id(102),current_setting('core.shift_x2')::uuid,false)='REJECTED');
select core_test.expect('cannot approve a rejected shift',
 format('select public.review_shift(core_test.id(102),%L::uuid,true)',current_setting('core.shift_x2')),'55000');
reset role;

select core_test.act(9);
set role authenticated;
select set_config('core.shift_w',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
select core_test.act(1);
set role authenticated;
select public.review_shift(core_test.id(101),current_setting('core.shift_w')::uuid,true);
select core_test.check('store ends shift administratively',
 public.end_shift(current_setting('core.shift_w')::uuid)='ENDED');
select core_test.check('ended_by records the store actor',
 (select ended_by=core_test.id(1) from public.courier_shifts where id=current_setting('core.shift_w')::uuid));
reset role;

-- Link suspended between request and approval blocks the approval.
select core_test.act(9);
set role authenticated;
select set_config('core.shift_w2',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
update public.restaurant_couriers set status='SUSPENDED' where id=core_test.id(309);
select core_test.act(1);
set role authenticated;
select core_test.expect('suspended link cannot be approved',
 format('select public.review_shift(core_test.id(101),%L::uuid,true)',current_setting('core.shift_w2')),'55000');
reset role;

-- ---------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------
select core_test.check('anon cannot execute any new command', not exists (
 select 1 from (values
  ('public.create_order(uuid,uuid,text,text,text,text,text,text,text,double precision,double precision,text,text,timestamptz,integer)'),
  ('public.cancel_order(uuid,uuid)'),('public.request_shift(uuid)'),
  ('public.review_shift(uuid,uuid,boolean)'),('public.end_shift(uuid)')) f(sig)
 where has_function_privilege('anon',f.sig,'EXECUTE') or not has_function_privilege('authenticated',f.sig,'EXECUTE')));
select core_test.check('private helpers not executable by API roles', not exists (
 select 1 from (values ('private.require_restaurant_member(uuid)'),('private.clean_text(text)'),
  ('private.normalize_br_phone(text)')) f(sig), (values ('anon'),('authenticated')) r(role)
 where has_function_privilege(r.role,f.sig,'EXECUTE')));
select core_test.check('commands are security definer with empty search_path', not exists (
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_order','cancel_order','request_shift','review_shift','end_shift')
   and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])));
select core_test.check('no write privileges granted on operational tables', not exists (
 select 1 from (values ('public.orders'),('public.deliveries'),('public.courier_shifts'),('public.routes')) t(tbl),
  (values ('INSERT'),('UPDATE'),('DELETE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,t.tbl,p.priv)));
