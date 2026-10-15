-- Native PostgreSQL only. Representative listener; not hosted Supabase code.
create table privilege_test.ddl_events (tag text);
create function privilege_test.capture_ddl() returns event_trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into privilege_test.ddl_events(tag)
    select command_tag from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE FUNCTION','CREATE PROCEDURE');
end;
$$;
create event trigger privilege_test_ddl on ddl_command_end
  execute function privilege_test.capture_ddl();
