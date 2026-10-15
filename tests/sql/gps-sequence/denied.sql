-- Connected directly as anon/authenticated, without admin SET ROLE.
select sequence_test.check('unprivileged direct login',
 current_user in ('anon','authenticated') and not exists(
 select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)));
do $$begin
 begin perform nextval('public.courier_locations_id_seq');
   raise exception 'nextval unexpectedly allowed';
 exception when insufficient_privilege then raise notice 'PASS: nextval denied (42501)';end;
 begin perform currval('public.courier_locations_id_seq');
   raise exception 'currval unexpectedly allowed';
 exception when insufficient_privilege then raise notice 'PASS: currval denied (42501)';end;
 begin perform setval('public.courier_locations_id_seq',999999,true);
   raise exception 'setval unexpectedly allowed';
 exception when insufficient_privilege then raise notice 'PASS: setval denied (42501)';end;
end;$$;
