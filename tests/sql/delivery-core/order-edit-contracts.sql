-- Contracts for editing an order that still waits for dispatch (update_order).
-- Runs after distance-contracts.sql: store C (103), owner 19, operator 20, courier F (21),
-- core_test.raised. Each value is re-read here: the PostgreSQL runner uses one session per file.
select set_config('core.edit_order',(core_test.as_actor(20,$s$select public.create_order(core_test.id(103),
 '00000000-0000-4000-9000-000000000901','Cliente Edit','11987650001','Rua Antiga 10',
 p_neighborhood=>'Centro',p_latitude=>-23.0101,p_longitude=>-46.8401,
 p_address_provider=>'mapbox',p_address_provider_id=>'addr_edit_1')$s$))->>'orderId',false);

select core_test.check('a courier cannot edit an order',
 core_test.raised(21,format($s$select public.update_order(core_test.id(103),%L,'X','11987650001','Rua 1')$s$,
  current_setting('core.edit_order')))='RPM_MEMBER_REQUIRED');
select core_test.check('another store cannot edit it',
 core_test.raised(4,format($s$select public.update_order(core_test.id(103),%L,'X','11987650001','Rua 1')$s$,
  current_setting('core.edit_order')))='RPM_MEMBER_REQUIRED');
select core_test.check('an order of another store is not found',
 core_test.raised(20,format($s$select public.update_order(core_test.id(103),%L,'X','11987650001','Rua 1')$s$,
  core_test.id(999)))='RPM_ORDER_NOT_FOUND');
select core_test.check('an invalid phone is refused',
 core_test.raised(20,format($s$select public.update_order(core_test.id(103),%L,'X','123','Rua 1')$s$,
  current_setting('core.edit_order')))='RPM_ORDER_FIELDS');
select core_test.check('a blank address is refused',
 core_test.raised(20,format($s$select public.update_order(core_test.id(103),%L,'X','11987650001','  ')$s$,
  current_setting('core.edit_order')))='RPM_ORDER_FIELDS');

-- Same address: name, phone, notes and promise change; the confirmed pin stays.
select core_test.as_actor(20,format($s$select public.update_order(core_test.id(103),%L,' Cliente Nova ','(11) 98765-0002',
 'Rua Antiga 10',p_neighborhood=>'Centro',p_notes=>'Portão azul',p_promised_minutes=>45,p_keep_location=>true)$s$,
 current_setting('core.edit_order')));
select core_test.check('the store edits a waiting order and keeps its pin',
 (select customer_name='Cliente Nova' and customer_phone='+5511987650002' and notes='Portão azul'
   and promised_minutes=45 and latitude=-23.0101 and address_provider_id='addr_edit_1'
  from public.orders where id=current_setting('core.edit_order')::uuid));

-- A new address typed only: the old pin goes, it is not carried to another street.
select core_test.as_actor(20,format($s$select public.update_order(core_test.id(103),%L,'Cliente Nova','11987650002',
 'Rua Nova 20',p_neighborhood=>'Jardim')$s$,current_setting('core.edit_order')));
select core_test.check('a new typed address drops the old pin',
 (select delivery_address='Rua Nova 20' and neighborhood='Jardim' and latitude is null and address_provider is null
  from public.orders where id=current_setting('core.edit_order')::uuid));

-- A new address picked from the search brings its own pin.
select core_test.as_actor(20,format($s$select public.update_order(core_test.id(103),%L,'Cliente Nova','11987650002',
 'Rua Nova 20',p_latitude=>-23.0120,p_longitude=>-46.8420,p_address_provider=>'mapbox',p_address_provider_id=>'addr_edit_2')$s$,
 current_setting('core.edit_order')));
select core_test.check('a picked address sets the new pin',
 (select latitude=-23.0120 and longitude=-46.8420 and address_provider_id='addr_edit_2'
  from public.orders where id=current_setting('core.edit_order')::uuid));

-- In a route it is fixed (the delivery left WAITING).
update public.deliveries set status='ASSIGNED' where order_id=current_setting('core.edit_order')::uuid;
select core_test.check('an order in a route cannot be edited',
 core_test.raised(20,format($s$select public.update_order(core_test.id(103),%L,'X','11987650001','Rua 1')$s$,
  current_setting('core.edit_order')))='RPM_ORDER_NOT_EDITABLE');
update public.deliveries set status='WAITING' where order_id=current_setting('core.edit_order')::uuid;

select core_test.check('only signed-in users reach the edit command',
 has_function_privilege('authenticated','public.update_order(uuid,uuid,text,text,text,text,text,text,text,double precision,double precision,text,text,timestamptz,integer,boolean,text,integer,integer)','EXECUTE')
 and not has_function_privilege('anon','public.update_order(uuid,uuid,text,text,text,text,text,text,text,double precision,double precision,text,text,timestamptz,integer,boolean,text,integer,integer)','EXECUTE'));
