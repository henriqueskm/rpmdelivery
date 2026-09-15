-- RpmDelivery
-- Security foundation
-- Auth profile creation, updated_at triggers, RLS and helper functions

-- =========================================================
-- UPDATED_AT
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger restaurants_set_updated_at
before update on public.restaurants
for each row
execute function public.set_updated_at();

create trigger restaurant_members_set_updated_at
before update on public.restaurant_members
for each row
execute function public.set_updated_at();

create trigger couriers_set_updated_at
before update on public.couriers
for each row
execute function public.set_updated_at();

create trigger restaurant_couriers_set_updated_at
before update on public.restaurant_couriers
for each row
execute function public.set_updated_at();

create trigger courier_shifts_set_updated_at
before update on public.courier_shifts
for each row
execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

create trigger deliveries_set_updated_at
before update on public.deliveries
for each row
execute function public.set_updated_at();

create trigger routes_set_updated_at
before update on public.routes
for each row
execute function public.set_updated_at();

-- =========================================================
-- AUTH USER -> PROFILE
-- =========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  profile_phone text;
  profile_photo_url text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  );

  profile_phone := coalesce(
    nullif(btrim(new.phone), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), '')
  );

  profile_photo_url := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'photo_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  );

  insert into public.profiles (
    id,
    name,
    phone,
    photo_url
  )
  values (
    new.id,
    profile_name,
    profile_phone,
    profile_photo_url
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Trigger functions are internal and should not be callable through API.
revoke all
on function public.handle_new_user()
from public;

revoke all
on function public.set_updated_at()
from public;

-- =========================================================
-- SECURITY HELPER FUNCTIONS
-- =========================================================
--
-- These functions are SECURITY DEFINER intentionally.
--
-- RLS policies will need to inspect membership tables that also have
-- RLS enabled. Using small controlled helper functions avoids recursive
-- policies while exposing only boolean membership information.

create or replace function public.is_restaurant_member(
  target_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_members as rm
    where rm.restaurant_id = target_restaurant_id
      and rm.user_id = auth.uid()
      and rm.active = true
  );
$$;

create or replace function public.is_restaurant_manager(
  target_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_members as rm
    where rm.restaurant_id = target_restaurant_id
      and rm.user_id = auth.uid()
      and rm.active = true
      and rm.role in ('OWNER', 'MANAGER')
  );
$$;

create or replace function public.is_restaurant_owner(
  target_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_members as rm
    where rm.restaurant_id = target_restaurant_id
      and rm.user_id = auth.uid()
      and rm.active = true
      and rm.role = 'OWNER'
  );
$$;

create or replace function public.current_courier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.couriers as c
  where c.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_active_restaurant_courier(
  target_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_couriers as rc
    join public.couriers as c
      on c.id = rc.courier_id
    where rc.restaurant_id = target_restaurant_id
      and rc.status = 'ACTIVE'
      and c.user_id = auth.uid()
  );
$$;

-- Do not expose helper functions to anonymous users.

revoke all
on function public.is_restaurant_member(uuid)
from public;

revoke all
on function public.is_restaurant_manager(uuid)
from public;

revoke all
on function public.is_restaurant_owner(uuid)
from public;

revoke all
on function public.current_courier_id()
from public;

revoke all
on function public.is_active_restaurant_courier(uuid)
from public;

grant execute
on function public.is_restaurant_member(uuid)
to authenticated;

grant execute
on function public.is_restaurant_manager(uuid)
to authenticated;

grant execute
on function public.is_restaurant_owner(uuid)
to authenticated;

grant execute
on function public.current_courier_id()
to authenticated;

grant execute
on function public.is_active_restaurant_courier(uuid)
to authenticated;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
--
-- RLS is enabled explicitly even if automatic RLS is enabled in the
-- Supabase project.
--
-- No policies are created in this migration.
--
-- Therefore the API remains deny-by-default until the next migration.

alter table public.profiles
  enable row level security;

alter table public.restaurants
  enable row level security;

alter table public.restaurant_members
  enable row level security;

alter table public.couriers
  enable row level security;

alter table public.restaurant_couriers
  enable row level security;

alter table public.courier_shifts
  enable row level security;

alter table public.courier_invites
  enable row level security;

alter table public.orders
  enable row level security;

alter table public.deliveries
  enable row level security;

alter table public.routes
  enable row level security;

alter table public.route_deliveries
  enable row level security;

alter table public.courier_locations
  enable row level security;

alter table public.delivery_notifications
  enable row level security;

alter table public.push_subscriptions
  enable row level security;

-- =========================================================
-- SECURITY STATE AFTER THIS MIGRATION
-- =========================================================
--
-- Authenticated signup:
--
-- auth.users
--      |
--      v
-- profiles
--
-- automatically created by on_auth_user_created.
--
--
-- Access through Supabase API:
--
-- Tables
--   RLS = ENABLED
--   Policies = NONE
--
-- Result:
--
-- authenticated user -> denied by default
-- anonymous user     -> denied by default
--
-- Controlled policies will be added separately.
--
-- courier_locations and push_subscriptions must never receive
-- unrestricted public SELECT policies.