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

"${psql[@]}" -f tests/sql/delivery-core/contracts.sql
echo 'PASS: PostgreSQL 17 delivery core contracts and concurrency'
