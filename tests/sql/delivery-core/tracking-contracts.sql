-- Contracts for RPM-CORE-004 (public tracking). Runs after execution-contracts.sql.
-- Re-derive what execution-contracts.sql left: W returning from route_w2.
select set_config('core.shift_w2',(select id::text from public.courier_shifts
 where courier_id=core_test.id(209) and status='RETURNING'),false);
select set_config('core.route_w2',(select id::text from public.routes
 where courier_id=core_test.id(209) and status='RETURNING'),false);
select set_config('core.e1',(select d.id::text from public.deliveries d join public.orders o on o.id=d.order_id
 where o.client_request_id=core_test.id(9301)),false);

-- The public answer, read by anon (no login). The token lookup runs as owner.
create function core_test.public_view(k text) returns jsonb language plpgsql as $$
declare v_token uuid := (select tracking_token from public.deliveries where id=core_test.s(k)); v jsonb;
begin
 set local role anon;
 v := public.get_tracking(v_token);
 reset role;
 return v;
end; $$;

-- ---------------------------------------------------------
-- Setup: W back at the store; route W3 = t1, t2 (with coordinates), t3;
-- t4 waits at the store.
-- ---------------------------------------------------------
select core_test.act(9);
set role authenticated;
select public.arrive_at_store(core_test.s('route_w2'));
reset role;
select core_test.act(1);
set role authenticated;
do $$declare n integer;begin
 for n in 1..4 loop
  perform set_config('core.t'||n,
   public.create_order(core_test.id(101),core_test.id(9700+n),'Cliente Sigiloso '||n,'1195555000'||n,'Rua Secreta '||n,
     p_latitude=>case when n=2 then -23.55 end, p_longitude=>case when n=2 then -46.63 end)->>'deliveryId',false);
 end loop;
 perform set_config('core.route_w3',public.create_route(core_test.id(101),core_test.id(9710),core_test.s('shift_w2'),
   array[core_test.s('t1'),core_test.s('t2'),core_test.s('t3')])->>'routeId',false);
end;$$;
reset role;
select core_test.check('assigned order is still preparing for the customer',
 core_test.public_view('t1')->>'status'='PREPARING' and core_test.public_view('t1')->>'startedAt' is null);
select core_test.act(1);
set role authenticated;
select public.release_route_pickup(core_test.id(101),core_test.s('route_w3'),1);
reset role;
select core_test.act(9);
set role authenticated;
select public.start_route(core_test.s('route_w3'),1);
reset role;

-- ---------------------------------------------------------
-- Status, position in line and the courier only when NEXT
-- ---------------------------------------------------------
select core_test.check('waiting order is preparing',core_test.public_view('t4')->>'status'='PREPARING');
select core_test.check('first stop is NEXT with nobody before it',
 core_test.public_view('t1')->>'status'='NEXT' and (core_test.public_view('t1')->>'stopsBefore')::int=0
 and core_test.public_view('t1')->>'startedAt' is not null);
select core_test.check('later stops know how many come first',
 (core_test.public_view('t2')->>'stopsBefore')::int=1 and (core_test.public_view('t3')->>'stopsBefore')::int=2
 and core_test.public_view('t3')->>'status'='ON_ROUTE');
select set_config('core.track_points',jsonb_build_array(jsonb_build_object(
 'latitude',-23.56,'longitude',-46.64,'recordedAt',clock_timestamp()::text))::text,false);
select core_test.act(9);
set role authenticated;
select public.record_courier_locations(core_test.s('route_w3'),current_setting('core.track_points')::jsonb);
reset role;
select core_test.check('NEXT customer sees the courier',
 (core_test.public_view('t1')->'courier'->>'latitude')::numeric=-23.56
 and core_test.public_view('t1')->'courier'->>'recordedAt' is not null);
select core_test.check('a later stop never sees the courier (it would reveal another address)',
 core_test.public_view('t2')->'courier'='null'::jsonb and core_test.public_view('t3')->'courier'='null'::jsonb
 and core_test.public_view('t2')->'destination'='null'::jsonb);

select core_test.act(9);
set role authenticated;
select public.complete_delivery(core_test.id(9801),core_test.s('route_w3'),core_test.s('t1'));
reset role;
select core_test.check('delivered customer sees the time and no courier',
 core_test.public_view('t1')->>'status'='DELIVERED' and core_test.public_view('t1')->>'deliveredAt' is not null
 and core_test.public_view('t1')->'courier'='null'::jsonb and core_test.public_view('t1')->'stopsBefore'='null'::jsonb);
select core_test.check('new NEXT sees courier and own destination',
 core_test.public_view('t2')->>'status'='NEXT' and core_test.public_view('t2')->'courier'<>'null'::jsonb
 and (core_test.public_view('t2')->'destination'->>'latitude')::numeric=-23.55
 and (core_test.public_view('t3')->>'stopsBefore')::int=1);

-- A stale point is hidden instead of showing a courier standing still.
update public.courier_locations set recorded_at=recorded_at-interval '11 minutes'
 where route_id=core_test.s('route_w3');
select core_test.check('stale position is hidden',core_test.public_view('t2')->'courier'='null'::jsonb);

-- Failure and retry.
select core_test.act(9);
set role authenticated;
select public.report_delivery_failure(core_test.id(9802),core_test.s('route_w3'),core_test.s('t2'),'OTHER','interfone quebrado');
reset role;
select core_test.check('failed attempt shows the reason, never the courier note',
 core_test.public_view('t2')->>'status'='ATTEMPT_FAILED' and core_test.public_view('t2')->>'issueReason'='OTHER'
 and position('interfone' in core_test.public_view('t2')::text)=0
 and core_test.public_view('t2')->'destination'='null'::jsonb);
select core_test.act(2);
set role authenticated;
select public.decide_delivery_failure(core_test.id(101),core_test.s('t2'),'RETRY');
reset role;
select core_test.check('retried stop goes after the remaining first attempts',
 core_test.public_view('t2')->>'status'='ON_ROUTE' and (core_test.public_view('t2')->>'stopsBefore')::int=1
 and core_test.public_view('t2')->'issueReason'='null'::jsonb
 and (core_test.public_view('t3')->>'stopsBefore')::int=0);

-- ---------------------------------------------------------
-- Privacy and expiry
-- ---------------------------------------------------------
select core_test.check('answer carries only the public fields',
 (select array_agg(k order by k) from jsonb_object_keys(core_test.public_view('t3')) k)
  =array['courier','deliveredAt','destination','issueReason','restaurantName','startedAt','status','stopsBefore']);
select core_test.check('no customer data of any stop leaks',
 not exists (select 1 from (values ('t1'),('t2'),('t3'),('t4')) t(k)
  where position('Sigiloso' in core_test.public_view(t.k)::text)>0
     or position('Secreta' in core_test.public_view(t.k)::text)>0
     or position('5555000' in core_test.public_view(t.k)::text)>0));
select core_test.check('restaurant name identifies the store',core_test.public_view('t3')->>'restaurantName'='Synthetic A');
set role anon;
select core_test.raises('unknown token',
 $s$select public.get_tracking(gen_random_uuid())$s$,'RPM_TRACKING_NOT_FOUND');
select core_test.raises('missing token',$s$select public.get_tracking(null)$s$,'RPM_TRACKING_NOT_FOUND');
select core_test.expect('anon still cannot read deliveries',$s$select count(*) from public.deliveries$s$,'42501');
select core_test.expect('anon still cannot read locations',$s$select count(*) from public.courier_locations$s$,'42501');
reset role;
-- A day after delivery the link stops answering, like an unknown token.
update public.deliveries set delivered_at=clock_timestamp()-interval '25 hours' where id=core_test.s('e1');
select set_config('core.e1_token',(select tracking_token::text from public.deliveries where id=core_test.s('e1')),false);
set role anon;
select core_test.raises('delivered link expires after 24 hours',
 $s$select public.get_tracking(current_setting('core.e1_token')::uuid)$s$,'RPM_TRACKING_NOT_FOUND');
reset role;
select core_test.check('tracking is public, definer and with an empty search_path',
 has_function_privilege('anon','public.get_tracking(uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.get_tracking(uuid)','EXECUTE')
 and (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.get_tracking(uuid)'::regprocedure));
