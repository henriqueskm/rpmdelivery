-- Contracts for route suggestions phase 2 (migration 20261127120000): the store's cache of street
-- times and its suggestion limits. Store A (101): owner 1, operator 2. Owner B (4), outsider (8).
-- core_test.try_as comes from courier-card-contracts.sql.

select set_config('core.legs', jsonb_build_array(
  jsonb_build_object('fromLatitude', -23.000001, 'fromLongitude', -46.8, 'toLatitude', -23.005, 'toLongitude', -46.8, 'seconds', 95, 'meters', 700),
  jsonb_build_object('fromLatitude', -23.005, 'fromLongitude', -46.8, 'toLatitude', -23.0, 'toLongitude', -46.8, 'seconds', 101, 'meters', 720)
)::text, false);
select set_config('core.points', '[{"latitude": -23.0, "longitude": -46.8}, {"latitude": -23.005, "longitude": -46.8}, {"latitude": -23.03, "longitude": -46.8}]', false);

select core_test.check('the operator saves street times for the store',
 core_test.as_actor(2, format('select public.save_route_legs(%L, %L::jsonb)', core_test.id(101), current_setting('core.legs')))->>'saved' = '2');
select core_test.check('and reads them back as point indexes, rounded to 5 decimals; unknown legs are absent',
 core_test.as_actor(1, format('select public.read_route_legs(%L, %L::jsonb)', core_test.id(101), current_setting('core.points')))
  = '[{"from": 0, "to": 1, "meters": 700, "seconds": 95}, {"from": 1, "to": 0, "meters": 720, "seconds": 101}]'::jsonb);
select core_test.check('saving the same leg again updates it',
 core_test.as_actor(2, format('select public.save_route_legs(%L, %L::jsonb)', core_test.id(101),
  '[{"fromLatitude": -23.0, "fromLongitude": -46.8, "toLatitude": -23.005, "toLongitude": -46.8, "seconds": 90, "meters": 690}]'))->>'saved' = '1');
-- A new statement: the one above cannot see its own function's write.
select core_test.check('with the new time',
 (select seconds from private.route_legs where restaurant_id = core_test.id(101) and from_latitude = -23.0 and to_latitude = -23.005) = 90);
select core_test.check('another store never sees them',
 core_test.as_actor(4, format('select public.read_route_legs(%L, %L::jsonb)', core_test.id(102), current_setting('core.points'))) = '[]'::jsonb);
select core_test.check('nor reads or writes the store''s cache',
 core_test.try_as(4, format('select public.read_route_legs(%L, %L::jsonb)', core_test.id(101), current_setting('core.points'))) = '42501'
 and core_test.try_as(8, format('select public.save_route_legs(%L, %L::jsonb)', core_test.id(101), current_setting('core.legs'))) = '42501');
select core_test.check('out-of-range times and oversized lists are refused',
 core_test.try_as(2, format('select public.save_route_legs(%L, %L::jsonb)', core_test.id(101),
  '[{"fromLatitude": -23.0, "fromLongitude": -46.8, "toLatitude": -23.1, "toLongitude": -46.8, "seconds": -5, "meters": 10}]')) = '22023'
 and core_test.try_as(2, format('select public.save_route_legs(%L, %L::jsonb)', core_test.id(101),
  '[{"fromLatitude": "x", "fromLongitude": -46.8, "toLatitude": -23.1, "toLongitude": -46.8, "seconds": 5, "meters": 10}]')) = '22023'
 and core_test.try_as(2, format('select public.read_route_legs(%L, %L::jsonb)', core_test.id(101),
  (select jsonb_agg(jsonb_build_object('latitude', -23, 'longitude', -46.8)) from generate_series(1, 61))::text)) = '22023');
select core_test.check('legs older than 90 days are asked again',
 (select count(*) from private.route_legs where restaurant_id = core_test.id(101)) = 2);
update private.route_legs set fetched_at = now() - interval '91 days' where restaurant_id = core_test.id(101) and to_latitude = -23.0;
select core_test.check('so only the fresh one is answered',
 jsonb_array_length(core_test.as_actor(1, format('select public.read_route_legs(%L, %L::jsonb)', core_test.id(101), current_setting('core.points')))) = 1);
select core_test.check('the cache table is never reachable directly',
 not has_table_privilege('authenticated', 'private.route_legs', 'SELECT')
 and not has_table_privilege('authenticated', 'private.route_legs', 'INSERT'));

-- ---------------------------------------------------------
-- The store's limits
-- ---------------------------------------------------------
select core_test.check('new stores start with 8 stops, 7 min of detour and 1.5 km between neighbors',
 core_test.as_actor(2, format('select public.get_route_settings(%L)', core_test.id(101)))
  = '{"maxStops": 8, "maxDetourMinutes": 7, "neighborMeters": 1500, "canEdit": false}'::jsonb);
select core_test.check('the owner changes them',
 core_test.as_actor(1, format('select public.set_route_settings(%L, 5, 12, 2500)', core_test.id(101)))
  = '{"maxStops": 5, "maxDetourMinutes": 12, "neighborMeters": 2500, "canEdit": true}'::jsonb);
select core_test.check('the operator cannot',
 core_test.try_as(2, format('select public.set_route_settings(%L, 8, 10, 2000)', core_test.id(101))) = '42501');
select core_test.check('values out of range are refused',
 core_test.try_as(1, format('select public.set_route_settings(%L, 9, 10, 2000)', core_test.id(101))) = '22023'
 and core_test.try_as(1, format('select public.set_route_settings(%L, 8, 61, 2000)', core_test.id(101))) = '22023'
 and core_test.try_as(1, format('select public.set_route_settings(%L, 8, 10, 10001)', core_test.id(101))) = '22023');
select core_test.check('another store reads neither',
 core_test.try_as(4, format('select public.get_route_settings(%L)', core_test.id(101))) = '42501');
-- Back to the defaults for anything after this file.
select core_test.as_actor(1, format('select public.set_route_settings(%L, 8, 7, 1500)', core_test.id(101)));
select core_test.check('only signed-in users call these',
 not has_function_privilege('anon', 'public.read_route_legs(uuid, jsonb)', 'EXECUTE')
 and not has_function_privilege('anon', 'public.save_route_legs(uuid, jsonb)', 'EXECUTE')
 and not has_function_privilege('anon', 'public.get_route_settings(uuid)', 'EXECUTE')
 and not has_function_privilege('anon', 'public.set_route_settings(uuid, integer, integer, integer)', 'EXECUTE'));
