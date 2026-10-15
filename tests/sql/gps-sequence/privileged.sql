-- Disposable synthetic data only. Never run against hosted Supabase.
do $$
declare n bigint; generated_id bigint;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Wrong actor';end if;
 if (select rolsuper from pg_roles where rolname=current_user) then
   raise exception 'Test must not rely on SUPERUSER';end if;
 n:=nextval('public.courier_locations_id_seq');
 if currval('public.courier_locations_id_seq')<>n then raise exception 'currval failed';end if;
 perform setval('public.courier_locations_id_seq',n,true);
 insert into public.courier_locations(courier_id,route_id,latitude,longitude)
 values('00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000501',-10,-40) returning id into generated_id;
 if generated_id<>n+1 then raise exception 'IDENTITY failed';end if;
 raise notice 'PASS: % nextval/currval/setval and automatic IDENTITY insert',current_user;
end;$$;
