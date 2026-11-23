-- Contracts for set_default_promise (migration 20261201120000). Store A (101): owner 1, operator 2.
-- Owner B (4), outsider (8). core_test.try_as comes from courier-card-contracts.sql.
-- A write is only visible to the next statement: each call is stored first, then checked.

select set_config('core.promise_before',
 (select default_delivery_promise_minutes from public.restaurants where id = core_test.id(101))::text, false);
create function core_test.promise() returns integer language sql as $$
 select default_delivery_promise_minutes from public.restaurants where id = core_test.id(101) $$;

select set_config('core.p1', core_test.try_as(2, format('select public.set_default_promise(%L, %s)', core_test.id(101), 45)), false);
select core_test.check('the operator changes the default promise of the store',
 current_setting('core.p1') = 'ok' and core_test.promise() = 45);

select set_config('core.p2', core_test.try_as(1, format('select public.set_default_promise(%L, %s)', core_test.id(101), 1)), false);
select set_config('core.p3', core_test.try_as(1, format('select public.set_default_promise(%L, %s)', core_test.id(101), 240)), false);
select core_test.check('the owner too, and the limits 1 and 240 are accepted',
 current_setting('core.p2') = 'ok' and current_setting('core.p3') = 'ok' and core_test.promise() = 240);

select set_config('core.p4', concat_ws(',',
 core_test.try_as(1, format('select public.set_default_promise(%L, %s)', core_test.id(101), 0)),
 core_test.try_as(1, format('select public.set_default_promise(%L, %s)', core_test.id(101), 241)),
 core_test.try_as(1, format('select public.set_default_promise(%L, null)', core_test.id(101)))), false);
select core_test.check('out of 1..240 or empty is refused and changes nothing',
 current_setting('core.p4') = '22023,22023,22023' and core_test.promise() = 240);

select set_config('core.p5', concat_ws(',',
 core_test.try_as(4, format('select public.set_default_promise(%L, %s)', core_test.id(101), 30)),
 core_test.try_as(8, format('select public.set_default_promise(%L, %s)', core_test.id(101), 30))), false);
select core_test.check('another store and outsiders are refused',
 current_setting('core.p5') = '42501,42501' and core_test.promise() = 240);

select core_test.check('signed-in users only',
 not has_function_privilege('anon', 'public.set_default_promise(uuid, integer)', 'EXECUTE')
 and has_function_privilege('authenticated', 'public.set_default_promise(uuid, integer)', 'EXECUTE'));

select core_test.check('the board shows the new default',
 (core_test.as_actor(2, format('select public.get_operations_board(%L)', core_test.id(101)))
   ->'restaurant'->>'defaultPromiseMinutes')::integer = 240);

-- Back to how it was for the next files.
update public.restaurants set default_delivery_promise_minutes = current_setting('core.promise_before')::integer
 where id = core_test.id(101);
drop function core_test.promise();
