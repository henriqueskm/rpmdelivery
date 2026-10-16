#!/usr/bin/env bash
set -euo pipefail
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != 1 || "${PGHOST:-}" != 127.0.0.1 ||
      "${PGDATABASE:-}" != rpmdelivery_invites_test || "${PGUSER:-}" != postgres ]]; then
 echo 'Refusing non-disposable invitation database' >&2; exit 1
fi
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGPASSWORD PGPASSFILE
export PGPASSFILE=/dev/null
psql=(psql -X --no-password -v ON_ERROR_STOP=1)
"${psql[@]}" -c "do \$\$begin
 if current_setting('server_version_num')::int not between 170000 and 179999
 or exists(select 1 from pg_tables where schemaname='public')
 then raise exception 'Requires empty PostgreSQL17';end if;end;\$\$;"
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
for file in supabase/migrations/*.sql; do "${psql[@]}" -f "$file"; done
"${psql[@]}" -f tests/sql/courier-gps/fixtures.sql
"${psql[@]}" -f tests/sql/invitations/fixtures.sql
"${psql[@]}" -f tests/sql/invitations/contracts.sql
"${psql[@]}" -f tests/sql/invitations/registration.sql
# Clear only fictional attempt windows. Never reset a hosted counter.
"${psql[@]}" -c "update private.courier_invite_attempts set window_started_at=clock_timestamp()-interval '16 minutes';"
for pair in 'invite_courier_a 10' 'invite_courier_b 11'; do
 read -r actor id <<< "$pair"
 uid=$(printf '00000000-0000-4000-8000-%012d' "$id")
 "${psql[@]}" -U "$actor" -c "select set_config('request.jwt.claim.sub','$uid',false);
  select public.complete_courier_registration('Race courier',null,'Moto','TEST','Preta') is not null;"
done
# Two identities compete for one use: exactly one can create a relationship.
pids=()
for actor in invite_courier_a invite_courier_b; do
 id=10; [[ "$actor" == invite_courier_b ]] && id=11
 uid=$(printf '00000000-0000-4000-8000-%012d' "$id")
 "${psql[@]}" -U "$actor" -c "select set_config('request.jwt.claim.sub','$uid',false);
  select public.request_courier_membership('aaaaaaaaaaaaaaaa0001')->>'ok';" >"/tmp/$actor-invite-race.txt" 2>&1 &
 pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${psql[@]}" -c "select onboard_test.check('atomic final use under concurrency',
 (select used_count=1 from public.courier_invites where id=gps_test.id(801))
 and (select count(*)=1 from private.courier_invite_redemptions where invite_id=gps_test.id(801)));"
# Same identity, two invitations, same store: one link and one consumption in total.
pids=()
for suffix in 7 8; do
 code=$(printf 'aaaaaaaaaaaaaaaa%04d' "$suffix")
 "${psql[@]}" -U invite_courier_a -c "select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',false);
  select public.request_courier_membership('$code')->>'ok';" >"/tmp/same-courier-$suffix.txt" 2>&1 &
 pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${psql[@]}" -c "select onboard_test.check('same identity across invitations does not double consume',
 (select sum(used_count)=1 from public.courier_invites where id in (gps_test.id(807),gps_test.id(808)))
 and (select count(*)=1 from public.restaurant_couriers rc join public.couriers c on c.id=rc.courier_id
 where c.user_id=gps_test.id(10) and rc.restaurant_id=gps_test.id(102)));"
# Conflicting manager decisions serialize; the second must be stale, not flip state.
rid=$("${psql[@]}" -Atc "select rc.id from public.restaurant_couriers rc join public.couriers c on c.id=rc.courier_id where c.user_id=gps_test.id(10) and rc.restaurant_id=gps_test.id(102)")
pids=()
for pair in 'gps_owner_b 2 true' 'gps_manager_b 5 false'; do
 read -r actor id approve <<< "$pair"
 uid=$(printf '00000000-0000-4000-8000-%012d' "$id")
 "${psql[@]}" -U "$actor" -c "select set_config('request.jwt.claim.sub','$uid',false);
 select public.review_courier_membership('00000000-0000-4000-8000-000000000102','$rid',$approve);" >"/tmp/review-$actor.txt" 2>&1 &
 pids+=($!)
done
failures=0
for pid in "${pids[@]}"; do if ! wait "$pid"; then failures=$((failures+1)); fi; done
[[ "$failures" == 1 ]] || { echo 'FAIL: conflicting reviews did not reject exactly one decision'; exit 1; }
grep -q RPM_REVIEW_STALE /tmp/review-*.txt
"${psql[@]}" -c "select onboard_test.check('one audited decision under concurrent approve/reject',
 (select status in ('ACTIVE','REJECTED') and reviewed_at is not null and reviewed_by in (gps_test.id(2),gps_test.id(5))
 from public.restaurant_couriers where id='$rid'));"
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
# Two real sessions repair one partially populated courier. The first committed
# completion wins; the second preserves that complete tuple rather than mixing it.
"${psql[@]}" -c "insert into public.couriers(user_id,motorcycle_model)
 values(gps_test.id(17),'Saved model'),(gps_test.id(18),null);"
pids=()
for variant in A B; do
 plate=AAA1A11; color=Azul
 [[ "$variant" == B ]] && { plate=BBB2B22; color=Preta; }
 "${psql[@]}" -U invite_courier_a -c "set statement_timeout='5s';
 select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000017',false);
 select public.complete_courier_registration('Ignored',null,'Ignored','$plate','$color');" >"/tmp/repair-$variant.txt" 2>&1 &
 pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${psql[@]}" -c "select onboard_test.check('concurrent repairs preserve valid fields and one complete tuple',
 (select motorcycle_model='Saved model' and
   (motorcycle_plate,motorcycle_color) in (('AAA1A11','Azul'),('BBB2B22','Preta'))
 from public.couriers where user_id=gps_test.id(17)));"
# Hold the repair transaction open while a separate connection requests a link.
# The request must validate committed completed data, never a partial repair.
PGAPPNAME=onboard_repair_race "${psql[@]}" -U invite_courier_a -c "begin;set local statement_timeout='5s';
 select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000018',false);
 select public.complete_courier_registration('Ignored',null,'Moto','CCC3C33','Preta');
 select pg_sleep(1);commit;" >/tmp/repair-membership.txt 2>&1 &
repair_pid=$!
ready=false
for attempt in {1..50}; do
 if [[ $("${psql[@]}" -Atc "select exists(select 1 from pg_stat_activity
   where application_name='onboard_repair_race' and wait_event='PgSleep')") == t ]]; then ready=true;break;fi
done
[[ "$ready" == true ]] || { echo 'FAIL: repair concurrency barrier not reached';exit 1; }
"${psql[@]}" -U invite_courier_b -c "set statement_timeout='5s';
 select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000018',false);
 select onboard_test.check('request serializes with own repair',
 public.request_courier_membership('aaaaaaaaaaaaaaaa0008')->>'status'='PENDING');"
wait "$repair_pid"
"${psql[@]}" -f tests/sql/courier-gps/assertions.sql
echo 'PASS: PostgreSQL17 invitations, roles, concurrency, receipts, limits, RLS and GPS hardening'
