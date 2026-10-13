-- Fixture prerequisite ONLY. Not part of the proposed production migration.
-- The negative test first proves that implicit global PUBLIC EXECUTE aborts
-- the migration atomically. This positive case starts with closed globals.
alter default privileges for role postgres revoke execute on routines from public;

create schema privilege_outside;
alter default privileges for role postgres in schema privilege_outside
  grant select on tables to authenticated;
alter default privileges for role postgres in schema privilege_outside
  grant usage on sequences to authenticated;
alter default privileges for role postgres in schema privilege_outside
  grant execute on routines to authenticated;

create table public.privilege_existing (id integer primary key);
alter table public.privilege_existing enable row level security;
grant select on public.privilege_existing to authenticated;
create policy existing_read on public.privilege_existing
  for select to authenticated using (true);
insert into public.privilege_existing values (1);
create sequence public.privilege_existing_sequence;
grant usage on sequence public.privilege_existing_sequence to authenticated;
create function public.privilege_existing_function() returns integer
  language sql as $$ select 7 $$;
grant execute on function public.privilege_existing_function() to authenticated;

-- Preserve identities, ACLs (including columns), policies and RLS flags of
-- existing public objects, globals, every other schema and supabase_admin.
create view privilege_test.existing_objects as
select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('id',c.oid,'acl',c.relacl,
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)
    order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','S')),
  'columns',(select jsonb_agg(jsonb_build_object('rel',a.attrelid,'column',a.attnum,
    'acl',a.attacl) order by a.attrelid,a.attnum) from pg_attribute a
    join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.attnum>0 and not a.attisdropped),
  'functions',(select jsonb_agg(jsonb_build_object('id',p.oid,'acl',p.proacl,
    'definer',p.prosecdef,'config',p.proconfig,'body',p.prosrc) order by p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')),
  'policies',(select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname)
    from pg_policies p where p.schemaname='public')
) as value;
insert into privilege_test.snapshots select 'existing', value from privilege_test.existing_objects;
insert into privilege_test.snapshots
select 'outside-defaults', jsonb_agg(to_jsonb(d) order by d.oid)
from pg_default_acl d where not (d.defaclrole='postgres'::regrole
  and d.defaclnamespace='public'::regnamespace);

-- Before evidence: residual Dxtm, sequence UPDATE and schema EXECUTE.
select 'before' as stage, pg_get_userbyid(d.defaclrole) as owner,
  d.defaclobjtype as kind, d.defaclacl::text as acl
from pg_default_acl d where d.defaclnamespace='public'::regnamespace
order by owner,kind;
