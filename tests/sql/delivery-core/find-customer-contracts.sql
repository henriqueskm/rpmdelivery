-- Contracts for find_customer (migration 20261128120000). Store A (101): owner 1, operator 2.
-- Owner B (4), outsider (8). core_test.try_as comes from courier-card-contracts.sql.
insert into public.orders(restaurant_id, customer_name, customer_phone, delivery_address, neighborhood, complement,
  latitude, longitude, address_provider, address_provider_id, ordered_at, status) values
 (core_test.id(101), 'Helena Antiga', '+5511955554411', 'Rua Velha, 10', 'Centro', null, null, null, null, null,
  now() - interval '3 days', 'DELIVERED'),
 (core_test.id(101), 'Helena Prado', '+5511955554411', 'Rua das Acácias, 55', 'Bela Vista', 'Apto 12',
  -23.5, -46.6, 'mapbox', 'dXJuOm1ieGFkcjp0ZXN0', now() - interval '1 day', 'DELIVERED'),
 (core_test.id(101), 'Helena Prado', '+5511955554411', 'Rua das Acácias, 55', 'Bela Vista', 'Apto 12',
  null, null, null, null, now() - interval '2 days', 'CANCELLED'),
 (core_test.id(102), 'Helena em B', '+5511955554411', 'Rua de B, 1', 'Outro', null, null, null, null, null,
  now(), 'DELIVERED');

select set_config('core.customer', core_test.as_actor(2, format('select public.find_customer(%L, %L)',
  core_test.id(101), '(11) 95555-4411'))::text, false);
select core_test.check('the operator finds the last order of the number, typed in any format',
 current_setting('core.customer')::jsonb - 'lastOrderAt' = '{"name": "Helena Prado", "address": "Rua das Acácias, 55",
   "neighborhood": "Bela Vista", "complement": "Apto 12",
   "location": {"latitude": -23.5, "longitude": -46.6, "providerId": "dXJuOm1ieGFkcjp0ZXN0"}, "orders": 2}'::jsonb);
select core_test.check('only this store''s orders count, never another store''s',
 core_test.as_actor(4, format('select public.find_customer(%L, %L)', core_test.id(102), '11955554411'))->>'name' = 'Helena em B');
select core_test.check('an unknown number or a malformed one answers nothing',
 core_test.as_actor(1, format('select public.find_customer(%L, %L)', core_test.id(101), '11911112222')) is null
 and core_test.as_actor(1, format('select public.find_customer(%L, %L)', core_test.id(101), '123')) is null);
insert into public.orders(restaurant_id, customer_name, customer_phone, delivery_address, neighborhood, ordered_at)
 values (core_test.id(101), 'Rui Texto', '+5511955554422', 'Rua Sem Pino, 5', 'Centro', now());
select core_test.check('an order typed without the search carries no pin',
 core_test.as_actor(1, format('select public.find_customer(%L, %L)', core_test.id(101), '11955554422'))
  @> '{"name": "Rui Texto", "location": null, "orders": 1}'::jsonb);
select core_test.check('another store and outsiders are refused',
 core_test.try_as(4, format('select public.find_customer(%L, %L)', core_test.id(101), '11955554411')) = '42501'
 and core_test.try_as(8, format('select public.find_customer(%L, %L)', core_test.id(101), '11955554411')) = '42501');
select core_test.check('signed-in users only',
 not has_function_privilege('anon', 'public.find_customer(uuid, text)', 'EXECUTE')
 and has_function_privilege('authenticated', 'public.find_customer(uuid, text)', 'EXECUTE'));
-- Leave the orders as they were for anything after this file.
delete from public.orders where customer_phone in ('+5511955554411', '+5511955554422');
