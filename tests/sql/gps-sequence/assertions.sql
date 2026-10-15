select sequence_test.check('only sequence API grants changed',
 (select value from sequence_test.snapshot)=(select value from sequence_test.unchanged));
select sequence_test.check('sequence value/is_called preserved',
 (select row(last_value,is_called) from sequence_test.counter)=
 (select row(last_value,is_called) from public.courier_locations_id_seq));
select sequence_test.check('no effective API sequence privilege',not exists(
 select 1 from (values('anon'),('authenticated')) r(name)
 cross join (values('USAGE'),('SELECT'),('UPDATE')) p(name)
 where has_sequence_privilege(r.name,'public.courier_locations_id_seq',p.name)));
select sequence_test.check('no PUBLIC/anon/authenticated ACL entry',not exists(
 select 1 from pg_class c cross join lateral aclexplode(c.relacl) g
 where c.oid='public.courier_locations_id_seq'::regclass
 and g.grantee in (0,'anon'::regrole,'authenticated'::regrole)));
select sequence_test.check('postgres/service_role retain all three privileges',not exists(
 select 1 from (values('postgres'),('service_role')) r(name)
 cross join (values('USAGE'),('SELECT'),('UPDATE')) p(name)
 where not has_sequence_privilege(r.name,'public.courier_locations_id_seq',p.name)));
select sequence_test.check('PR19 GPS remains inaccessible',not exists(
 select 1 from (values('anon'),('authenticated')) r(name)
 cross join (values('last_latitude'),('last_longitude'),('location_updated_at')) c(name)
 where has_column_privilege(r.name,'public.couriers',c.name,'SELECT')));
select sequence_test.check('PR19 seven columns remain readable',(
 select count(*)=7 from pg_attribute a where a.attrelid='public.couriers'::regclass
 and a.attnum>0 and not a.attisdropped
 and has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')));
select r.name as role,p.name as privilege,
 has_sequence_privilege(r.name,'public.courier_locations_id_seq',p.name) as allowed
 from (values('anon'),('authenticated'),('postgres'),('service_role')) r(name)
 cross join (values('USAGE'),('SELECT'),('UPDATE')) p(name);
