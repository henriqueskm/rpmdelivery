-- Synthetic identities only; applied exclusively by the disposable runner.
create schema gps_test;
create function gps_test.id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function gps_test.check(label text, ok boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if ok is not true then raise exception 'GPS CHECK FAILED: %',label; end if;
 raise notice 'PASS: %',label;
end; $$;
grant usage on schema gps_test to anon,authenticated;
grant execute on function gps_test.id(integer),gps_test.check(text,boolean) to anon,authenticated;
create role gps_owner_a login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_owner_b login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_courier login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_operator_b login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_manager_b login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_inactive_b login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_outsider login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role gps_anon login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role anon;
create role authenticator login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant anon,authenticated to authenticator;
-- HTTP tests use signed, synthetic JWTs, not privileged credentials.
create or replace function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
insert into auth.users(id,email) select gps_test.id(n),'synthetic-'||n||'@fixture.invalid' from generate_series(1,7)n;
insert into public.restaurants(id,name,address) values
 (gps_test.id(101),'Synthetic A','Fictional A'),(gps_test.id(102),'Synthetic B','Fictional B');
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (gps_test.id(101),gps_test.id(1),'OWNER',true),
 (gps_test.id(102),gps_test.id(2),'OWNER',true),
 (gps_test.id(102),gps_test.id(4),'OPERATOR',true),
 (gps_test.id(102),gps_test.id(5),'MANAGER',true),
 (gps_test.id(102),gps_test.id(6),'OWNER',false);
insert into public.couriers(id,user_id,motorcycle_model,last_latitude,last_longitude,location_updated_at)
 values(gps_test.id(201),gps_test.id(3),'Synthetic motorcycle',-10,-40,now());
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status) values
 (gps_test.id(301),gps_test.id(101),gps_test.id(201),'ACTIVE'),
 (gps_test.id(302),gps_test.id(102),gps_test.id(201),'REJECTED');
insert into public.courier_shifts(id,restaurant_id,courier_id,restaurant_courier_id,status) values
 (gps_test.id(401),gps_test.id(101),gps_test.id(201),gps_test.id(301),'ON_ROUTE'),
 (gps_test.id(402),gps_test.id(102),gps_test.id(201),gps_test.id(302),'ENDED');
insert into public.routes(id,restaurant_id,courier_id,courier_shift_id,status) values
 (gps_test.id(501),gps_test.id(101),gps_test.id(201),gps_test.id(401),'ON_ROUTE'),
 (gps_test.id(502),gps_test.id(102),gps_test.id(201),gps_test.id(402),'COMPLETED');
insert into public.courier_locations(courier_id,route_id,latitude,longitude) values
 (gps_test.id(201),gps_test.id(501),-10,-40),
 (gps_test.id(201),gps_test.id(502),-20,-50);

-- Full snapshot: nothing outside the two helper bodies / courier SELECT may change.
create view gps_test.unchanged as select jsonb_build_object(
 'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'sequence',(select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass),
 'service_columns',(select jsonb_agg(has_column_privilege('service_role',a.attrelid,a.attnum,'SELECT') order by a.attnum) from pg_attribute a where a.attrelid='public.couriers'::regclass and a.attnum>0 and not a.attisdropped),
 'helper_permissions',(select jsonb_agg(jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('can_view_courier','can_view_profile')),
 'rpc',(select jsonb_agg(jsonb_build_object('oid',p.oid,'body',p.prosrc,'acl',p.proacl,'config',p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname not in ('can_view_courier','can_view_profile'))
) as value;
create table gps_test.snapshot as select value from gps_test.unchanged;
