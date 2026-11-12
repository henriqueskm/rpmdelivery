-- Contracts for RPM-CORE-002 (route composition). Runs after contracts.sql.
create function core_test.s(k text) returns uuid language sql stable as $$
 select current_setting('core.'||k)::uuid
$$;
grant execute on function core_test.s(text) to anon,authenticated;
-- Session settings do not survive between psql files: re-derive the shifts
-- left by contracts.sql (W pending in A; X rejected in B).
select set_config('core.shift_w2',(select id::text from public.courier_shifts
 where courier_id=core_test.id(209) and status='PENDING'),false);
select set_config('core.shift_x2',(select id::text from public.courier_shifts
 where courier_id=core_test.id(205) and restaurant_id=core_test.id(102) and status='REJECTED'),false);

-- ---------------------------------------------------------
-- Setup through the real commands: two approved couriers, four orders.
-- ---------------------------------------------------------
select core_test.act(5);
set role authenticated;
select set_config('core.shift_x3',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
select core_test.act(13);
set role authenticated;
select set_config('core.shift_r',public.request_shift(core_test.id(101))->>'shiftId',false);
reset role;
select core_test.act(1);
set role authenticated;
select public.review_shift(core_test.id(101),core_test.s('shift_x3'),true);
select public.review_shift(core_test.id(101),core_test.s('shift_r'),true);
do $$declare n integer;begin
 for n in 1..4 loop
  perform set_config('core.d'||n,
   public.create_order(core_test.id(101),core_test.id(9100+n),'Cliente '||n,'1199999000'||n,'Rua '||n)->>'deliveryId',false);
 end loop;
end;$$;

-- ---------------------------------------------------------
-- create_route
-- ---------------------------------------------------------
do $$declare v jsonb; r jsonb;begin
 v:=public.create_route(core_test.id(101),core_test.id(9201),core_test.s('shift_x3'),
   array[core_test.s('d1'),core_test.s('d2')]);
 perform core_test.check('route created PREPARING at version 1',
   (v->>'created')::boolean and v->>'status'='PREPARING' and (v->>'version')::int=1 and v->>'pickupReleasedAt' is null);
 perform set_config('core.route_x',v->>'routeId',false);
 perform core_test.check('array order is the planned sequence',
   (select array_agg(delivery_id order by sequence)=array[core_test.s('d1'),core_test.s('d2')]
    from public.route_deliveries where route_id=(v->>'routeId')::uuid));
 perform core_test.check('deliveries ASSIGNED with assigned_at',
   (select bool_and(status='ASSIGNED' and assigned_at is not null) from public.deliveries
    where id in (core_test.s('d1'),core_test.s('d2'))));
 perform core_test.check('route records actor and courier from the shift',
   (select created_by=core_test.id(1) and courier_id=core_test.id(205) from public.routes where id=(v->>'routeId')::uuid));
 r:=public.create_route(core_test.id(101),core_test.id(9201),core_test.s('shift_x3'),array[core_test.s('d3')]);
 perform core_test.check('replay returns the same route',not (r->>'created')::boolean and r->>'routeId'=v->>'routeId');
end;$$;
select core_test.expect('delivery already in a route is unavailable',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array[core_test.s('d2')])$s$,'55000');
select core_test.expect('courier with a reserved route is busy',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_x3'),array[core_test.s('d3')])$s$,'55000');
select core_test.expect('empty route rejected',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),'{}'::uuid[])$s$,'22023');
select core_test.expect('duplicate delivery rejected',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array[core_test.s('d3'),core_test.s('d3')])$s$,'22023');
select core_test.expect('null delivery rejected',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array[core_test.s('d3'),null])$s$,'22023');
select core_test.expect('more than 30 deliveries rejected',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array(select gen_random_uuid() from generate_series(1,31)))$s$,'22023');
select core_test.expect('unknown delivery unavailable',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array[gen_random_uuid()])$s$,'55000');
select core_test.expect('request id required for routes',
 $s$select public.create_route(core_test.id(101),null,core_test.s('shift_r'),array[core_test.s('d3')])$s$,'22023');
select core_test.expect('pending shift cannot receive a route',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_w2'),array[core_test.s('d3')])$s$,'55000');
select core_test.expect('shift of another store is not found',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_x2'),array[core_test.s('d3')])$s$,'P0002');
select core_test.expect('direct route insert blocked',
 $s$insert into public.routes(restaurant_id,courier_id,courier_shift_id) values(core_test.id(101),core_test.id(213),core_test.s('shift_r'))$s$,'42501');
reset role;

select core_test.act(5);
set role authenticated;
select core_test.check('courier sees reserved route and its orders',
 (select count(*)=1 from public.routes where id=core_test.s('route_x'))
 and (select count(*)=2 from public.orders));
select core_test.expect('courier cannot create routes',
 $s$select public.create_route(core_test.id(101),gen_random_uuid(),core_test.s('shift_r'),array[core_test.s('d3')])$s$,'42501');
select core_test.expect('courier cannot end shift with reserved route',
 $s$select public.end_shift(core_test.s('shift_x3'))$s$,'55000');
reset role;

-- ---------------------------------------------------------
-- Composition, versions and pickup release (operator)
-- ---------------------------------------------------------
select core_test.act(2);
set role authenticated;
do $$declare v jsonb; t timestamptz;begin
 v:=public.update_route_composition(core_test.id(101),core_test.s('route_x'),1,array[core_test.s('d2'),core_test.s('d1')]);
 perform core_test.check('reorder bumps version',(v->>'changed')::boolean and (v->>'version')::int=2);
 perform core_test.check('reorder updates sequence',
   (select array_agg(delivery_id order by sequence)=array[core_test.s('d2'),core_test.s('d1')]
    from public.route_deliveries where route_id=core_test.s('route_x')));
 begin perform public.release_route_pickup(core_test.id(101),core_test.s('route_x'),1);
  raise exception 'stale release accepted'; exception when sqlstate '55000' then null; end;
 perform core_test.check('stale release refused',true);
 v:=public.release_route_pickup(core_test.id(101),core_test.s('route_x'),2);
 t:=(v->>'pickupReleasedAt')::timestamptz;
 perform core_test.check('release sets timestamp and actor',t is not null and
   (select pickup_released_by=core_test.id(2) from public.routes where id=core_test.s('route_x')));
 perform core_test.check('release retry keeps original time',
   (public.release_route_pickup(core_test.id(101),core_test.s('route_x'),2)->>'pickupReleasedAt')::timestamptz=t);
 v:=public.update_route_composition(core_test.id(101),core_test.s('route_x'),2,array[core_test.s('d1'),core_test.s('d2')]);
 perform core_test.check('reorder keeps the release',(v->>'version')::int=3 and (v->>'pickupReleasedAt')::timestamptz=t);
 v:=public.update_route_composition(core_test.id(101),core_test.s('route_x'),3,array[core_test.s('d1'),core_test.s('d3')]);
 perform core_test.check('changing the set clears the release',(v->>'version')::int=4 and v->>'pickupReleasedAt' is null
   and (select pickup_released_by is null from public.routes where id=core_test.s('route_x')));
 perform core_test.check('removed delivery back to WAITING',
   (select status='WAITING' and assigned_at is null from public.deliveries where id=core_test.s('d2')));
 perform core_test.check('added delivery ASSIGNED',
   (select status='ASSIGNED' from public.deliveries where id=core_test.s('d3')));
 v:=public.update_route_composition(core_test.id(101),core_test.s('route_x'),4,array[core_test.s('d1'),core_test.s('d3')]);
 perform core_test.check('identical list is a no-op',not (v->>'changed')::boolean and (v->>'version')::int=4);
end;$$;
select core_test.expect('stale composition refused',
 $s$select public.update_route_composition(core_test.id(101),core_test.s('route_x'),3,array[core_test.s('d1')])$s$,'55000');
select core_test.expect('empty composition refused (use cancel_route)',
 $s$select public.update_route_composition(core_test.id(101),core_test.s('route_x'),4,'{}'::uuid[])$s$,'22023');
do $$begin
 perform set_config('core.route_r',
  public.create_route(core_test.id(101),core_test.id(9202),core_test.s('shift_r'),array[core_test.s('d4')])->>'routeId',false);
end;$$;
select core_test.expect('cannot add a delivery from another route',
 $s$select public.update_route_composition(core_test.id(101),core_test.s('route_x'),4,array[core_test.s('d1'),core_test.s('d3'),core_test.s('d4')])$s$,'55000');
select core_test.check('failed composition changed nothing',
 (select composition_version=4 from public.routes where id=core_test.s('route_x'))
 and (select count(*)=2 from public.route_deliveries where route_id=core_test.s('route_x')));
do $$declare v jsonb;begin
 perform public.release_route_pickup(core_test.id(101),core_test.s('route_x'),4);
 v:=public.revoke_route_pickup(core_test.id(101),core_test.s('route_x'));
 perform core_test.check('revoke clears the release',v->>'pickupReleasedAt' is null and (v->>'version')::int=4);
 v:=public.revoke_route_pickup(core_test.id(101),core_test.s('route_x'));
 perform core_test.check('revoke retry is success',v->>'pickupReleasedAt' is null);
end;$$;
reset role;

-- ---------------------------------------------------------
-- Isolation between stores
-- ---------------------------------------------------------
select core_test.act(4);
set role authenticated;
select core_test.expect('foreign route not found via own store',
 $s$select public.update_route_composition(core_test.id(102),core_test.s('route_x'),4,array[core_test.s('d1')])$s$,'P0002');
select core_test.expect('foreign store cannot release',
 $s$select public.release_route_pickup(core_test.id(101),core_test.s('route_x'),4)$s$,'42501');
select core_test.expect('foreign store cannot cancel',
 $s$select public.cancel_route(core_test.id(102),core_test.s('route_x'))$s$,'P0002');
select core_test.check('foreign store sees no routes of A',(select count(*) from public.routes where restaurant_id=core_test.id(101))=0);
reset role;

-- ---------------------------------------------------------
-- Cancel route
-- ---------------------------------------------------------
select core_test.act(1);
set role authenticated;
select core_test.check('cancel route',public.cancel_route(core_test.id(101),core_test.s('route_r'))='CANCELLED');
select core_test.check('cancel route retry is success',public.cancel_route(core_test.id(101),core_test.s('route_r'))='CANCELLED');
select core_test.check('cancelled route frees its delivery',
 (select status='WAITING' and assigned_at is null from public.deliveries where id=core_test.s('d4')));
select core_test.check('cancelled route keeps history and actor',
 (select count(*)=1 from public.route_deliveries where route_id=core_test.s('route_r'))
 and (select cancelled_by=core_test.id(1) and cancelled_at is not null from public.routes where id=core_test.s('route_r')));
select core_test.expect('cancelled route cannot be edited',
 $s$select public.update_route_composition(core_test.id(101),core_test.s('route_r'),1,array[core_test.s('d4')])$s$,'55000');
select core_test.expect('cancelled route cannot be released',
 $s$select public.release_route_pickup(core_test.id(101),core_test.s('route_r'),1)$s$,'55000');
select core_test.check('courier free again after cancel',
 (public.create_route(core_test.id(101),core_test.id(9203),core_test.s('shift_r'),
   array[core_test.s('d4'),core_test.s('d2')])->>'created')::boolean);
reset role;

-- ---------------------------------------------------------
-- Once ON_ROUTE, composition and release are frozen.
-- ---------------------------------------------------------
update public.routes set status='ON_ROUTE' where id=core_test.s('route_x');
select core_test.act(1);
set role authenticated;
select core_test.expect('on-route composition frozen',
 $s$select public.update_route_composition(core_test.id(101),core_test.s('route_x'),4,array[core_test.s('d3'),core_test.s('d1')])$s$,'55000');
select core_test.expect('on-route revoke refused',
 $s$select public.revoke_route_pickup(core_test.id(101),core_test.s('route_x'))$s$,'55000');
select core_test.expect('on-route cancel refused here',
 $s$select public.cancel_route(core_test.id(101),core_test.s('route_x'))$s$,'55000');
reset role;

-- ---------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------
select core_test.check('anon cannot execute route commands', not exists (
 select 1 from (values ('public.create_route(uuid,uuid,uuid,uuid[])'),
  ('public.update_route_composition(uuid,uuid,integer,uuid[])'),
  ('public.release_route_pickup(uuid,uuid,integer)'),('public.revoke_route_pickup(uuid,uuid)'),
  ('public.cancel_route(uuid,uuid)')) f(sig)
 where has_function_privilege('anon',f.sig,'EXECUTE') or not has_function_privilege('authenticated',f.sig,'EXECUTE')));
select core_test.check('route helpers not executable by API roles', not exists (
 select 1 from (values ('private.check_route_delivery_ids(uuid[])'),('private.lock_deliveries(uuid,uuid[])'),
  ('private.assign_route_deliveries(uuid,uuid,uuid[])'),('private.route_delivery_ids(uuid)'),
  ('private.route_state(public.routes)')) f(sig), (values ('anon'),('authenticated')) r(role)
 where has_function_privilege(r.role,f.sig,'EXECUTE')));
select core_test.check('route commands are security definer with empty search_path', not exists (
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_route','update_route_composition','release_route_pickup','revoke_route_pickup','cancel_route')
   and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])));
select core_test.check('no write privileges on route tables', not exists (
 select 1 from (values ('public.routes'),('public.route_deliveries')) t(tbl),
  (values ('INSERT'),('UPDATE'),('DELETE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,t.tbl,p.priv)));
