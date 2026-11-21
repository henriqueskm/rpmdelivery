-- Contracts for "Excluir minha conta" (migration 20261125120000). Runs last: courier F (21, courier
-- row 221) with shifts, routes, deliveries and GPS points from distance/outcome/push contracts, still in line
-- at store C (103); owner 19 of store C.
grant usage on schema core_test to service_role;
grant execute on all functions in schema core_test to service_role;
select set_config('core.f_deliveries',(select count(*)::text from public.delivery_attempts a
 join public.routes r on r.id=a.route_id where r.courier_id=core_test.id(221)),false);

set role service_role;
select core_test.raises('an unknown account is not found',
 $s$select public.erase_courier_account(gen_random_uuid())$s$,'RPM_ACCOUNT_NOT_FOUND');
select core_test.raises('a store''s team member is sent to the panel',
 $s$select public.erase_courier_account(core_test.id(19))$s$,'RPM_ACCOUNT_STORE_MEMBER');
select core_test.raises('not while a shift is open',
 $s$select public.erase_courier_account(core_test.id(21))$s$,'RPM_ACCOUNT_SHIFT_OPEN');
reset role;
select core_test.check('a refused erase changes nothing',
 (select name<>'Conta excluída' from public.profiles where id=core_test.id(21))
 and exists (select 1 from public.courier_locations where courier_id=core_test.id(221)));

-- The courier ends the shift (here directly), then erases the account.
update public.courier_shifts set status='ENDED', ended_at=clock_timestamp()
 where courier_id=core_test.id(221) and status not in ('ENDED','REJECTED');
set role service_role;
select core_test.check('erased', public.erase_courier_account(core_test.id(21))='{"erased": true}');
select core_test.check('running it again is harmless', public.erase_courier_account(core_test.id(21))='{"erased": true}');
reset role;

select core_test.check('the person is gone: name, phone, photo, motorcycle and position',
 (select name='Conta excluída' and phone is null and photo_url is null from public.profiles where id=core_test.id(21))
 and (select motorcycle_model is null and motorcycle_plate is null and motorcycle_color is null
   and last_latitude is null and location_updated_at is null from public.couriers where id=core_test.id(221)));
select core_test.check('every GPS point is deleted',
 not exists (select 1 from public.courier_locations where courier_id=core_test.id(221)));
select core_test.check('links end, so no store can count on the courier',
 not exists (select 1 from public.restaurant_couriers where courier_id=core_test.id(221) and status in ('ACTIVE','PENDING'))
 and exists (select 1 from public.restaurant_couriers where courier_id=core_test.id(221) and status='SUSPENDED' and suspended_at is not null));
select core_test.check('the stores keep their deliveries and amounts, without the person',
 (select count(*) from public.delivery_attempts a join public.routes r on r.id=a.route_id
   where r.courier_id=core_test.id(221))::text=current_setting('core.f_deliveries')
 and current_setting('core.f_deliveries')::int>0
 and exists (select 1 from jsonb_array_elements(core_test.as_actor(19,
   'select public.get_courier_pay(core_test.id(103),(select (min(reported_at) at time zone ''America/Sao_Paulo'')::date from public.delivery_attempts a join public.routes r on r.id=a.route_id where r.courier_id=core_test.id(221)))')->'couriers') c
   where c->>'name'='Conta excluída'));

select core_test.check('only the Edge Function (service_role) can erase; definer, empty search_path',
 not has_function_privilege('anon','public.erase_courier_account(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.erase_courier_account(uuid)','EXECUTE')
 and has_function_privilege('service_role','public.erase_courier_account(uuid)','EXECUTE')
 and (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.erase_courier_account(uuid)'::regprocedure));
