#!/usr/bin/env bash
set -euo pipefail
# Disposable loopback PostgreSQL 17 only: synthetic data, no secrets, no hosted project.
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != 1 || "${PGHOST:-}" != 127.0.0.1 ||
      "${PGDATABASE:-}" != rpmdelivery_core_test || "${PGUSER:-}" != postgres ]]; then
 echo 'Refusing non-disposable delivery core database' >&2; exit 1
fi
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGPASSWORD PGPASSFILE
export PGPASSFILE=/dev/null
psql=(psql -X --no-password -q -v ON_ERROR_STOP=1)
"${psql[@]}" -c "do \$\$begin
 if current_setting('server_version_num')::int not between 170000 and 179999
 or exists(select 1 from pg_tables where schemaname='public')
 then raise exception 'Requires empty PostgreSQL17';end if;end;\$\$;"
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
for file in supabase/migrations/*.sql; do "${psql[@]}" -f "$file"; done
"${psql[@]}" -f tests/sql/delivery-core/fixtures.sql

as_actor() { # actor number, SQL run as authenticated in its own connection
 "${psql[@]}" -tA -c "select core_test.act($1);" -c "set role authenticated;" -c "$2"
}

# Race 1: the same create_order command arrives twice at once (Android retry).
# The first connection holds its transaction open; the second must wait on the
# idempotency key and then return the committed result instead of duplicating.
rid=00000000-0000-4000-9000-000000099001
cmd="select public.create_order(core_test.id(101),'$rid','Corrida','11999990000','Rua R')->>'created'"
as_actor 1 "begin; $cmd; select pg_sleep(2); commit;" >/tmp/core-race-a.txt 2>&1 &
first=$!
sleep 0.5
as_actor 2 "$cmd" >/tmp/core-race-b.txt 2>&1
wait "$first"
grep -qx false /tmp/core-race-b.txt || { echo 'FAIL: concurrent replay'; cat /tmp/core-race-*.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('concurrent replay creates exactly one order and delivery',
 (select count(*)=1 from public.orders o join public.deliveries d on d.order_id=o.id where o.client_request_id='$rid'));"

# Race 2: one courier asks for shifts in two stores at the same time.
as_actor 10 "begin; select public.request_shift(core_test.id(101))->>'status'; select pg_sleep(2); commit;" \
 >/tmp/core-shift-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 10 "select public.request_shift(core_test.id(102))" >/tmp/core-shift-b.txt 2>&1; then
 echo 'FAIL: second store accepted a concurrent shift'; cat /tmp/core-shift-*.txt; exit 1
fi
wait "$first"
grep -q RPM_SHIFT_OPEN_ELSEWHERE /tmp/core-shift-b.txt || { echo 'FAIL: unexpected shift race error'; cat /tmp/core-shift-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('concurrent shift requests leave one open shift',
 (select count(*)=1 from public.courier_shifts where courier_id=core_test.id(210) and status not in ('ENDED','REJECTED')));"

# Race 3: store approves while the courier cancels the pending request.
# Row lock serializes them: the approval waits, then sees ENDED and is refused.
shift=$("${psql[@]}" -tA -c "select id from public.courier_shifts where courier_id=core_test.id(210) and status='PENDING'")
as_actor 10 "begin; select public.end_shift('$shift'); select pg_sleep(2); commit;" >/tmp/core-end-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 1 "select public.review_shift(core_test.id(101),'$shift',true)" >/tmp/core-end-b.txt 2>&1; then
 echo 'FAIL: approval of a concurrently ended shift'; cat /tmp/core-end-*.txt; exit 1
fi
wait "$first"
grep -q RPM_SHIFT_STATE /tmp/core-end-b.txt || { echo 'FAIL: unexpected end/approve race error'; cat /tmp/core-end-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('approval racing a cancellation keeps ENDED',
 (select status='ENDED' from public.courier_shifts where id='$shift'));"

# Route races: couriers U (11) and T (12) get approved shifts; three orders.
for actor in 11 12; do as_actor "$actor" "select public.request_shift(core_test.id(101))->>'status'" >/dev/null; done
"${psql[@]}" -tA -c "select core_test.act(1);" -c "set role authenticated;" -c "
 select public.review_shift(core_test.id(101),s.id,true) from public.courier_shifts s
  where s.courier_id in (core_test.id(211),core_test.id(212)) and s.status='PENDING';
 select public.create_order(core_test.id(101),core_test.id(99100+n),'Rota '||n,'1198888000'||n,'Rua R'||n)
  from generate_series(1,3) n;" >/dev/null
shift_u=$("${psql[@]}" -tA -c "select id from public.courier_shifts where courier_id=core_test.id(211) and status='AVAILABLE'")
shift_t=$("${psql[@]}" -tA -c "select id from public.courier_shifts where courier_id=core_test.id(212) and status='AVAILABLE'")
delivery() { "${psql[@]}" -tA -c "select d.id from public.deliveries d join public.orders o on o.id=d.order_id where o.client_request_id=core_test.id($1)"; }
d1=$(delivery 99101); d2=$(delivery 99102); d3=$(delivery 99103)

# Race 4: two operators put the same order in routes of different couriers.
as_actor 1 "begin; select public.create_route(core_test.id(101),gen_random_uuid(),'$shift_u',array['$d1']::uuid[])->>'routeId'; select pg_sleep(2); commit;" \
 >/tmp/core-route-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 2 "select public.create_route(core_test.id(101),gen_random_uuid(),'$shift_t',array['$d1']::uuid[])" >/tmp/core-route-b.txt 2>&1; then
 echo 'FAIL: one delivery entered two routes'; cat /tmp/core-route-*.txt; exit 1
fi
wait "$first"
grep -q RPM_DELIVERY_UNAVAILABLE /tmp/core-route-b.txt || { echo 'FAIL: unexpected route race error'; cat /tmp/core-route-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('concurrent routes leave the order in exactly one active route',
 (select count(*)=1 from public.route_deliveries rd join public.routes r on r.id=rd.route_id
   where rd.delivery_id='$d1' and r.status in ('PREPARING','ON_ROUTE','RETURNING')));"
route_u=$("${psql[@]}" -tA -c "select id from public.routes where courier_shift_id='$shift_u' and status='PREPARING'")

# Race 5: a release for version 1 arrives while the composition changes.
# The route lock serializes them and the release must refuse the new version.
as_actor 1 "begin; select public.update_route_composition(core_test.id(101),'$route_u',1,array['$d1','$d2']::uuid[])->>'version'; select pg_sleep(2); commit;" \
 >/tmp/core-release-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 2 "select public.release_route_pickup(core_test.id(101),'$route_u',1)" >/tmp/core-release-b.txt 2>&1; then
 echo 'FAIL: release of a stale composition'; cat /tmp/core-release-*.txt; exit 1
fi
wait "$first"
grep -q RPM_ROUTE_STALE /tmp/core-release-b.txt || { echo 'FAIL: unexpected release race error'; cat /tmp/core-release-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('release racing a composition change is refused',
 (select composition_version=2 and pickup_released_at is null from public.routes where id='$route_u'));"

# Race 6: the same create_route command arrives twice at once.
rq=00000000-0000-4000-9000-000000099201
cmd="select public.create_route(core_test.id(101),'$rq','$shift_t',array['$d3']::uuid[])->>'created'"
as_actor 1 "begin; $cmd; select pg_sleep(2); commit;" >/tmp/core-rreplay-a.txt 2>&1 &
first=$!
sleep 0.5
as_actor 2 "$cmd" >/tmp/core-rreplay-b.txt 2>&1
wait "$first"
grep -qx false /tmp/core-rreplay-b.txt || { echo 'FAIL: concurrent route replay'; cat /tmp/core-rreplay-*.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('concurrent route replay creates exactly one route',
 (select count(*)=1 from public.routes where client_request_id='$rq'));"

# Route execution races: couriers Q (14) and S (15) get approved shifts.
for actor in 14 15; do as_actor "$actor" "select public.request_shift(core_test.id(101))->>'status'" >/dev/null; done
"${psql[@]}" -tA -c "select core_test.act(1);" -c "set role authenticated;" -c "
 select public.review_shift(core_test.id(101),s.id,true) from public.courier_shifts s
  where s.courier_id in (core_test.id(214),core_test.id(215)) and s.status='PENDING';
 select public.create_order(core_test.id(101),core_test.id(99300+n),'Execucao '||n,'1196666000'||n,'Rua X'||n)
  from generate_series(1,5) n;" >/dev/null
shift_q=$("${psql[@]}" -tA -c "select id from public.courier_shifts where courier_id=core_test.id(214) and status='AVAILABLE'")
shift_s=$("${psql[@]}" -tA -c "select id from public.courier_shifts where courier_id=core_test.id(215) and status='AVAILABLE'")
x1=$(delivery 99301); x2=$(delivery 99302); x3=$(delivery 99303); x4=$(delivery 99304); x5=$(delivery 99305)
store() { "${psql[@]}" -tA -c "select core_test.act(1);" -c "set role authenticated;" -c "$1" | tail -n 1; }
route_q=$(store "select public.create_route(core_test.id(101),gen_random_uuid(),'$shift_q',array['$x1']::uuid[])->>'routeId'")
route_s=$(store "select public.create_route(core_test.id(101),gen_random_uuid(),'$shift_s',array['$x2','$x3','$x4','$x5']::uuid[])->>'routeId'")
store "select public.release_route_pickup(core_test.id(101),'$route_q',1); select public.release_route_pickup(core_test.id(101),'$route_s',1);" >/dev/null

# Race 7: the store revokes the pickup while the courier taps "Iniciar rota".
# The route lock serializes them: the start waits and sees no release.
as_actor 1 "begin; select public.revoke_route_pickup(core_test.id(101),'$route_q')->>'status'; select pg_sleep(2); commit;" \
 >/tmp/core-start-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 14 "select public.start_route('$route_q',1)" >/tmp/core-start-b.txt 2>&1; then
 echo 'FAIL: route started after the pickup was revoked'; cat /tmp/core-start-*.txt; exit 1
fi
wait "$first"
grep -q RPM_PICKUP_NOT_RELEASED /tmp/core-start-b.txt || { echo 'FAIL: unexpected start race error'; cat /tmp/core-start-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('start racing a revocation keeps the route waiting',
 (select status='PREPARING' and pickup_released_at is null from public.routes where id='$route_q')
 and (select status='ASSIGNED' from public.deliveries where id='$x1'));"

as_actor 15 "select public.start_route('$route_s',1)->>'status'" >/dev/null

# Race 8: the same "Entregue" arrives twice at once (Android retry).
rq=00000000-0000-4000-9000-000000099401
cmd="select public.complete_delivery('$rq','$route_s','$x2')->>'replayed'"
as_actor 15 "begin; $cmd; select pg_sleep(2); commit;" >/tmp/core-done-a.txt 2>&1 &
first=$!
sleep 0.5
as_actor 15 "$cmd" >/tmp/core-done-b.txt 2>&1
wait "$first"
grep -qx true /tmp/core-done-b.txt || { echo 'FAIL: concurrent completion replay'; cat /tmp/core-done-*.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('concurrent completion records one attempt and advances once',
 (select count(*)=1 from public.delivery_attempts where delivery_id='$x2')
 and (select status='NEXT' from public.deliveries where id='$x3'));"

# Race 9: the store cancels the stop the courier is completing.
as_actor 1 "begin; select public.cancel_delivery_on_route(core_test.id(101),'$x3')->>'deliveryStatus'; select pg_sleep(2); commit;" \
 >/tmp/core-cancel-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 15 "select public.complete_delivery(gen_random_uuid(),'$route_s','$x3')" >/tmp/core-cancel-b.txt 2>&1; then
 echo 'FAIL: cancelled delivery was completed'; cat /tmp/core-cancel-*.txt; exit 1
fi
wait "$first"
grep -q RPM_DELIVERY_STATE /tmp/core-cancel-b.txt || { echo 'FAIL: unexpected cancel race error'; cat /tmp/core-cancel-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('completion racing a cancellation keeps CANCELLED',
 (select status='CANCELLED' from public.deliveries where id='$x3')
 and not exists (select 1 from public.delivery_attempts where delivery_id='$x3')
 and (select status='NEXT' from public.deliveries where id='$x4'));"

# Race 10: the store retries a failure while the courier finishes the last
# stop. The finished route returns the failure first; the decision is refused.
as_actor 15 "select public.report_delivery_failure(gen_random_uuid(),'$route_s','$x4','CUSTOMER_NOT_FOUND')->>'outcome'" >/dev/null
as_actor 15 "begin; select public.complete_delivery(gen_random_uuid(),'$route_s','$x5')->>'status'; select pg_sleep(2); commit;" \
 >/tmp/core-decide-a.txt 2>&1 &
first=$!
sleep 0.5
if as_actor 1 "select public.decide_delivery_failure(core_test.id(101),'$x4','RETRY')" >/tmp/core-decide-b.txt 2>&1; then
 echo 'FAIL: retry decided on a finished route'; cat /tmp/core-decide-*.txt; exit 1
fi
wait "$first"
grep -q RPM_ISSUE_CLOSED /tmp/core-decide-b.txt || { echo 'FAIL: unexpected decision race error'; cat /tmp/core-decide-b.txt; exit 1; }
"${psql[@]}" -c "select core_test.check('decision racing the end of the route keeps the return',
 (select status='RETURN_TO_STORE' from public.deliveries where id='$x4')
 and (select decision='OTHERS_FINISHED' from public.delivery_attempts where delivery_id='$x4')
 and (select status='RETURNING' from public.routes where id='$route_s'));"

"${psql[@]}" -f tests/sql/delivery-core/contracts.sql
"${psql[@]}" -f tests/sql/delivery-core/route-contracts.sql
"${psql[@]}" -f tests/sql/delivery-core/execution-contracts.sql
"${psql[@]}" -f tests/sql/delivery-core/tracking-contracts.sql
"${psql[@]}" -f tests/sql/delivery-core/privacy-contracts.sql
echo 'PASS: PostgreSQL 17 delivery core contracts and concurrency'
