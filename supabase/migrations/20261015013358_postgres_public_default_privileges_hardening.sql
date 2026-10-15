-- PR 1A: future objects owned by postgres in public only.
-- Existing objects, service_role grants and supabase_admin are untouched.
begin;

-- Per-schema REVOKE cannot subtract a global grant (including PostgreSQL's
-- implicit PUBLIC EXECUTE). Fail closed instead of modifying other schemas.
do $$
declare
  v_global_grant record;
begin
  select object_class.kind, grants.grantee, grants.privilege_type
    into v_global_grant
  from (values ('r'::"char"), ('S'::"char"), ('f'::"char")) as object_class(kind)
  left join pg_catalog.pg_default_acl as defaults
    on defaults.defaclrole = 'postgres'::regrole
    and defaults.defaclnamespace = 0
    and defaults.defaclobjtype = object_class.kind
  cross join lateral pg_catalog.aclexplode(coalesce(
    defaults.defaclacl,
    pg_catalog.acldefault(object_class.kind, 'postgres'::regrole)
  )) as grants
  where case when grants.grantee = 0 then true else
    pg_catalog.pg_has_role('anon'::regrole, grants.grantee, 'USAGE')
    or pg_catalog.pg_has_role('authenticated'::regrole, grants.grantee, 'USAGE')
  end
  limit 1;

  if found then
    raise exception 'RPM_DEFAULT_PRIVILEGES_GLOBAL_GRANT'
      using errcode = '42501',
        detail = format('Global default grant: object class %s, privilege %s.',
          v_global_grant.kind, v_global_grant.privilege_type),
        hint = 'Global defaults need a separately reviewed change. This migration changes only postgres/public.';
  end if;
end;
$$;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on routines from public, anon, authenticated;

commit;
