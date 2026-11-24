-- Contracts for the notice "a loja encerrou seu turno" (migration 20261206120000). Runs after
-- day-close-contracts.sql: in store F (106) the owner (46) closed the day, which ended the shifts of
-- courier 47 (couriers.id 251) and 49 (253); 48 (252) was still out on a route. Each file runs in its
-- own session, so the ids are looked up again here.
select core_test.check('the courier whose shift the store ended is told who and when',
 (select (h->'shiftEndedByStore'->>'restaurantName') = 'Synthetic F'
    and (h->'shiftEndedByStore'->>'shiftId')::uuid = (select id from public.courier_shifts
      where courier_id = core_test.id(251) order by requested_at desc, id desc limit 1)
    and (h->'shiftEndedByStore'->>'endedAt') is not null
    and h->'shift' = 'null'::jsonb
  from (select core_test.as_actor(47, $s$select public.get_courier_home()$s$) as h) x));

-- 48 comes back and ends the shift on their own: nothing to tell.
select core_test.as_actor(48, format($s$select public.arrive_at_store(%L)$s$,
 (select id from public.routes where courier_id = core_test.id(252) and status = 'RETURNING')));
select core_test.as_actor(48, format($s$select to_jsonb(public.end_shift(%L))$s$,
 (select id from public.courier_shifts where courier_id = core_test.id(252) and status = 'AVAILABLE')));
select core_test.check('a shift the courier ended on their own says nothing',
 core_test.as_actor(48, $s$select public.get_courier_home()$s$)->'shiftEndedByStore' = 'null'::jsonb);

-- 49 asks for a new shift: the old notice goes away.
select core_test.as_actor(49, $s$select public.request_shift(core_test.id(106))$s$);
select core_test.check('a newer shift replaces the notice',
 core_test.as_actor(49, $s$select public.get_courier_home()$s$)->'shiftEndedByStore' = 'null'::jsonb);
-- Leave 49's request as it was before this file (no open shift), for whatever runs next.
select core_test.as_actor(49, format($s$select to_jsonb(public.end_shift(%L))$s$,
 (select id from public.courier_shifts where courier_id = core_test.id(253) and status = 'PENDING')));

select core_test.check('only an old notice is shown: after 12 hours it is gone',
 (select (core_test.as_actor(47, $s$select public.get_courier_home()$s$)->'shiftEndedByStore') is not null)
 and (select count(*) = 1 from public.courier_shifts where courier_id = core_test.id(251)
   and ended_at >= clock_timestamp() - interval '12 hours'));
update public.courier_shifts set ended_at = clock_timestamp() - interval '13 hours'
 where courier_id = core_test.id(251) and status = 'ENDED';
select core_test.check('a notice older than 12 hours is not shown',
 core_test.as_actor(47, $s$select public.get_courier_home()$s$)->'shiftEndedByStore' = 'null'::jsonb);

select core_test.check('the home core is out of the API; the home still is for signed-in users',
 not has_function_privilege('authenticated', 'private.courier_home_core()', 'EXECUTE')
 and has_function_privilege('authenticated', 'public.get_courier_home()', 'EXECUTE')
 and not has_function_privilege('anon', 'public.get_courier_home()', 'EXECUTE')
 and (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.get_courier_home()'::regprocedure));
