-- Metadata and objects are entirely synthetic. No hosted service certification.
create role privilege_public_probe nologin;
create role supabase_auth_admin nologin;
create schema privilege_plain;
create schema privilege_optin;
grant usage on schema privilege_plain, privilege_optin
  to anon,authenticated,service_role,privilege_public_probe;
grant usage,create on schema privilege_plain to supabase_auth_admin;
alter default privileges for role postgres in schema privilege_optin
  grant execute on routines to authenticated,service_role;

create function privilege_plain.existing_public() returns integer language sql as $$ select 7 $$;
create function public.existing_service() returns integer language sql as $$ select 7 $$;
revoke all on function public.existing_service() from public,anon,authenticated;
grant execute on function public.existing_service() to service_role;

create view privilege_test.global_existing as
select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('id',c.oid,'acl',c.relacl,
    'rls',c.relrowsecurity) order by c.oid) from pg_class c join pg_namespace n
    on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','S')),
  'functions',(select jsonb_agg(jsonb_build_object('id',p.oid,'acl',p.proacl,
    'owner',p.proowner,'config',p.proconfig,'definer',p.prosecdef,'body',p.prosrc)
    order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','auth','extensions','privilege_plain','privilege_optin','privilege_test')),
  'policies',(select jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname)
    from pg_policies p where p.schemaname in ('public','private','auth')),
  'column_acl',(select jsonb_agg(jsonb_build_object('table',a.attrelid,'column',a.attnum,'acl',a.attacl)
    order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped),
  'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
  'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member) from pg_auth_members m),
  'event_triggers',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e)
) as value;
insert into privilege_test.snapshots select 'global-existing',value from privilege_test.global_existing;
insert into privilege_test.snapshots select 'non-target-defaults',jsonb_agg(to_jsonb(d) order by d.oid)
from pg_default_acl d where not(d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f');

-- PostgreSQL implicit ACL must actually contain PUBLIC EXECUTE before migration.
do $$ begin
  if not exists(select 1 from aclexplode(coalesce(
    (select defaclacl from pg_default_acl where defaclrole='postgres'::regrole
      and defaclnamespace=0 and defaclobjtype='f'), acldefault('f','postgres'::regrole))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Baseline is missing implicit global PUBLIC EXECUTE';
  end if;
end; $$;
select 'before' as stage, a.grantee, a.privilege_type
from aclexplode(acldefault('f','postgres'::regrole)) a;
