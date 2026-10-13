do $$ begin
  if (select value from privilege_test.global_existing) is distinct from
    (select value from privilege_test.snapshots where name='global-existing') then
    raise exception 'Existing objects, grants, RPCs, RLS, roles or event triggers changed';
  end if;
  if (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d
    where not(d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f'))
    is distinct from (select value from privilege_test.snapshots where name='non-target-defaults') then
    raise exception 'Per-schema, other classes or other creators defaults changed';
  end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f' and a.grantee=0) then
    raise exception 'Global PUBLIC still has EXECUTE';
  end if;
end; $$;

begin;
create function public.global_future() returns integer language sql security definer set search_path='' as $$ select 42 $$;
create function privilege_plain.global_future() returns integer language sql as $$ select 42 $$;
create procedure privilege_plain.global_procedure() language sql as $$ select 42 $$;
create function privilege_optin.global_future() returns integer language sql as $$ select 42 $$;
set role supabase_admin;
create function public.global_managed_future() returns integer language sql as $$ select 42 $$;
reset role;
set role supabase_auth_admin;
create function privilege_plain.global_auth_future() returns integer language sql as $$ select 42 $$;
reset role;

do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','privilege_public_probe'] loop
    if has_function_privilege(v_role,'public.global_future()','EXECUTE')
      or has_function_privilege(v_role,'privilege_plain.global_future()','EXECUTE')
      or has_function_privilege(v_role,'privilege_plain.global_procedure()','EXECUTE') then
      raise exception 'Unexpected future postgres routine EXECUTE: %',v_role;
    end if;
    if not has_function_privilege(v_role,'privilege_plain.existing_public()','EXECUTE')
      or not has_function_privilege(v_role,'privilege_plain.global_auth_future()','EXECUTE') then
      raise exception 'Existing ACL or other creator was affected: %',v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role','public.global_future()','EXECUTE')
    or not has_function_privilege('authenticated','privilege_optin.global_future()','EXECUTE')
    or not has_function_privilege('service_role','privilege_optin.global_future()','EXECUTE')
    or has_function_privilege('anon','privilege_optin.global_future()','EXECUTE') then
    raise exception 'Per-schema explicit grants changed';
  end if;
  if has_function_privilege('service_role','privilege_plain.global_future()','EXECUTE') then
    raise exception 'Unexpected implicit future service_role fallback';
  end if;
  if not has_function_privilege('anon','public.global_managed_future()','EXECUTE')
    or not has_function_privilege('authenticated','public.global_managed_future()','EXECUTE') then
    raise exception 'supabase_admin defaults changed';
  end if;
end;
$$;
set role privilege_public_probe;
do $$ begin
  if privilege_plain.existing_public()<>7 then raise exception 'Existing PUBLIC grant failed'; end if;
  begin perform privilege_plain.global_future(); raise exception 'PUBLIC inherited EXECUTE'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set role anon;
do $$ begin
  begin perform public.global_future(); raise exception 'anon inherited EXECUTE'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set role authenticated;
do $$ begin
  if privilege_optin.global_future()<>42 then raise exception 'Schema opt-in failed'; end if;
  begin perform privilege_plain.global_future(); raise exception 'authenticated inherited EXECUTE'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set role service_role;
do $$ begin
  if public.existing_service()<>7 or public.global_future()<>42 or privilege_optin.global_future()<>42 then
    raise exception 'Existing/explicit service_role EXECUTE failed';
  end if;
end; $$;
reset role;
grant execute on function privilege_plain.global_future() to authenticated,service_role;
grant execute on procedure privilege_plain.global_procedure() to authenticated;
set role authenticated;
do $$ begin if privilege_plain.global_future()<>42 then raise exception 'Object opt-in failed'; end if; end; $$;
call privilege_plain.global_procedure();
reset role;
rollback;
select 'after' as stage, d.defaclacl::text as acl from pg_default_acl d
where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f';
select 'PASS: global routine defaults, future PUBLIC/anon/authenticated, explicit grants, service_role and other creators' as result;
