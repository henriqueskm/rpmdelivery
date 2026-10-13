#!/usr/bin/env bash
set -euo pipefail
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != "1" ||
      "${PGHOST:-}" != "127.0.0.1" || "${PGDATABASE:-}" != "rpmdelivery_privileges_test" ||
      "${PGUSER:-}" != "postgres" ]]; then
  echo 'Refusing: requires explicitly opted-in disposable loopback PostgreSQL.' >&2; exit 1
fi
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGPASSWORD
export PGPASSFILE=/dev/null LC_ALL=C
psql=(psql -X --no-password --set ON_ERROR_STOP=1)
"${psql[@]}" -c 'select version(), current_database(), current_user;'
"${psql[@]}" -c "do \$\$ begin
  if current_setting('server_version_num')::integer not between 170000 and 179999
    or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')) then
    raise exception 'Requires empty disposable PostgreSQL17';
  end if;
end; \$\$;"
prerequisite=$(node tests/sql/security-migrations.ts --check-order)
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  [[ "$migration" < "supabase/migrations/$prerequisite" ]] || continue
  "${psql[@]}" -f "$migration"
done
"${psql[@]}" -f tests/sql/global-routines/event-triggers.sql
"${psql[@]}" -f tests/sql/global-routines/fixtures.sql
for application in 1 2; do
  "${psql[@]}" -f "supabase/migrations/$prerequisite"
  "${psql[@]}" -f tests/sql/global-routines/assertions.sql
  "${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
done
"${psql[@]}" -c 'alter default privileges for role postgres grant execute on routines to service_role;'
"${psql[@]}" -f "supabase/migrations/$prerequisite"
"${psql[@]}" -f tests/sql/global-routines/global-grant.sql
"${psql[@]}" -c 'alter default privileges for role postgres revoke execute on routines from service_role;'
"${psql[@]}" -f tests/sql/global-routines/extensions.sql

# A separate empty database exercises the ACTUAL sorted chain, with no fixture
# closing global EXECUTE. When PR17 is present it must follow the prerequisite.
"${psql[@]}" -c 'create database rpmdelivery_security_install_test;'
export PGDATABASE=rpmdelivery_security_install_test
# Roles belong to the cluster, schemas/default ACLs to each database. Reuse
# only the four already-created synthetic roles; initialize everything else.
sed '/^create role /d' tests/sql/privileges/bootstrap.sql | "${psql[@]}"
for migration in supabase/migrations/*.sql; do "${psql[@]}" -f "$migration"; done
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
echo 'PASS: native PostgreSQL global prerequisite, replay, explicit grants, event listener and fresh ordered installation'
