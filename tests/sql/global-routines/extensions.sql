-- Native contrib fixture demonstrates the real risk for future extensions.
-- Not evidence that hosted Supabase extension upgrades are compatible.
begin;
create schema privilege_extensions;
grant usage on schema privilege_extensions to authenticated;
create extension hstore with schema privilege_extensions;
create function privilege_extensions.listener_probe() returns integer language sql as $$ select 1 $$;
set role authenticated;
do $$ begin
  begin perform privilege_extensions.hstore('fixture','value');
    raise exception 'Future extension unexpectedly inherited EXECUTE'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
grant execute on function privilege_extensions.hstore(text,text) to authenticated;
set role authenticated;
do $$ begin
  if privilege_extensions.hstore('fixture','value') is null then raise exception 'Extension explicit grant failed'; end if;
end; $$;
reset role;
do $$ begin
  if not exists(select 1 from privilege_test.ddl_events where tag='CREATE FUNCTION') then
    raise exception 'Representative existing event trigger stopped firing';
  end if;
end; $$;
rollback;
select 'PASS: existing DDL listener; future hstore requires explicit opt-in (hosted compatibility remains unverified)' as result;
