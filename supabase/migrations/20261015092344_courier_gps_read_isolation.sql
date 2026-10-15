-- RPM-SEC-GPS-001. Proposal only: do not apply to hosted Supabase without approval.
begin;

create or replace function private.can_view_courier(target_courier_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_courier_id = private.current_courier_id()
    or exists (
      select 1 from public.restaurant_couriers rc
      join public.restaurant_members rm on rm.restaurant_id = rc.restaurant_id
      where rc.courier_id = target_courier_id
        and rm.user_id = auth.uid() and rm.active
        and (rc.status = 'ACTIVE'
          or (rc.status = 'PENDING' and rm.role in ('OWNER','MANAGER')))
    );
$$;

-- Keep staff/self access; courier identity follows the same approval rules.
create or replace function private.can_view_profile(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user_id = auth.uid()
    or exists (
      select 1 from public.restaurant_members me
      join public.restaurant_members target on target.restaurant_id = me.restaurant_id
      where me.user_id = auth.uid() and me.active
        and me.role in ('OWNER','MANAGER')
        and target.user_id = target_user_id and target.active
    )
    or exists (
      select 1 from public.couriers c
      where c.user_id = target_user_id and private.can_view_courier(c.id)
    );
$$;

-- A column REVOKE alone cannot subtract the existing table-wide SELECT.
-- Drop table-wide access first; no API role, including the courier themself,
-- receives global GPS. SELECT * intentionally fails rather than leaking it.
revoke select on table public.couriers from public, anon, authenticated;
revoke select (last_latitude, last_longitude, location_updated_at)
  on table public.couriers from public, anon, authenticated;
grant select (id, user_id, motorcycle_model, motorcycle_plate, motorcycle_color,
  created_at, updated_at) on table public.couriers to authenticated;

-- Fail closed on unexpected inherited privileges, without changing other roles.
do $$
begin
  if exists (
    select 1 from (values ('anon'),('authenticated')) roles(name)
    cross join (values ('last_latitude'),('last_longitude'),('location_updated_at')) cols(name)
    where pg_catalog.has_column_privilege(roles.name,'public.couriers',cols.name,'SELECT')
  ) then
    raise exception 'RPM_COURIER_GPS_INHERITED_SELECT' using errcode = '42501';
  end if;
end;
$$;

-- Existing helper ACLs, route-scoped location RLS, RPCs and service_role unchanged.
notify pgrst, 'reload schema';
commit;
