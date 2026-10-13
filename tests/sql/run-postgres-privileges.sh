#!/usr/bin/env bash
set -euo pipefail

# No Supabase CLI, remote URL, secrets, Docker requirement or application data.
# This runner accepts only the empty loopback database provisioned by CI.
if [[ "${RPMDELIVERY_DISPOSABLE_POSTGRES:-}" != "1" ||
      "${PGHOST:-}" != "127.0.0.1" ||
      "${PGDATABASE:-}" != "rpmdelivery_privileges_test" ||
      "${PGUSER:-}" != "postgres" ]]; then
  echo 'Refusing: requires the explicitly opted-in disposable loopback database.' >&2
  exit 1
fi
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGPASSWORD
export PGPASSFILE=/dev/null
export LC_ALL=C
psql=(psql -X --no-password --set ON_ERROR_STOP=1)
"${psql[@]}" -c 'select version(), current_database(), current_user;'
"${psql[@]}" -c "do \$\$ begin
  if current_setting('server_version_num')::integer not between 170000 and 179999
    or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')) then
    raise exception 'Requires empty disposable PostgreSQL 17 database';
  end if;
end; \$\$;"

prerequisite=$(node tests/sql/security-migrations.ts --check-order)
hardening=supabase/migrations/20261013201124_postgres_public_default_privileges_hardening.sql
"${psql[@]}" -f tests/sql/privileges/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  [[ "$migration" < "supabase/migrations/$prerequisite" ]] || continue
  "${psql[@]}" -f "$migration"
done
"${psql[@]}" -f tests/sql/restaurant-geocoding.sql
negative_output=$(mktemp)
trap 'rm -f "$negative_output"' EXIT
assert_global_rejected() {
"${psql[@]}" -c "insert into privilege_test.snapshots select 'failed-preflight',value from privilege_test.default_acls
  on conflict(name) do update set value=excluded.value;"
if "${psql[@]}" -f "$hardening" >"$negative_output" 2>&1; then
  echo 'FAIL: unsafe global defaults were accepted' >&2
  exit 1
fi
cat "$negative_output"
if ! grep -q 'RPM_DEFAULT_PRIVILEGES_GLOBAL_GRANT' "$negative_output"; then
  echo 'FAIL: migration failed for an unexpected reason' >&2
  exit 1
fi
"${psql[@]}" -c "do \$\$ begin
  if (select value from privilege_test.default_acls) is distinct from
    (select value from privilege_test.snapshots where name='failed-preflight') then
    raise exception 'Failed preflight changed defaults';
  end if;
end; \$\$;"
echo "PASS: $1 rejected with no default ACL change"
}

# PostgreSQL's implicit global PUBLIC EXECUTE must never be silently ignored.
assert_global_rejected 'implicit global PUBLIC EXECUTE'
"${psql[@]}" -f "supabase/migrations/$prerequisite"
for object_class in tables sequences routines; do
  "${psql[@]}" -c "alter default privileges for role postgres grant all on $object_class to authenticated;"
  assert_global_rejected "direct global $object_class grant"
  "${psql[@]}" -c "alter default privileges for role postgres revoke all on $object_class from authenticated;"
done
"${psql[@]}" -c 'create role privilege_inherited nologin; grant privilege_inherited to anon;
  alter default privileges for role postgres grant select on tables to privilege_inherited;'
assert_global_rejected 'inherited global SELECT'
"${psql[@]}" -c 'alter default privileges for role postgres revoke select on tables from privilege_inherited;'

# Globals were closed by the ACTUAL separately reviewed prerequisite, not by
# fixture preparation. Attacking/restoring defaults above is test-only.
"${psql[@]}" -f tests/sql/privileges/fixtures.sql
"${psql[@]}" -f "$hardening"
"${psql[@]}" -f tests/sql/privileges/assertions.sql
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
"${psql[@]}" -f "$hardening"
"${psql[@]}" -f tests/sql/privileges/assertions.sql
"${psql[@]}" -f tests/sql/privileges/rpc-rls.sql
echo 'PASS: PostgreSQL 17 hardening and controlled reapplication'
