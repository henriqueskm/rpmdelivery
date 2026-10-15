select gps_test.check('outside scope unchanged',
 (select value from gps_test.snapshot)=(select value from gps_test.unchanged));
select gps_test.check('no anonymous courier column access',
 not has_any_column_privilege('anon','public.couriers','SELECT'));
select gps_test.check('no global GPS access including inheritance',not exists(
 select 1 from (values('anon'),('authenticated')) r(name)
 cross join (values('last_latitude'),('last_longitude'),('location_updated_at')) c(name)
 where has_column_privilege(r.name,'public.couriers',c.name,'SELECT')));
do $$begin
 begin perform 'INACTIVE'::public.restaurant_courier_status;raise exception 'Unexpected enum value';
 exception when invalid_text_representation then raise notice 'PASS: INACTIVE is not a valid enum; SUSPENDED and inactive membership tested';end;
end;$$;
select 'after' as phase,attname,has_column_privilege('authenticated',attrelid,attnum,'SELECT') as authenticated_read
 from pg_attribute where attrelid='public.couriers'::regclass and attnum>0 and not attisdropped order by attnum;
