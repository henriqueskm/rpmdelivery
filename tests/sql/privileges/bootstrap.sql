-- Synthetic roles/defaults. Disposable PostgreSQL/PGlite only, not Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_admin nologin;
create schema auth;
create schema extensions;
create schema privilege_test;
create table auth.users (
  id uuid primary key, email text, phone text, raw_user_meta_data jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to authenticated;
grant usage on schema public to anon, service_role;
grant usage, create on schema public to supabase_admin;
grant execute on function auth.uid() to authenticated;

-- Reproduce the broad per-schema defaults observed in the audit. The old
-- migrations revoke only part of these. PUBLIC's global EXECUTE is implicit.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on routines to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on routines to anon, authenticated, service_role;

create table privilege_test.snapshots (name text primary key, value jsonb);
create view privilege_test.default_acls as
select jsonb_agg(jsonb_build_object('owner',defaclrole,'schema',defaclnamespace,
  'kind',defaclobjtype,'acl',defaclacl) order by defaclrole,defaclnamespace,defaclobjtype) as value
from pg_catalog.pg_default_acl;
