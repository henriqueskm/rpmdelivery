select set_config('request.jwt.claim.sub',:'uid',false);
select set_config('gps_test.phase',:'phase',false);
select set_config('gps_test.expected_identity',:'visible',false);
select gps_test.check('unprivileged direct user connection',current_user=session_user
 and not (select rolsuper or rolbypassrls or rolcreaterole from pg_roles where rolname=current_user));
do $$
declare expected boolean := current_setting('gps_test.expected_identity')::boolean;
begin
 if current_setting('gps_test.phase')='after' then
  perform gps_test.check('identity columns obey relationship and approval roles',
   exists(select id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color,created_at,updated_at
     from public.couriers where id=gps_test.id(201))=expected);
  perform gps_test.check('profile follows the same relationship rule',
   exists(select 1 from public.profiles where id=gps_test.id(3))=expected);
  begin perform last_latitude from public.couriers;raise exception 'Latitude leaked';
   exception when insufficient_privilege then raise notice 'PASS: explicit latitude denied';end;
  begin perform last_longitude from public.couriers;raise exception 'Longitude leaked';
   exception when insufficient_privilege then raise notice 'PASS: explicit longitude denied';end;
  begin perform location_updated_at from public.couriers;raise exception 'GPS timestamp leaked';
   exception when insufficient_privilege then raise notice 'PASS: explicit GPS timestamp denied';end;
  begin perform * from public.couriers;raise exception 'Wildcard leaked';
   exception when insufficient_privilege then raise notice 'PASS: SELECT * denied';end;
 else
  perform gps_test.check('before: rejected association exposes global GPS through wildcard',
    exists(select * from public.couriers where last_latitude=-10 and last_longitude=-40));
  perform gps_test.check('before: rejected association exposes courier profile',exists(select 1 from public.profiles where id=gps_test.id(3)));
 end if;
 -- Route A is ON_ROUTE, route B is historical. No change to historical semantics.
 if current_user='gps_owner_a' then
  perform gps_test.check('A authorized GPS includes its route only',
    exists(select 1 from public.courier_locations where route_id=gps_test.id(501))
    and not exists(select 1 from public.courier_locations where route_id=gps_test.id(502)));
 elsif current_user='gps_courier' then
  perform gps_test.check('courier own route GPS preserved',(select count(*) from public.courier_locations)=2);
  perform gps_test.check('courier identity and idempotent RPC preserved',public.create_courier_profile(null,null,null)=gps_test.id(201));
 elsif current_user in ('gps_owner_b','gps_manager_b','gps_operator_b') then
  perform gps_test.check('B cannot track current A route, even when ACTIVE in both stores',
    not exists(select 1 from public.courier_locations where route_id=gps_test.id(501))
    and exists(select 1 from public.courier_locations where route_id=gps_test.id(502)));
 else
  perform gps_test.check('inactive/unrelated user has no route GPS',(select count(*) from public.courier_locations)=0);
 end if;
end; $$;
