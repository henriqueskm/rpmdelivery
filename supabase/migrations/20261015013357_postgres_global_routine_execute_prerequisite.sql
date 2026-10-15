-- Draft prerequisite for PR17. Needs hosted compatibility review and explicit
-- application authorization. Only future routines created by postgres, in ALL
-- schemas. No existing ACLs, explicit grants or supabase_admin defaults change.
begin;

alter default privileges for role postgres
  revoke execute on routines from public;

commit;
