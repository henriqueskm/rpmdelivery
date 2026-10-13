do $$
begin
  if (select value from privilege_test.existing_objects) is distinct from
    (select value from privilege_test.snapshots where name='existing') then
    raise exception 'Existing objects, explicit grants, RPCs or RLS changed';
  end if;
  if (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d
    where not (d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace))
    is distinct from (select value from privilege_test.snapshots where name='outside-defaults') then
    raise exception 'Global, outside-schema or supabase_admin defaults changed';
  end if;
end;
$$;

begin;
create table public.privilege_future (id bigint generated always as identity, value integer);
alter table public.privilege_future enable row level security;
create sequence public.privilege_future_sequence;
create function public.privilege_future_function() returns integer
  language sql security definer set search_path='' as $$ select 42 $$;
create procedure public.privilege_future_procedure() language sql as $$ select 42 $$;
create table privilege_outside.future (id integer);
create sequence privilege_outside.future_sequence;
create function privilege_outside.future_function() returns integer language sql as $$ select 42 $$;
set role supabase_admin;
create table public.privilege_managed_future (id integer);
reset role;

do $$
declare
  v_role text;
  v_privilege text;
  v_sequence text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(v_role,'public.privilege_future',v_privilege) then
        raise exception 'Unexpected future table privilege: % %',v_role,v_privilege;
      end if;
    end loop;
    foreach v_sequence in array array['public.privilege_future_sequence','public.privilege_future_id_seq'] loop
      foreach v_privilege in array array['USAGE','SELECT','UPDATE'] loop
        if has_sequence_privilege(v_role,v_sequence,v_privilege) then
          raise exception 'Unexpected sequence privilege: % % %',v_role,v_sequence,v_privilege;
        end if;
      end loop;
    end loop;
    if has_function_privilege(v_role,'public.privilege_future_function()','EXECUTE')
      or has_function_privilege(v_role,'public.privilege_future_procedure()','EXECUTE') then
      raise exception 'Unexpected future routine EXECUTE: %',v_role;
    end if;
    if not has_table_privilege(v_role,'public.privilege_managed_future','TRUNCATE') then
      raise exception 'supabase_admin defaults changed';
    end if;
  end loop;
  if not has_table_privilege('service_role','public.privilege_future','INSERT')
    or not has_sequence_privilege('service_role','public.privilege_future_sequence','USAGE')
    or not has_function_privilege('service_role','public.privilege_future_function()','EXECUTE') then
    raise exception 'service_role defaults changed';
  end if;
  if not has_table_privilege('authenticated','privilege_outside.future','SELECT')
    or not has_sequence_privilege('authenticated','privilege_outside.future_sequence','USAGE')
    or not has_function_privilege('authenticated','privilege_outside.future_function()','EXECUTE') then
    raise exception 'Outside-schema explicit defaults changed';
  end if;
end;
$$;

-- Test actual role execution, not just the catalog. Both roles must fail.
set role anon;
do $$
begin
  if current_user <> 'anon' then raise exception 'Wrong effective role'; end if;
  begin perform public.privilege_future_function(); raise exception 'EXECUTE allowed'; exception when insufficient_privilege then null; end;
  begin perform nextval('public.privilege_future_sequence'); raise exception 'nextval allowed'; exception when insufficient_privilege then null; end;
  begin perform setval('public.privilege_future_sequence',2); raise exception 'setval allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.privilege_future; raise exception 'SELECT allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.privilege_future(value) values(1); raise exception 'INSERT allowed'; exception when insufficient_privilege then null; end;
  begin truncate public.privilege_future; raise exception 'TRUNCATE allowed'; exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set role authenticated;
do $$
begin
  if current_user <> 'authenticated' then raise exception 'Wrong effective role'; end if;
  begin perform public.privilege_future_function(); raise exception 'EXECUTE allowed'; exception when insufficient_privilege then null; end;
  begin perform nextval('public.privilege_future_sequence'); raise exception 'nextval allowed'; exception when insufficient_privilege then null; end;
  begin perform setval('public.privilege_future_sequence',2); raise exception 'setval allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.privilege_future; raise exception 'SELECT allowed'; exception when insufficient_privilege then null; end;
  begin update public.privilege_future set value=2; raise exception 'UPDATE allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.privilege_future; raise exception 'DELETE allowed'; exception when insufficient_privilege then null; end;
  begin truncate public.privilege_future; raise exception 'TRUNCATE allowed'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.privilege_existing) <> 1
    or public.privilege_existing_function() <> 7 then raise exception 'Explicit existing grants failed'; end if;
  perform nextval('public.privilege_existing_sequence');
end;
$$;
reset role;

-- Explicit, narrowly scoped opt-in grants still work for future objects.
grant select on public.privilege_future to authenticated;
create policy future_read on public.privilege_future for select to authenticated using(value=42);
insert into public.privilege_future(value) values(42),(99);
grant execute on function public.privilege_future_function() to authenticated;
set role authenticated;
do $$
begin
  if public.privilege_future_function() <> 42
    or (select count(*) from public.privilege_future) <> 1 then
    raise exception 'Explicit opt-in grants or RLS failed';
  end if;
end;
$$;
reset role;
rollback;

select 'after' as stage, pg_get_userbyid(d.defaclrole) as owner,
  d.defaclobjtype as kind, d.defaclacl::text as acl
from pg_default_acl d where d.defaclnamespace='public'::regnamespace
order by owner,kind;
select 'PASS: defaults, effective roles, RLS, existing/explicit grants, outside scope and managed defaults' as result;
