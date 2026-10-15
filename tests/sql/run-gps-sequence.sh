#!/usr/bin/env bash
set -euo pipefail
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != 1 || "${PGHOST:-}" != 127.0.0.1 ||
      "${PGDATABASE:-}" != rpmdelivery_gps_sequence_test || "${PGUSER:-}" != postgres ]]; then
  echo 'Refusing: requires opted-in disposable loopback rpmdelivery_gps_sequence_test.' >&2; exit 1
fi
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGPASSWORD PGPASSFILE
psql=(psql -X --no-password -v ON_ERROR_STOP=1)
"${psql[@]}" -c "do \$\$begin
 if current_setting('server_version_num')::int not between 170000 and 179999
 or (select oid=10 from pg_roles where rolname='postgres')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
 then raise exception 'Requires empty PostgreSQL17 with distinct bootstrap role'; end if; end;\$\$;"
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
migration=supabase/migrations/20261015172010_courier_gps_sequence_privileges.sql
for file in supabase/migrations/*.sql; do
  if [[ "$file" < "$migration" ]]; then "${psql[@]}" -f "$file"; fi
done
"${psql[@]}" -f tests/sql/courier-gps/fixtures.sql
"${psql[@]}" -c 'alter role anon login; alter role authenticated login; alter role service_role login bypassrls;'
for actor in anon authenticated; do
  echo "BEFORE: $actor can mutate GPS sequence without table INSERT"
  "${psql[@]}" -U "$actor" -c "select nextval('public.courier_locations_id_seq');
    select currval('public.courier_locations_id_seq');
    select setval('public.courier_locations_id_seq',currval('public.courier_locations_id_seq'),true);"
done
# PUBLIC grant is absent on production but explicitly reproduced as another path.
"${psql[@]}" -c 'grant all on sequence public.courier_locations_id_seq to public;
 create role sequence_inherited nologin;'
"${psql[@]}" -f tests/sql/gps-sequence/fixtures.sql
"${psql[@]}" -f "$migration"
"${psql[@]}" -f tests/sql/gps-sequence/assertions.sql
for actor in anon authenticated; do
  "${psql[@]}" -U "$actor" -f tests/sql/gps-sequence/denied.sql
done
# Prove denied nextval/setval did not advance or reset the fixture counter.
"${psql[@]}" -f tests/sql/gps-sequence/assertions.sql
"${psql[@]}" -f "$migration"
"${psql[@]}" -f tests/sql/gps-sequence/assertions.sql

negative_output=$(mktemp)
trap 'rm -f "$negative_output"' EXIT
for actor in anon authenticated; do
  for privilege in USAGE SELECT UPDATE; do
    "${psql[@]}" -c "grant sequence_inherited to $actor with inherit true,set true;
      grant $privilege on sequence public.courier_locations_id_seq to sequence_inherited;
      grant select on sequence public.courier_locations_id_seq to anon;"
    before_acl=$("${psql[@]}" -Atc "select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass")
    if "${psql[@]}" -f "$migration" >"$negative_output" 2>&1; then
      echo 'FAIL: inherited sequence privilege accepted' >&2; exit 1
    fi
    if ! grep -q RPM_GPS_SEQUENCE_RESIDUAL_PRIVILEGE "$negative_output"; then
      cat "$negative_output"; echo 'FAIL: wrong guard error' >&2; exit 1
    fi
    after_acl=$("${psql[@]}" -Atc "select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass")
    [[ "$before_acl" == "$after_acl" ]] || { echo 'FAIL: failed guard partially revoked ACL'; exit 1; }
    echo "PASS: $actor inherited $privilege rejects transaction and rolls back direct REVOKE"
    "${psql[@]}" -c "revoke sequence_inherited from $actor;
      revoke all on sequence public.courier_locations_id_seq from sequence_inherited,anon;"
  done
  "${psql[@]}" -c "grant sequence_inherited to $actor with inherit false,set true;
    grant usage on sequence public.courier_locations_id_seq to sequence_inherited;"
  if "${psql[@]}" -f "$migration" >"$negative_output" 2>&1; then
    echo 'FAIL: NOINHERIT SET ROLE bypass accepted' >&2; exit 1
  fi
  grep -q RPM_GPS_SEQUENCE_RESIDUAL_PRIVILEGE "$negative_output"
  echo "PASS: $actor NOINHERIT/SET ROLE path rejects migration"
  "${psql[@]}" -c "revoke sequence_inherited from $actor;
    revoke all on sequence public.courier_locations_id_seq from sequence_inherited;"
done
"${psql[@]}" -f tests/sql/gps-sequence/assertions.sql
# Reuse PR19 direct-login actor tests for legitimate own/route access and isolation.
for pair in 'gps_owner_a 1 true' 'gps_owner_b 2 false' 'gps_courier 3 true'; do
  read -r actor suffix visible <<< "$pair"
  uid=$(printf '00000000-0000-4000-8000-%012d' "$suffix")
  "${psql[@]}" -U "$actor" -v uid="$uid" -v phase=after -v visible="$visible" -f tests/sql/courier-gps/actor.sql
done
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
"${psql[@]}" -f tests/sql/gps-sequence/assertions.sql
# Only now exercise authorized counter mutations / generated IDs.
# Match hosted postgres: the owner must work without SUPERUSER bypass.
"${psql[@]}" -c 'alter role postgres nosuperuser;'
"${psql[@]}" -f "$migration"
for actor in postgres service_role; do
  "${psql[@]}" -U "$actor" -f tests/sql/gps-sequence/privileged.sql
done
echo 'PASS: PostgreSQL17 GPS sequence isolation, rollback, reapplication, PR19 and IDENTITY'
