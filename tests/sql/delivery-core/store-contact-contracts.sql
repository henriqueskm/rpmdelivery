-- Contracts for Estabelecimentos in the courier app (migration 20261124120000).
-- Runs after push-contracts.sql: courier F (21, courier row 221) linked ACTIVE to store C (103),
-- whose address and pin were set in distance-contracts.sql (phone cleared there).
update public.restaurants set phone='+5511987650099' where id=core_test.id(103);
-- A refused link to store A and a pending one to store B.
insert into public.restaurant_couriers(restaurant_id,courier_id,status)
 values (core_test.id(101),core_test.id(221),'REJECTED'),(core_test.id(102),core_test.id(221),'PENDING')
 on conflict (restaurant_id,courier_id) do update set status=excluded.status;
select set_config('core.home_f',core_test.as_actor(21,'select public.get_courier_home()')::text,false);

select core_test.check('an approved store carries its phone, address and pin',
 exists (select 1 from jsonb_array_elements(current_setting('core.home_f')::jsonb->'stores') s
  where (s->>'restaurantId')::uuid=core_test.id(103) and s->>'linkStatus'='ACTIVE'
    and s->>'phone'='+5511987650099' and s->>'address'='Rua Loja 9, Itatiba'
    and (s->>'latitude')::double precision=-23.0059 and (s->>'longitude')::double precision=-46.8390));
select core_test.check('a pending store shows only its name',
 exists (select 1 from jsonb_array_elements(current_setting('core.home_f')::jsonb->'stores') s
  where (s->>'restaurantId')::uuid=core_test.id(102) and s->>'linkStatus'='PENDING'
    and s->'phone'='null'::jsonb and s->'address'='null'::jsonb and s->'latitude'='null'::jsonb));
select core_test.check('a refused link is listed apart, with when, and never among the stores that ask for shifts',
 exists (select 1 from jsonb_array_elements(current_setting('core.home_f')::jsonb->'refusedStores') s
  where (s->>'restaurantId')::uuid=core_test.id(101) and s->>'linkStatus'='REJECTED' and s->>'since' is not null
    and s->'phone' is null and s->'address' is null)
 and not exists (select 1 from jsonb_array_elements(current_setting('core.home_f')::jsonb->'stores') s
  where (s->>'restaurantId')::uuid=core_test.id(101)));
select core_test.check('another courier never sees these links',
 not exists (select 1 from jsonb_array_elements(core_test.as_actor(9,'select public.get_courier_home()')->'refusedStores') s
  where (s->>'restaurantId')::uuid=core_test.id(101)));
-- Leave the links as they were for anything after this file.
delete from public.restaurant_couriers where courier_id=core_test.id(221) and restaurant_id in (core_test.id(101),core_test.id(102));
select core_test.check('the home stays for signed-in couriers only',
 has_function_privilege('authenticated','public.get_courier_home()','EXECUTE')
 and not has_function_privilege('anon','public.get_courier_home()','EXECUTE'));
