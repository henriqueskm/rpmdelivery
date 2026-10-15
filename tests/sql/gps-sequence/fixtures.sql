-- Reuse the fictional two-restaurant / one-courier / two-route fixture.
-- No external database or real credentials. Direct API-role logins are local.
alter role anon login;
alter role authenticated login;
alter role service_role login bypassrls;

create schema sequence_test;
create function sequence_test.check(label text, ok boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if ok is not true then raise exception 'SEQUENCE CHECK FAILED: %',label; end if;
 raise notice 'PASS: %',label;
end; $$;
grant usage on schema sequence_test to anon,authenticated,service_role;
grant execute on function sequence_test.check(text,boolean) to anon,authenticated,service_role;

-- Exclude only the target sequence ACL. Everything else must be identical,
-- including PR19 helper bodies/ACLs, all table/column grants, roles and RLS.
create view sequence_test.unchanged as select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,
   'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by c.oid)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
   and c.oid<>'public.courier_locations_id_seq'::regclass),
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a
   join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')),
 'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c
   join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
 'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
 'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by m.oid) from pg_auth_members m),
 'sequence_definition',(select to_jsonb(s) from pg_sequence s where seqrelid='public.courier_locations_id_seq'::regclass),
 'identity_dependencies',(select jsonb_agg(to_jsonb(d) order by classid,objid,objsubid,refobjid)
   from pg_depend d where objid='public.courier_locations_id_seq'::regclass),
 'sequence_owner',(select relowner from pg_class where oid='public.courier_locations_id_seq'::regclass),
 'privileged_grants',(select jsonb_agg(to_jsonb(g) order by grantee,privilege_type)
   from pg_class c cross join lateral aclexplode(c.relacl) g
   where c.oid='public.courier_locations_id_seq'::regclass
   and g.grantee in (select oid from pg_roles where rolname in ('postgres','service_role'))),
 'rows',(select jsonb_agg(to_jsonb(l) order by id) from public.courier_locations l)
) as value;
create table sequence_test.snapshot as select value from sequence_test.unchanged;
create table sequence_test.counter as
 select last_value,is_called from public.courier_locations_id_seq;
