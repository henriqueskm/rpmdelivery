-- Fictional accounts and data; rollback leaves the fixture unchanged.
begin;
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','owner-a@fixture.invalid'),
  ('22222222-2222-4222-8222-222222222222','owner-b@fixture.invalid');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set role authenticated;
do $$
declare v_restaurant uuid; v_courier uuid;
begin
  v_restaurant := public.create_restaurant('Fixture A','Rua fictícia A',null,0,0,'mapbox','fixture_a');
  perform set_config('privilege_test.restaurant_a',v_restaurant::text,true);
  if not exists(select 1 from public.restaurant_members
    where restaurant_id=v_restaurant and user_id=auth.uid() and role='OWNER' and active) then
    raise exception 'Authenticated create_restaurant or OWNER read failed';
  end if;
  v_courier := public.create_courier_profile('Moto fictícia',null,null);
  if v_courier is distinct from public.create_courier_profile(null,null,null)
    or not exists(select 1 from public.couriers where id=v_courier and user_id=auth.uid()) then
    raise exception 'Authenticated/idempotent create_courier_profile failed';
  end if;
  update public.profiles set name='Fixture atualizada' where id=auth.uid();
  if not exists(select 1 from public.profiles where id=auth.uid() and name='Fixture atualizada') then
    raise exception 'Explicit profile column grant failed';
  end if;
  begin insert into public.restaurants(name,address) values('Forbidden','Forbidden');
    raise exception 'Direct restaurant INSERT allowed'; exception when insufficient_privilege then null; end;
  begin update public.restaurant_members set role='OPERATOR' where restaurant_id=v_restaurant;
    raise exception 'Direct membership UPDATE allowed'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set role authenticated;
do $$
declare v_restaurant uuid;
begin
  if exists(select 1 from public.restaurants
    where id=current_setting('privilege_test.restaurant_a')::uuid)
    or exists(select 1 from public.profiles where id='11111111-1111-4111-8111-111111111111') then
    raise exception 'Cross-tenant RLS failed';
  end if;
  v_restaurant := public.create_restaurant('Fixture B','Rua fictícia B',null,0,0,'mapbox','fixture_b');
  if (select count(*) from public.restaurants) <> 1
    or not exists(select 1 from public.restaurants where id=v_restaurant) then
    raise exception 'Legitimate tenant SELECT failed';
  end if;
end;
$$;
reset role;
set role anon;
do $$
begin
  begin perform public.create_restaurant('Forbidden','Forbidden',null,0,0,'mapbox','fixture');
    raise exception 'anon RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.create_courier_profile(null,null,null);
    raise exception 'anon courier RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.restaurants;
    raise exception 'anon SELECT allowed'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'PASS: authenticated RPCs, profile grant, denied direct writes and two-tenant RLS' as result;
