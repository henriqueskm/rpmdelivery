-- Run only on a disposable local database with all migrations applied.
-- Assumes a test Auth fixture whose auth.uid() reads request.jwt.claim.sub.
begin;

do $$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_id uuid;
  v_count bigint;
  v_bad_lat double precision;
  v_bad_phone text;
begin
  if to_regprocedure('public.create_restaurant(text,text,text)') is not null then
    raise exception 'Old overload remains';
  end if;
  if has_function_privilege('anon', 'public.create_restaurant(text,text,text,double precision,double precision,text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.create_restaurant(text,text,text,double precision,double precision,text,text)', 'EXECUTE') then
    raise exception 'Unexpected EXECUTE privileges';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.restaurants'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.restaurant_members'::regclass) then
    raise exception 'RLS disabled';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.create_restaurant('Teste', 'Rua Teste', null, -23.55, -46.63, 'mapbox', 'test_id');
    raise exception 'Anonymous call accepted';
  exception when invalid_authorization_specification then null;
  end;
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  begin
    perform public.create_restaurant('Teste', 'Rua Teste', null, -23.55, -46.63, 'mapbox', 'test_id');
    raise exception 'Missing profile accepted';
  exception when no_data_found then null;
  end;
  insert into auth.users (id, email) values (v_user, 'fixture@example.test');
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  v_id := public.create_restaurant('Teste', 'Rua Teste', '(11) 91234-5678', -23.55, -46.63, 'mapbox', 'test_id');
  if not exists (select 1 from public.restaurants where id = v_id
    and phone = '+5511912345678' and latitude = -23.55 and longitude = -46.63
    and address_provider = 'mapbox' and address_provider_id = 'test_id') then
    raise exception 'Incorrect persisted fields';
  end if;
  if not exists (select 1 from public.restaurant_members where restaurant_id = v_id
    and user_id = v_user and role = 'OWNER' and active) then
    raise exception 'OWNER missing';
  end if;
  -- A second legitimate restaurant remains permitted by the data model.
  v_id := public.create_restaurant('Outra operação', 'Rua Outra', null, 0, 0, 'mapbox', 'another_id');
  if (select phone from public.restaurants where id = v_id) is not null then
    raise exception 'Optional phone not null';
  end if;

  select count(*) into v_count from public.restaurants;
  foreach v_bad_phone in array array['1191234567', '11812345678', 'abc11912345678', '01912345678', '+11912345678'] loop
    begin
      perform public.create_restaurant('Invalid', 'Rua Teste', v_bad_phone, 0, 0, 'mapbox', 'test_id');
      raise exception 'Invalid mobile accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  foreach v_bad_lat in array array[91, -91, 'NaN'::double precision, 'Infinity'::double precision, null] loop
    begin
      perform public.create_restaurant('Invalid', 'Rua Teste', null, v_bad_lat, 0, 'mapbox', 'test_id');
      raise exception 'Invalid latitude accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.create_restaurant('Invalid', 'Rua Teste', null, 0, 181, 'mapbox', 'test_id');
    raise exception 'Invalid longitude accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_restaurant('Invalid', 'Rua Teste', null, 0, 0, null, 'test_id');
    raise exception 'Invalid provider accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.restaurants) <> v_count then
    raise exception 'Invalid calls wrote rows';
  end if;
end;
$$;

rollback;
