-- RpmDelivery
-- RLS policies
-- Read access and safe self-service access only.
--
-- Operational writes remain blocked and will be performed through
-- controlled RPC/backend commands in later migrations.

-- =========================================================
-- ADDITIONAL SECURITY HELPERS
-- =========================================================

create or replace function private.can_view_profile(
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id = auth.uid()

    -- OWNER/MANAGER may see profiles of members in restaurants
    -- they manage.
    or exists (
      select 1
      from public.restaurant_members as me
      join public.restaurant_members as target
        on target.restaurant_id = me.restaurant_id
      where me.user_id = auth.uid()
        and me.active = true
        and me.role in ('OWNER', 'MANAGER')
        and target.user_id = target_user_id
        and target.active = true
    )

    -- Any active restaurant member may see the profile of couriers
    -- associated with that restaurant. This is necessary for
    -- operational screens such as courier lists and shift approval.
    or exists (
      select 1
      from public.restaurant_members as me
      join public.restaurant_couriers as rc
        on rc.restaurant_id = me.restaurant_id
      join public.couriers as c
        on c.id = rc.courier_id
      where me.user_id = auth.uid()
        and me.active = true
        and c.user_id = target_user_id
    );
$$;

create or replace function private.can_view_courier(
  target_courier_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_courier_id = private.current_courier_id()

    or exists (
      select 1
      from public.restaurant_couriers as rc
      join public.restaurant_members as rm
        on rm.restaurant_id = rc.restaurant_id
      where rc.courier_id = target_courier_id
        and rm.user_id = auth.uid()
        and rm.active = true
    );
$$;

create or replace function private.courier_owns_route(
  target_route_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.routes as r
    join public.couriers as c
      on c.id = r.courier_id
    where r.id = target_route_id
      and c.user_id = auth.uid()
  );
$$;

create or replace function private.courier_has_active_delivery(
  target_delivery_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.route_deliveries as rd
    join public.routes as r
      on r.id = rd.route_id
    join public.couriers as c
      on c.id = r.courier_id
    where rd.delivery_id = target_delivery_id
      and c.user_id = auth.uid()
      and r.status in (
        'PREPARING',
        'ON_ROUTE',
        'RETURNING'
      )
  );
$$;

create or replace function private.courier_has_active_order(
  target_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deliveries as d
    join public.route_deliveries as rd
      on rd.delivery_id = d.id
    join public.routes as r
      on r.id = rd.route_id
    join public.couriers as c
      on c.id = r.courier_id
    where d.order_id = target_order_id
      and c.user_id = auth.uid()
      and r.status in (
        'PREPARING',
        'ON_ROUTE',
        'RETURNING'
      )
  );
$$;

create or replace function private.can_view_route_location(
  target_route_id uuid,
  target_courier_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.routes as r
    where r.id = target_route_id
      and r.courier_id = target_courier_id
      and (
        r.courier_id = private.current_courier_id()
        or private.is_restaurant_member(r.restaurant_id)
      )
  );
$$;

-- Remove default function execution privileges.

revoke all
on function private.can_view_profile(uuid)
from public;

revoke all
on function private.can_view_courier(uuid)
from public;

revoke all
on function private.courier_owns_route(uuid)
from public;

revoke all
on function private.courier_has_active_delivery(uuid)
from public;

revoke all
on function private.courier_has_active_order(uuid)
from public;

revoke all
on function private.can_view_route_location(uuid, uuid)
from public;

grant execute
on function private.can_view_profile(uuid)
to authenticated;

grant execute
on function private.can_view_courier(uuid)
to authenticated;

grant execute
on function private.courier_owns_route(uuid)
to authenticated;

grant execute
on function private.courier_has_active_delivery(uuid)
to authenticated;

grant execute
on function private.courier_has_active_order(uuid)
to authenticated;

grant execute
on function private.can_view_route_location(uuid, uuid)
to authenticated;

-- =========================================================
-- PROFILES
-- =========================================================

create policy profiles_select_allowed
on public.profiles
for select
to authenticated
using (
  private.can_view_profile(id)
);

-- A user may edit only their own profile.
--
-- profiles currently contains only user-editable identity information:
-- name, phone and photo_url, plus timestamps.

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
)
with check (
  id = auth.uid()
);

-- =========================================================
-- RESTAURANTS
-- =========================================================

create policy restaurants_select_related
on public.restaurants
for select
to authenticated
using (
  private.is_restaurant_member(id)
  or private.is_active_restaurant_courier(id)
);

-- =========================================================
-- RESTAURANT MEMBERS
-- =========================================================
--
-- A user may always see their own membership.
--
-- OWNER/MANAGER may see the member list.
--
-- OPERATOR cannot enumerate restaurant users.

create policy restaurant_members_select_allowed
on public.restaurant_members
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_restaurant_manager(restaurant_id)
);

-- =========================================================
-- COURIERS
-- =========================================================

create policy couriers_select_allowed
on public.couriers
for select
to authenticated
using (
  private.can_view_courier(id)
);

-- =========================================================
-- RESTAURANT COURIERS
-- =========================================================
--
-- Restaurant members need this for courier operations.
--
-- Couriers may see only their own restaurant associations.

create policy restaurant_couriers_select_allowed
on public.restaurant_couriers
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or courier_id = private.current_courier_id()
);

-- =========================================================
-- COURIER SHIFTS
-- =========================================================

create policy courier_shifts_select_allowed
on public.courier_shifts
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or courier_id = private.current_courier_id()
);

-- =========================================================
-- COURIER INVITES
-- =========================================================
--
-- Invite management is not an OPERATOR permission.
--
-- Invite redemption by a courier will use a controlled RPC rather
-- than direct table access.

create policy courier_invites_select_managers
on public.courier_invites
for select
to authenticated
using (
  private.is_restaurant_manager(restaurant_id)
);

-- =========================================================
-- ORDERS
-- =========================================================
--
-- Restaurant members may see orders from their own restaurant.
--
-- A courier receives customer/order data only while that order is
-- part of one of their operational routes.

create policy orders_select_allowed
on public.orders
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or private.courier_has_active_order(id)
);

-- =========================================================
-- DELIVERIES
-- =========================================================

create policy deliveries_select_allowed
on public.deliveries
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or private.courier_has_active_delivery(id)
);

-- =========================================================
-- ROUTES
-- =========================================================

create policy routes_select_allowed
on public.routes
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or courier_id = private.current_courier_id()
);

-- =========================================================
-- ROUTE DELIVERIES
-- =========================================================

create policy route_deliveries_select_allowed
on public.route_deliveries
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or private.courier_owns_route(route_id)
);

-- =========================================================
-- COURIER LOCATIONS
-- =========================================================
--
-- Only the courier themselves and members of the restaurant
-- responsible for that route may read location data.
--
-- There is deliberately NO anonymous/public SELECT policy.
--
-- Customer tracking will use a controlled public function/endpoint.

create policy courier_locations_select_allowed
on public.courier_locations
for select
to authenticated
using (
  private.can_view_route_location(
    route_id,
    courier_id
  )
);

-- =========================================================
-- DELIVERY NOTIFICATIONS
-- =========================================================
--
-- Notification history is visible to the restaurant only.
--
-- The customer and courier do not read this audit table directly.

create policy delivery_notifications_select_restaurant
on public.delivery_notifications
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
);

-- =========================================================
-- PUSH SUBSCRIPTIONS
-- =========================================================
--
-- INTENTIONALLY NO POLICIES.
--
-- push_subscriptions contains browser push endpoint/key information.
-- It must never be directly readable or writable through the normal
-- Supabase Data API.
--
-- Customer subscription registration will be implemented through a
-- controlled tracking endpoint/function.
--
-- With RLS enabled and no policies:
--
-- anon          -> denied
-- authenticated -> denied

-- =========================================================
-- WRITE ACCESS
-- =========================================================
--
-- No direct INSERT/UPDATE/DELETE policies are created for:
--
-- restaurants
-- restaurant_members
-- couriers
-- restaurant_couriers
-- courier_shifts
-- courier_invites
-- orders
-- deliveries
-- routes
-- route_deliveries
-- courier_locations
-- delivery_notifications
-- push_subscriptions
--
-- Operational mutations will be implemented as explicit transactional
-- commands/RPCs that validate role, ownership and state transitions.