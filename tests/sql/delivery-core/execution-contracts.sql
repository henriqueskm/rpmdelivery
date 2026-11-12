-- Contracts for RPM-CORE-003 (route execution). Runs after route-contracts.sql.
-- Asserts the stable RPM_* code, not only the SQLSTATE.
create function core_test.raises(label text, statement text, expected text) returns void
language plpgsql security invoker set search_path='' as $$
declare actual text;
begin
 begin
  execute statement;
  actual := 'no error';
 exception when others then
  actual := sqlerrm;
 end;
 if actual is distinct from expected then
  raise exception 'CORE CHECK FAILED: % (expected %, got %)',label,expected,actual;
 end if;
 raise notice 'PASS: %',label;
end; $$;
grant execute on function core_test.raises(text,text,text) to anon,authenticated;

-- Re-derive what route-contracts.sql left: W pending in A; R with a
-- PREPARING route (d4, d2); d-series ids.
select set_config('core.shift_w2',(select id::text from public.courier_shifts
 where courier_id=core_test.id(209) and status='PENDING'),false);
select set_config('core.route_r2',(select id::text from public.routes
 where courier_id=core_test.id(213) and status='PREPARING'),false);
select set_config('core.d'||n,(select d.id::text from public.deliveries d join public.orders o on o.id=d.order_id
 where o.client_request_id=core_test.id(9100+n)),false) from generate_series(1,4) n;

-- ---------------------------------------------------------
-- Setup: W approved, five orders, route W = e1, e2, e3.
-- contracts.sql suspended W's link; the manager reactivates it.
-- ---------------------------------------------------------
update public.restaurant_couriers set status='ACTIVE' where id=core_test.id(309);
select core_test.act(1);
set role authenticated;
select public.review_shift(core_test.id(101),core_test.s('shift_w2'),true);
do $$declare n integer;begin
 for n in 1..5 loop
  perform set_config('core.e'||n,
   public.create_order(core_test.id(101),core_test.id(9300+n),'Entrega '||n,'1197777000'||n,'Rua E'||n)->>'deliveryId',false);
 end loop;
 perform set_config('core.route_w',public.create_route(core_test.id(101),core_test.id(9310),core_test.s('shift_w2'),
   array[core_test.s('e1'),core_test.s('e2'),core_test.s('e3')])->>'routeId',false);
end;$$;
reset role;

-- ---------------------------------------------------------
-- start_route
-- ---------------------------------------------------------
select core_test.act(9);
set role authenticated;
select core_test.raises('start refused before the store releases pickup',
 $s$select public.start_route(core_test.s('route_w'),1)$s$,'RPM_PICKUP_NOT_RELEASED');
reset role;
select core_test.act(13);
set role authenticated;
select core_test.raises('another courier cannot see or start the route',
 $s$select public.start_route(core_test.s('route_w'),1)$s$,'RPM_ROUTE_NOT_FOUND');
reset role;
select core_test.act(1);
set role authenticated;
select core_test.raises('store member is not a courier',
 $s$select public.start_route(core_test.s('route_w'),1)$s$,'RPM_COURIER_REQUIRED');
select core_test.check('store releases pickup',
 public.release_route_pickup(core_test.id(101),core_test.s('route_w'),1)->>'pickupReleasedAt' is not null);
reset role;
set role anon;
select core_test.expect('anon cannot start a route',
 $s$select public.start_route(core_test.s('route_w'),1)$s$,'42501');
reset role;

select core_test.act(9);
set role authenticated;
select core_test.raises('start with a composition the courier did not see',
 $s$select public.start_route(core_test.s('route_w'),0)$s$,'RPM_ROUTE_STALE');
do $$declare v jsonb; r jsonb;begin
 v:=public.start_route(core_test.s('route_w'),1);
 perform core_test.check('route started with the first stop as NEXT',
  (v->>'started')::boolean and v->>'status'='ON_ROUTE' and v->>'nextDeliveryId'=core_test.s('e1')::text);
 r:=public.start_route(core_test.s('route_w'),1);
 perform core_test.check('start retry is success without changes',
  not (r->>'started')::boolean and r->>'status'='ON_ROUTE' and r->>'nextDeliveryId'=core_test.s('e1')::text);
end;$$;
select core_test.raises('shift with a started route cannot end',
 $s$select public.end_shift(core_test.s('shift_w2'))$s$,'RPM_SHIFT_BUSY');
reset role;
select core_test.check('start moves route, shift, deliveries and orders',
 (select status='ON_ROUTE' and started_at is not null from public.routes where id=core_test.s('route_w'))
 and (select status='ON_ROUTE' from public.courier_shifts where id=core_test.s('shift_w2'))
 and (select array_agg(d.status::text order by rd.sequence)=array['NEXT','ON_ROUTE','ON_ROUTE']
   and bool_and(d.started_at is not null) and bool_and(o.status='DELIVERING')
   from public.route_deliveries rd join public.deliveries d on d.id=rd.delivery_id
   join public.orders o on o.id=d.order_id where rd.route_id=core_test.s('route_w')));
select core_test.act(1);
set role authenticated;
select core_test.raises('pickup release cannot be revoked after the start',
 $s$select public.revoke_route_pickup(core_test.id(101),core_test.s('route_w'))$s$,'RPM_ROUTE_STATE');
reset role;

-- ---------------------------------------------------------
-- complete_delivery / report_delivery_failure
-- ---------------------------------------------------------
select core_test.act(9);
set role authenticated;
select core_test.raises('only the NEXT stop can be completed',
 $s$select public.complete_delivery(gen_random_uuid(),core_test.s('route_w'),core_test.s('e2'))$s$,'RPM_DELIVERY_STATE');
select core_test.raises('completion needs a request id',
 $s$select public.complete_delivery(null,core_test.s('route_w'),core_test.s('e1'))$s$,'RPM_REQUEST_ID_REQUIRED');
select core_test.raises('delivery outside the route is not found',
 $s$select public.complete_delivery(gen_random_uuid(),core_test.s('route_w'),core_test.s('d1'))$s$,'RPM_DELIVERY_NOT_FOUND');
do $$declare v jsonb; r jsonb;begin
 v:=public.complete_delivery(core_test.id(9401),core_test.s('route_w'),core_test.s('e1'));
 perform core_test.check('delivered and the next stop advances',
  v->>'outcome'='DELIVERED' and v->>'deliveryStatus'='DELIVERED' and not (v->>'replayed')::boolean
  and v->>'nextDeliveryId'=core_test.s('e2')::text);
 r:=public.complete_delivery(core_test.id(9401),core_test.s('route_w'),core_test.s('e1'));
 perform core_test.check('completion replay changes nothing',
  (r->>'replayed')::boolean and r->>'outcome'='DELIVERED' and r->>'nextDeliveryId'=core_test.s('e2')::text);
end;$$;
select core_test.raises('unknown failure reason',
 $s$select public.report_delivery_failure(gen_random_uuid(),core_test.s('route_w'),core_test.s('e2'),'LOST')$s$,'RPM_FAILURE_FIELDS');
select core_test.raises('OTHER needs a description',
 $s$select public.report_delivery_failure(gen_random_uuid(),core_test.s('route_w'),core_test.s('e2'),'OTHER',' ab ')$s$,'RPM_FAILURE_FIELDS');
select core_test.raises('description limited to 500 characters',
 $s$select public.report_delivery_failure(gen_random_uuid(),core_test.s('route_w'),core_test.s('e2'),'OTHER',repeat('x',501))$s$,'RPM_FAILURE_FIELDS');
do $$declare v jsonb; r jsonb;begin
 v:=public.report_delivery_failure(core_test.id(9402),core_test.s('route_w'),core_test.s('e2'),'CUSTOMER_NOT_RESPONDING','  tocou 3x  ');
 perform core_test.check('failure opens an issue and the route goes on',
  v->>'outcome'='FAILED' and v->>'deliveryStatus'='ATTEMPT_FAILED' and v->>'nextDeliveryId'=core_test.s('e3')::text);
 r:=public.report_delivery_failure(core_test.id(9402),core_test.s('route_w'),core_test.s('e2'),'CUSTOMER_NOT_RESPONDING','  tocou 3x  ');
 perform core_test.check('failure replay changes nothing',(r->>'replayed')::boolean and r->>'nextDeliveryId'=core_test.s('e3')::text);
end;$$;
reset role;
select core_test.check('attempts record actor, outcome and the decision deadline',
 (select count(*)=2 from public.delivery_attempts where route_id=core_test.s('route_w'))
 and (select attempt=1 and reported_by=core_test.id(9) and reason is null
   from public.delivery_attempts where delivery_id=core_test.s('e1'))
 and (select attempt=1 and reason='CUSTOMER_NOT_RESPONDING' and notes='tocou 3x' and decision is null
   and decision_deadline=reported_at+interval '10 minutes'
   from public.delivery_attempts where delivery_id=core_test.s('e2')));
select core_test.check('delivered order and failed delivery are mirrored',
 (select d.delivered_at is not null and o.status='DELIVERED' from public.deliveries d
   join public.orders o on o.id=d.order_id where d.id=core_test.s('e1'))
 and (select issue_reason='CUSTOMER_NOT_RESPONDING' and issue_decision_deadline is not null
   from public.deliveries where id=core_test.s('e2')));

-- Reads stay isolated: the courier sees its route, the other store nothing.
select core_test.act(9);
set role authenticated;
select core_test.check('courier reads attempts of the own route',(select count(*) from public.delivery_attempts)=2);
reset role;
select core_test.act(13);
set role authenticated;
select core_test.check('another courier reads no attempts',(select count(*) from public.delivery_attempts)=0);
reset role;
select core_test.act(4);
set role authenticated;
select core_test.check('another store reads no attempts',(select count(*) from public.delivery_attempts)=0);
select core_test.raises('another store cannot decide for A',
 $s$select public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'RETRY')$s$,'RPM_MEMBER_REQUIRED');
select core_test.raises('a foreign delivery has no issue in B',
 $s$select public.decide_delivery_failure(core_test.id(102),core_test.s('e2'),'RETRY')$s$,'RPM_ISSUE_NOT_FOUND');
reset role;
set role anon;
select core_test.expect('anon cannot read attempts',$s$select count(*) from public.delivery_attempts$s$,'42501');
reset role;

-- ---------------------------------------------------------
-- decide_delivery_failure
-- ---------------------------------------------------------
select core_test.act(2);
set role authenticated;
select core_test.check('operator reads attempts of the store',(select count(*) from public.delivery_attempts where route_id=core_test.s('route_w'))=2);
select core_test.raises('unknown decision',
 $s$select public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'LATER')$s$,'RPM_DECISION_FIELDS');
do $$declare v jsonb; r jsonb;begin
 v:=public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'RETRY');
 perform core_test.check('operator decides a retry',(v->>'changed')::boolean and v->>'deliveryStatus'='ON_ROUTE');
 r:=public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'RETRY');
 perform core_test.check('same decision again is success',not (r->>'changed')::boolean and r->>'decision'='RETRY');
end;$$;
select core_test.raises('conflicting decision is refused',
 $s$select public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'RETURN')$s$,'RPM_ISSUE_CLOSED');
reset role;
select core_test.check('retry is queued without touching the planned sequence or the NEXT',
 (select retry_queued_at is not null and sequence=2 from public.route_deliveries
   where route_id=core_test.s('route_w') and delivery_id=core_test.s('e2'))
 and (select status='NEXT' from public.deliveries where id=core_test.s('e3'))
 and (select decided_by=core_test.id(2) and decided_at is not null from public.delivery_attempts
   where delivery_id=core_test.s('e2')));

-- Retry comes after the remaining first attempts. Failing the last
-- remaining stop returns it at once and the route starts returning.
select core_test.act(9);
set role authenticated;
select core_test.check('retry is the next stop after the first attempts',
 public.complete_delivery(core_test.id(9403),core_test.s('route_w'),core_test.s('e3'))->>'nextDeliveryId'=core_test.s('e2')::text);
do $$declare v jsonb;begin
 v:=public.report_delivery_failure(core_test.id(9404),core_test.s('route_w'),core_test.s('e2'),'ADDRESS_PROBLEM');
 perform core_test.check('failing the last stop returns it and the route returns',
  v->>'deliveryStatus'='RETURN_TO_STORE' and v->>'status'='RETURNING' and v->>'nextDeliveryId' is null);
end;$$;
select core_test.raises('no execution once the route is returning',
 $s$select public.complete_delivery(gen_random_uuid(),core_test.s('route_w'),core_test.s('e2'))$s$,'RPM_ROUTE_STATE');
select core_test.raises('shift still busy while returning',
 $s$select public.end_shift(core_test.s('shift_w2'))$s$,'RPM_SHIFT_BUSY');
reset role;
select core_test.check('undecided failure closed by the end of the route, without actor',
 (select attempt=2 and decision='OTHERS_FINISHED' and decided_by is null from public.delivery_attempts
   where delivery_id=core_test.s('e2') and attempt=2)
 and (select status='RETURNING' and returning_at is not null from public.routes where id=core_test.s('route_w'))
 and (select status='RETURNING' from public.courier_shifts where id=core_test.s('shift_w2')));
select core_test.act(2);
set role authenticated;
select core_test.raises('store decision after the automatic return is refused',
 $s$select public.decide_delivery_failure(core_test.id(101),core_test.s('e2'),'RETRY')$s$,'RPM_ISSUE_CLOSED');
select core_test.raises('returned order cannot be requeued while the courier is out',
 $s$select public.requeue_delivery(core_test.id(101),core_test.s('e2'))$s$,'RPM_DELIVERY_IN_TRANSIT');
reset role;

-- ---------------------------------------------------------
-- record_courier_locations
-- ---------------------------------------------------------
select set_config('core.points',jsonb_build_array(
 jsonb_build_object('latitude',-23.5,'longitude',-46.6,'accuracy',8,'recordedAt',clock_timestamp()::text),
 jsonb_build_object('latitude',-23.4,'longitude',-46.5,'recordedAt',(clock_timestamp()-interval '5 seconds')::text))::text,false);
select core_test.act(9);
set role authenticated;
select core_test.check('courier stores a batch of points',
 public.record_courier_locations(core_test.s('route_w'),current_setting('core.points')::jsonb)=2);
select core_test.check('the same batch again stores nothing',
 public.record_courier_locations(core_test.s('route_w'),current_setting('core.points')::jsonb)=0);
select core_test.check('a point from the future is dropped',
 public.record_courier_locations(core_test.s('route_w'),jsonb_build_array(jsonb_build_object(
  'latitude',-23.3,'longitude',-46.4,'recordedAt',(clock_timestamp()+interval '1 hour')::text)))=0);
select core_test.raises('latitude out of range',
 $s$select public.record_courier_locations(core_test.s('route_w'),'[{"latitude":91,"longitude":0,"recordedAt":"2026-01-01T00:00:00Z"}]')$s$,'RPM_LOCATION_FIELDS');
select core_test.raises('latitude must be a number',
 $s$select public.record_courier_locations(core_test.s('route_w'),'[{"latitude":"x","longitude":0,"recordedAt":"2026-01-01T00:00:00Z"}]')$s$,'RPM_LOCATION_FIELDS');
select core_test.raises('timestamp must be valid',
 $s$select public.record_courier_locations(core_test.s('route_w'),'[{"latitude":1,"longitude":1,"recordedAt":"banana"}]')$s$,'RPM_LOCATION_FIELDS');
select core_test.raises('points must be an array',
 $s$select public.record_courier_locations(core_test.s('route_w'),'{"latitude":1}')$s$,'RPM_LOCATION_FIELDS');
select core_test.raises('empty batch',
 $s$select public.record_courier_locations(core_test.s('route_w'),'[]')$s$,'RPM_LOCATION_FIELDS');
reset role;
select core_test.act(13);
set role authenticated;
select core_test.raises('another courier cannot record on the route',
 $s$select public.record_courier_locations(core_test.s('route_w'),'[{"latitude":1,"longitude":1,"recordedAt":"2026-01-01T00:00:00Z"}]')$s$,'RPM_ROUTE_NOT_FOUND');
reset role;
select core_test.check('live position follows the newest point',
 (select last_latitude=-23.5 and last_longitude=-46.6 and location_updated_at is not null
   from public.couriers where id=core_test.id(209))
 and (select count(*)=2 from public.courier_locations where route_id=core_test.s('route_w')));

-- ---------------------------------------------------------
-- arrive_at_store and the returned order
-- ---------------------------------------------------------
select core_test.act(13);
set role authenticated;
select core_test.raises('another courier cannot arrive for the route',
 $s$select public.arrive_at_store(core_test.s('route_w'))$s$,'RPM_ROUTE_NOT_FOUND');
reset role;
select core_test.act(9);
set role authenticated;
do $$declare v jsonb; r jsonb;begin
 v:=public.arrive_at_store(core_test.s('route_w'));
 perform core_test.check('arrival completes the route',(v->>'changed')::boolean and v->>'status'='COMPLETED');
 r:=public.arrive_at_store(core_test.s('route_w'));
 perform core_test.check('arrival retry is success',not (r->>'changed')::boolean and r->>'status'='COMPLETED');
end;$$;
reset role;
select core_test.check('courier back to the end of the available queue',
 (select s.status='AVAILABLE' and s.available_since=r.arrived_at and r.completed_at is not null
   from public.courier_shifts s join public.routes r on r.courier_shift_id=s.id
   where r.id=core_test.s('route_w')));
-- Late offline sync: a point recorded during the route is kept as history
-- but does not move the live position anymore.
select set_config('core.late_points',jsonb_build_array(jsonb_build_object('latitude',1,'longitude',1,
 'recordedAt',(select started_at+interval '1 second' from public.routes where id=core_test.s('route_w'))::text))::text,false);
select core_test.act(9);
set role authenticated;
select core_test.check('late point within the route window is kept',
 public.record_courier_locations(core_test.s('route_w'),current_setting('core.late_points')::jsonb)=1);
reset role;
select core_test.check('late point does not move the live position',
 (select last_latitude=-23.5 from public.couriers where id=core_test.id(209)));

select core_test.act(1);
set role authenticated;
select core_test.check('returned order goes back to the queue',public.requeue_delivery(core_test.id(101),core_test.s('e2'))='WAITING');
select core_test.check('requeue retry is success',public.requeue_delivery(core_test.id(101),core_test.s('e2'))='WAITING');
select core_test.check('requeued order is open again',
 (select d.status='WAITING' and d.assigned_at is null and o.status='OPEN' from public.deliveries d
   join public.orders o on o.id=d.order_id where d.id=core_test.s('e2')));
select core_test.raises('delivered order cannot be requeued',
 $s$select public.requeue_delivery(core_test.id(101),core_test.s('e1'))$s$,'RPM_DELIVERY_STATE');
select core_test.check('requeued order can be cancelled off route',
 public.cancel_order(core_test.id(101),(select order_id from public.deliveries where id=core_test.s('e2')))='CANCELLED');
reset role;

-- ---------------------------------------------------------
-- Decision deadline: the deadline wins, even over a store decision.
-- ---------------------------------------------------------
select core_test.act(1);
set role authenticated;
do $$begin
 perform set_config('core.route_w2',public.create_route(core_test.id(101),core_test.id(9320),core_test.s('shift_w2'),
   array[core_test.s('e4'),core_test.s('e5')])->>'routeId',false);
 perform public.release_route_pickup(core_test.id(101),core_test.s('route_w2'),1);
end;$$;
reset role;
select core_test.act(9);
set role authenticated;
select core_test.check('back in the queue, the courier starts a new route',
 public.start_route(core_test.s('route_w2'),1)->>'nextDeliveryId'=core_test.s('e4')::text);
select core_test.check('failure with another stop left keeps the route going',
 public.report_delivery_failure(core_test.id(9501),core_test.s('route_w2'),core_test.s('e4'),'CUSTOMER_NOT_FOUND')->>'nextDeliveryId'
  =core_test.s('e5')::text);
reset role;
update public.delivery_attempts set decision_deadline=clock_timestamp()-interval '1 second'
 where delivery_id=core_test.s('e4') and decision is null;
select core_test.act(2);
set role authenticated;
select core_test.raises('decision after the deadline is refused',
 $s$select public.decide_delivery_failure(core_test.id(101),core_test.s('e4'),'RETRY')$s$,'RPM_ISSUE_CLOSED');
reset role;
select core_test.act(9);
set role authenticated;
select core_test.check('next courier command settles the expired issue',
 public.complete_delivery(core_test.id(9502),core_test.s('route_w2'),core_test.s('e5'))->>'status'='RETURNING');
reset role;
select core_test.check('expired issue closed by TIMEOUT, not by the end of the route',
 (select decision='TIMEOUT' and decided_by is null from public.delivery_attempts where delivery_id=core_test.s('e4'))
 and (select status='RETURN_TO_STORE' from public.deliveries where id=core_test.s('e4')));

-- ---------------------------------------------------------
-- cancel_delivery_on_route (route R: d4, d2)
-- ---------------------------------------------------------
select core_test.act(1);
set role authenticated;
select public.release_route_pickup(core_test.id(101),core_test.s('route_r2'),
 (select composition_version from public.routes where id=core_test.s('route_r2')));
reset role;
select core_test.act(13);
set role authenticated;
select core_test.check('R starts with d4 as NEXT',
 public.start_route(core_test.s('route_r2'),(select composition_version from public.routes where id=core_test.s('route_r2')))
  ->>'nextDeliveryId'=core_test.s('d4')::text);
select public.report_delivery_failure(core_test.id(9601),core_test.s('route_r2'),core_test.s('d4'),'OTHER','portão fechado');
reset role;
select core_test.act(4);
set role authenticated;
select core_test.raises('another store cannot cancel on route',
 $s$select public.cancel_delivery_on_route(core_test.id(101),core_test.s('d2'))$s$,'RPM_MEMBER_REQUIRED');
select core_test.raises('a foreign delivery is not found in B',
 $s$select public.cancel_delivery_on_route(core_test.id(102),core_test.s('d2'))$s$,'RPM_DELIVERY_NOT_FOUND');
reset role;
select core_test.act(2);
set role authenticated;
do $$declare v jsonb; r jsonb;begin
 v:=public.cancel_delivery_on_route(core_test.id(101),core_test.s('d4'));
 perform core_test.check('cancel closes the open failure',(v->>'changed')::boolean and v->>'deliveryStatus'='CANCELLED');
 r:=public.cancel_delivery_on_route(core_test.id(101),core_test.s('d4'));
 perform core_test.check('cancel retry is success',not (r->>'changed')::boolean);
 r:=public.decide_delivery_failure(core_test.id(101),core_test.s('d4'),'CANCEL');
 perform core_test.check('the cancel also answers the issue',not (r->>'changed')::boolean and r->>'decision'='CANCEL');
 v:=public.cancel_delivery_on_route(core_test.id(101),core_test.s('d2'));
 perform core_test.check('cancelling the last stop sends the courier back',v->>'deliveryStatus'='CANCELLED');
end;$$;
select core_test.raises('delivered order cannot be cancelled on route',
 $s$select public.cancel_delivery_on_route(core_test.id(101),core_test.s('e1'))$s$,'RPM_DELIVERY_STATE');
reset role;
select core_test.check('on-route cancel mirrors order, attempt and route',
 (select bool_and(d.status='CANCELLED' and d.cancelled_at is not null and o.status='CANCELLED')
   from public.deliveries d join public.orders o on o.id=d.order_id where d.id in (core_test.s('d4'),core_test.s('d2')))
 and (select decision='CANCEL' and decided_by=core_test.id(2) from public.delivery_attempts where delivery_id=core_test.s('d4'))
 and (select status='RETURNING' from public.routes where id=core_test.s('route_r2')));
select core_test.act(13);
set role authenticated;
select core_test.raises('no completion after the store cancelled everything',
 $s$select public.complete_delivery(gen_random_uuid(),core_test.s('route_r2'),core_test.s('d2'))$s$,'RPM_ROUTE_STATE');
select core_test.check('R arrives',public.arrive_at_store(core_test.s('route_r2'))->>'status'='COMPLETED');
reset role;

-- ---------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------
select core_test.check('anon cannot execute execution commands', not exists (
 select 1 from (values ('public.start_route(uuid,integer)'),('public.complete_delivery(uuid,uuid,uuid)'),
  ('public.report_delivery_failure(uuid,uuid,uuid,text,text)'),('public.arrive_at_store(uuid)'),
  ('public.record_courier_locations(uuid,jsonb)'),('public.decide_delivery_failure(uuid,uuid,text)'),
  ('public.cancel_delivery_on_route(uuid,uuid)'),('public.requeue_delivery(uuid,uuid)')) f(sig)
 where has_function_privilege('anon',f.sig,'EXECUTE') or not has_function_privilege('authenticated',f.sig,'EXECUTE')));
select core_test.check('execution helpers not executable by API roles', not exists (
 select 1 from (values ('private.require_courier()'),('private.lock_route_execution(uuid)'),
  ('private.courier_route_id(uuid,uuid)'),('private.settle_route_issues(uuid,timestamptz)'),
  ('private.advance_route(uuid,timestamptz)'),('private.route_progress(uuid)'),('private.delivery_state(uuid)'),
  ('private.route_delivery_status(uuid,uuid)'),('private.on_route_route_id(uuid,uuid)')) f(sig),
  (values ('anon'),('authenticated')) r(role)
 where has_function_privilege(r.role,f.sig,'EXECUTE')));
select core_test.check('execution commands are security definer with empty search_path', not exists (
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('start_route','complete_delivery','report_delivery_failure',
   'arrive_at_store','record_courier_locations','decide_delivery_failure','cancel_delivery_on_route','requeue_delivery')
   and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])));
select core_test.check('attempts are read-only for API roles and protected by RLS', not exists (
 select 1 from (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,'public.delivery_attempts',p.priv))
 and not has_table_privilege('anon','public.delivery_attempts','SELECT')
 and (select relrowsecurity from pg_class where oid='public.delivery_attempts'::regclass));
select core_test.check('location writes only through the command', not exists (
 select 1 from (values ('INSERT'),('UPDATE'),('DELETE')) p(priv), (values ('anon'),('authenticated')) r(role)
 where has_table_privilege(r.role,'public.courier_locations',p.priv)));
