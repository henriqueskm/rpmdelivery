-- RPM-SEC-GPS-002: existing GPS identity sequence only. Forward-only.
begin;

-- Fail closed if this name no longer identifies the expected identity sequence.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class s
    join pg_catalog.pg_attribute a
      on a.attrelid = 'public.courier_locations'::regclass
      and a.attname = 'id' and a.attidentity = 'a'
    where s.oid = 'public.courier_locations_id_seq'::regclass
      and s.relkind = 'S' and s.relowner = 'postgres'::regrole
      and pg_catalog.pg_get_serial_sequence('public.courier_locations','id')::regclass = s.oid
  ) then
    raise exception 'RPM_GPS_SEQUENCE_IDENTITY_MISMATCH' using errcode = '42501';
  end if;
end;
$$;

revoke all privileges on sequence public.courier_locations_id_seq
  from public, anon, authenticated;

-- Do not silently revoke another role's grants or memberships. Also reject
-- NOINHERIT memberships that could regain access through SET ROLE.
do $$
begin
  if exists (
    select 1 from (values ('anon'),('authenticated')) api(role_name)
    cross join (values ('USAGE'),('SELECT'),('UPDATE')) privileges(privilege_name)
    where pg_catalog.has_sequence_privilege(
      api.role_name,'public.courier_locations_id_seq',privileges.privilege_name)
  ) or exists (
    select 1 from pg_catalog.pg_class s
    cross join lateral pg_catalog.aclexplode(
      coalesce(s.relacl,pg_catalog.acldefault('S',s.relowner))) grants
    cross join (values ('anon'::regrole),('authenticated'::regrole)) api(role_oid)
    where s.oid = 'public.courier_locations_id_seq'::regclass
      and case when grants.grantee = 0 then true else
        pg_catalog.pg_has_role(api.role_oid,grants.grantee,'SET')
      end
  ) then
    raise exception 'RPM_GPS_SEQUENCE_RESIDUAL_PRIVILEGE' using errcode = '42501';
  end if;
end;
$$;

-- No ALTER SEQUENCE, nextval/setval, table grants, RLS or data changes.
-- Existing owner/service_role grants are intentionally untouched.
commit;
