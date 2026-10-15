-- Synthetic identities only. All data lives in a disposable test database.
insert into auth.users(id,email) select gps_test.id(n),'courier-'||n||'@fixture.invalid' from generate_series(8,12)n;
create role invite_courier_a login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
create role invite_courier_b login inherit nosuperuser nocreatedb nocreaterole nobypassrls in role authenticated;
insert into public.orders(restaurant_id,customer_name,customer_phone,delivery_address)
 values(gps_test.id(101),'Synthetic customer A','000000000','Fictional A'),
 (gps_test.id(102),'Synthetic customer B','000000000','Fictional B');
create schema onboard_test;
create function onboard_test.check(label text,ok boolean) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ONBOARD CHECK: %',label;end if;raise notice 'PASS: %',label;end;$$;
grant usage on schema onboard_test to anon,authenticated;
grant execute on function onboard_test.check(text,boolean) to anon,authenticated;
create table onboard_test.snapshot as select
 (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p) policies,
 (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d) defaults,
 (select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass) sequence_acl;
insert into public.courier_invites(id,restaurant_id,code,created_by,expires_at,max_uses)
 values(gps_test.id(801),gps_test.id(101),'aaaaaaaaaaaaaaaa0001',gps_test.id(1),now()+interval '1 day',1),
 (gps_test.id(802),gps_test.id(102),'aaaaaaaaaaaaaaaa0002',gps_test.id(2),now()+interval '1 day',2),
 (gps_test.id(803),gps_test.id(102),'aaaaaaaaaaaaaaaa0003',gps_test.id(2),now()-interval '1 second',2),
 (gps_test.id(804),gps_test.id(102),'aaaaaaaaaaaaaaaa0004',gps_test.id(2),now()+interval '1 day',2),
 (gps_test.id(805),gps_test.id(102),'aaaaaaaaaaaaaaaa0005',gps_test.id(2),now()+interval '1 day',1),
 (gps_test.id(806),gps_test.id(101),'aaaaaaaaaaaaaaaa0006',gps_test.id(1),now()+interval '1 day',1),
 (gps_test.id(807),gps_test.id(102),'aaaaaaaaaaaaaaaa0007',gps_test.id(2),now()+interval '1 day',2),
 (gps_test.id(808),gps_test.id(102),'aaaaaaaaaaaaaaaa0008',gps_test.id(2),now()+interval '1 day',2);
update public.courier_invites set active=false where id=gps_test.id(804);
update public.courier_invites set used_count=1 where id=gps_test.id(805);
