-- Contracts for get_neighborhood_centers (migration 20261129120000). Store A (101): operator 2.
-- Owner B (4). core_test.try_as comes from courier-card-contracts.sql. Orders here use the phone
-- +5511955554433, never used elsewhere, and are deleted at the end.
insert into public.orders(restaurant_id, customer_name, customer_phone, delivery_address, neighborhood,
  latitude, longitude, address_provider, address_provider_id, ordered_at) values
 (core_test.id(101), 'C1', '+5511955554433', 'Rua 1', 'Vila Zeta', -23.10, -46.90, 'mapbox', 'centro_1', now()),
 (core_test.id(101), 'C2', '+5511955554433', 'Rua 2', ' vila zeta ', -23.20, -46.80, 'mapbox', 'centro_2', now()),
 -- Without a pin, too old, or another store: never counted.
 (core_test.id(101), 'C3', '+5511955554433', 'Rua 3', 'Vila Zeta', null, null, null, null, now()),
 (core_test.id(101), 'C4', '+5511955554433', 'Rua 4', 'Vila Zeta', -30.0, -50.0, 'mapbox', 'centro_4', now() - interval '200 days'),
 (core_test.id(102), 'C5', '+5511955554433', 'Rua 5', 'Vila Zeta', -10.0, -40.0, 'mapbox', 'centro_5', now());

select set_config('core.centers', core_test.as_actor(2, format('select public.get_neighborhood_centers(%L)', core_test.id(101)))::text, false);
select core_test.check('the center of a bairro is the average pin of its recent orders, whatever the spelling case',
 exists (select 1 from jsonb_array_elements(current_setting('core.centers')::jsonb) c
  where lower(btrim(c->>'neighborhood')) = 'vila zeta' and (c->>'orders')::int = 2
    and (c->>'latitude')::numeric = -23.15 and (c->>'longitude')::numeric = -46.85));
select core_test.check('only the store''s own bairros',
 not exists (select 1 from jsonb_array_elements(core_test.as_actor(4, format('select public.get_neighborhood_centers(%L)', core_test.id(102)))) c
  where (c->>'latitude')::numeric = -23.15));
select core_test.check('another store and outsiders are refused',
 core_test.try_as(4, format('select public.get_neighborhood_centers(%L)', core_test.id(101))) = '42501'
 and core_test.try_as(8, format('select public.get_neighborhood_centers(%L)', core_test.id(101))) = '42501');
select core_test.check('signed-in users only',
 not has_function_privilege('anon', 'public.get_neighborhood_centers(uuid)', 'EXECUTE'));
delete from public.orders where customer_phone = '+5511955554433';
