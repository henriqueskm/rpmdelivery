-- Synthetic identities only. Disposable database; never hosted Supabase.
create schema core_test;
create function core_test.id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid
$$;
create function core_test.check(label text, ok boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if ok is not true then raise exception 'CORE CHECK FAILED: %',label; end if;
 raise notice 'PASS: %',label;
end; $$;
-- Runs a statement as the current role and asserts the SQLSTATE it raises.
create function core_test.expect(label text, statement text, expected text) returns void
language plpgsql security invoker set search_path='' as $$
declare actual text;
begin
 begin
  execute statement;
  actual := 'no error';
 exception when others then
  actual := sqlstate;
 end;
 if actual is distinct from expected then
  raise exception 'CORE CHECK FAILED: % (expected %, got %)',label,expected,actual;
 end if;
 raise notice 'PASS: %',label;
end; $$;
create function core_test.act(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',core_test.id(n)::text,false);
$$;
grant usage on schema core_test to anon,authenticated;
grant execute on all functions in schema core_test to anon,authenticated;

-- 1 owner A, 2 operator A, 3 inactive owner A, 4 owner B,
-- 5 courier X (complete, ACTIVE in A and B), 6 courier Y (PENDING in A),
-- 7 courier Z (incomplete, ACTIVE in A), 8 outsider, 9 courier W (ACTIVE in A),
-- 10 courier V (ACTIVE in A and B; reserved for PostgreSQL concurrency races),
-- 11/12 couriers U/T (ACTIVE in A; PostgreSQL route races), 13 courier R (ACTIVE in A),
-- 14/15 couriers Q/S (ACTIVE in A; PostgreSQL route execution races).
insert into auth.users(id,email,raw_user_meta_data)
 select core_test.id(n),'core-'||n||'@fixture.invalid',jsonb_build_object('name','Synthetic '||n)
 from generate_series(1,15) n;
insert into public.restaurants(id,name,address) values
 (core_test.id(101),'Synthetic A','Fictional A'),
 (core_test.id(102),'Synthetic B','Fictional B');
update public.restaurants set default_delivery_promise_minutes=45 where id=core_test.id(102);
insert into public.restaurant_members(restaurant_id,user_id,role,active) values
 (core_test.id(101),core_test.id(1),'OWNER',true),
 (core_test.id(101),core_test.id(2),'OPERATOR',true),
 (core_test.id(101),core_test.id(3),'OWNER',false),
 (core_test.id(102),core_test.id(4),'OWNER',true);
insert into public.couriers(id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color) values
 (core_test.id(205),core_test.id(5),'Moto X','AAA1A11','Preta'),
 (core_test.id(206),core_test.id(6),'Moto Y','BBB1B11','Azul'),
 (core_test.id(207),core_test.id(7),null,null,null),
 (core_test.id(209),core_test.id(9),'Moto W','CCC1C11','Branca'),
 (core_test.id(210),core_test.id(10),'Moto V','DDD1D11','Vermelha'),
 (core_test.id(211),core_test.id(11),'Moto U','EEE1E11','Cinza'),
 (core_test.id(212),core_test.id(12),'Moto T','FFF1F11','Verde'),
 (core_test.id(213),core_test.id(13),'Moto R','GGG1G11','Prata'),
 (core_test.id(214),core_test.id(14),'Moto Q','HHH1H11','Amarela'),
 (core_test.id(215),core_test.id(15),'Moto S','JJJ1J11','Roxa');
insert into public.restaurant_couriers(id,restaurant_id,courier_id,status) values
 (core_test.id(305),core_test.id(101),core_test.id(205),'ACTIVE'),
 (core_test.id(315),core_test.id(102),core_test.id(205),'ACTIVE'),
 (core_test.id(306),core_test.id(101),core_test.id(206),'PENDING'),
 (core_test.id(307),core_test.id(101),core_test.id(207),'ACTIVE'),
 (core_test.id(309),core_test.id(101),core_test.id(209),'ACTIVE'),
 (core_test.id(310),core_test.id(101),core_test.id(210),'ACTIVE'),
 (core_test.id(320),core_test.id(102),core_test.id(210),'ACTIVE'),
 (core_test.id(311),core_test.id(101),core_test.id(211),'ACTIVE'),
 (core_test.id(312),core_test.id(101),core_test.id(212),'ACTIVE'),
 (core_test.id(313),core_test.id(101),core_test.id(213),'ACTIVE'),
 (core_test.id(334),core_test.id(101),core_test.id(214),'ACTIVE'),
 (core_test.id(335),core_test.id(101),core_test.id(215),'ACTIVE');
