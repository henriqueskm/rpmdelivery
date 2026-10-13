-- Called after applying the production prerequisite with a synthetic existing
-- GLOBAL service_role grant. PUBLIC alone must be removed/preserved removed.
do $$ begin
  if not exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f'
      and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE')
    or exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
      where d.defaclrole='postgres'::regrole and d.defaclnamespace=0 and d.defaclobjtype='f' and a.grantee=0) then
    raise exception 'Explicit GLOBAL service_role grant was lost or PUBLIC reopened';
  end if;
end; $$;
begin;
create function privilege_plain.global_service_probe() returns integer language sql as $$ select 42 $$;
set role service_role;
do $$ begin if privilege_plain.global_service_probe()<>42 then raise exception 'Global service_role opt-in failed'; end if; end; $$;
reset role;
rollback;
select 'PASS: explicit GLOBAL service_role EXECUTE preserved, PUBLIC closed' as result;
