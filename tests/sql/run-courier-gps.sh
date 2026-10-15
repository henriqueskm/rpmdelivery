#!/usr/bin/env bash
set -euo pipefail
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != 1 || "${PGHOST:-}" != 127.0.0.1 ||
      "${PGDATABASE:-}" != rpmdelivery_gps_test || "${PGUSER:-}" != postgres ]]; then
  echo 'Refusing: requires opted-in disposable loopback rpmdelivery_gps_test.' >&2; exit 1
fi
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGPASSWORD
psql=(psql -X --no-password -v ON_ERROR_STOP=1)
"${psql[@]}" -c 'select version(),current_database(),current_user;'
"${psql[@]}" -c "do \$\$begin
 if current_setting('server_version_num')::int not between 170000 and 179999
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
 then raise exception 'Requires empty PostgreSQL17'; end if; end;\$\$;"
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
gps=supabase/migrations/20261015092344_courier_gps_read_isolation.sql
for f in supabase/migrations/*.sql; do
  if [[ "$f" < "$gps" ]]; then "${psql[@]}" -f "$f"; fi
done
"${psql[@]}" -f tests/sql/courier-gps/fixtures.sql
"${psql[@]}" -U gps_owner_b -v uid=00000000-0000-4000-8000-000000000002 -v phase=before -v visible=true -f tests/sql/courier-gps/actor.sql
# Explicit preexisting column grants must also be removed, not just table SELECT.
"${psql[@]}" -c 'grant select(last_latitude,last_longitude,location_updated_at) on public.couriers to public,anon,authenticated;'
"${psql[@]}" -f "$gps"
for status in ACTIVE PENDING REJECTED SUSPENDED; do
  "${psql[@]}" -c "update public.restaurant_couriers set status='$status' where id=gps_test.id(302);"
  for pair in 'gps_owner_a 1' 'gps_owner_b 2' 'gps_courier 3' 'gps_operator_b 4' 'gps_manager_b 5' 'gps_inactive_b 6' 'gps_outsider 7'; do
    read -r actor suffix <<< "$pair"
    visible=false
    if [[ "$actor" == gps_owner_a || "$actor" == gps_courier ||
       ( "$status" == ACTIVE && "$suffix" =~ ^[245]$ ) ||
       ( "$status" == PENDING && "$suffix" =~ ^[25]$ ) ]]; then visible=true; fi
    echo "AFTER: $actor relationship=$status identity=$visible"
    uid=$(printf '00000000-0000-4000-8000-%012d' "$suffix")
    "${psql[@]}" -U "$actor" -v uid="$uid" -v phase=after -v visible="$visible" -f tests/sql/courier-gps/actor.sql
  done
done
"${psql[@]}" -f tests/sql/courier-gps/assertions.sql
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
"${psql[@]}" -U gps_anon -c "do \$\$begin
 begin perform * from public.couriers;raise exception 'Anonymous wildcard leaked';exception when insufficient_privilege then raise notice 'PASS: anonymous wildcard denied';end;
 begin perform last_latitude from public.couriers;raise exception 'Anonymous GPS leaked';exception when insufficient_privilege then raise notice 'PASS: anonymous coordinates denied';end;
 end;\$\$;"
"${psql[@]}" -f "$gps"
"${psql[@]}" -f tests/sql/courier-gps/assertions.sql
"${psql[@]}" -c 'create role gps_inherited_read nologin;
 grant gps_inherited_read to authenticated;
 grant select(last_latitude) on public.couriers to gps_inherited_read;'
negative_output=$(mktemp)
trap 'rm -f "$negative_output"' EXIT
if "${psql[@]}" -f "$gps" >"$negative_output" 2>&1; then
  echo 'FAIL: inherited GPS permission accepted' >&2; exit 1
fi
if ! grep -q RPM_COURIER_GPS_INHERITED_SELECT "$negative_output"; then
  cat "$negative_output"; echo 'FAIL: unexpected guard error' >&2; exit 1
fi
echo 'PASS: unexpected inherited GPS SELECT rejects migration transaction'
"${psql[@]}" -c 'revoke gps_inherited_read from authenticated;
 revoke select(last_latitude) on public.couriers from gps_inherited_read;'
"${psql[@]}" -f tests/sql/courier-gps/assertions.sql
echo 'PASS: PostgreSQL17 GPS isolation, before/after, roles, onboarding and reapplication'
