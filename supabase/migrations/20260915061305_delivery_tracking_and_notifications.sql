-- RpmDelivery
-- Delivery tracking and notifications
-- Courier locations, delivery notifications and push subscriptions

-- =========================================================
-- RELATIONSHIP INTEGRITY
-- =========================================================
--
-- These composite unique constraints allow child tables to guarantee
-- that related records belong to the same courier or restaurant.

alter table public.routes
  add constraint routes_identity_unique
  unique (id, courier_id);

alter table public.deliveries
  add constraint deliveries_identity_unique
  unique (id, restaurant_id);

-- =========================================================
-- COURIER LOCATIONS
-- =========================================================

create table public.courier_locations (
  id bigint generated always as identity primary key,
  courier_id uuid not null,
  route_id uuid not null,
  latitude numeric not null,
  longitude numeric not null,
  accuracy numeric,
  recorded_at timestamptz not null default now(),

  constraint courier_locations_route_courier_match
    foreign key (
      route_id,
      courier_id
    )
    references public.routes (
      id,
      courier_id
    ),

  constraint courier_locations_latitude_check
    check (
      latitude between -90 and 90
    ),

  constraint courier_locations_longitude_check
    check (
      longitude between -180 and 180
    ),

  constraint courier_locations_accuracy_check
    check (
      accuracy is null
      or accuracy >= 0
    )
);

create index courier_locations_courier_recorded_at_idx
  on public.courier_locations (
    courier_id,
    recorded_at desc
  );

create index courier_locations_route_recorded_at_idx
  on public.courier_locations (
    route_id,
    recorded_at desc
  );

-- =========================================================
-- DELIVERY NOTIFICATIONS
-- =========================================================

create table public.delivery_notifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  delivery_id uuid not null,
  channel public.notification_channel not null,
  type public.notification_type not null,
  destination text,
  provider text,
  provider_message_id text,
  status public.notification_status not null default 'PENDING',
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint delivery_notifications_delivery_restaurant_match
    foreign key (
      delivery_id,
      restaurant_id
    )
    references public.deliveries (
      id,
      restaurant_id
    )
);

create index delivery_notifications_delivery_id_idx
  on public.delivery_notifications (delivery_id);

create index delivery_notifications_restaurant_id_idx
  on public.delivery_notifications (restaurant_id);

create index delivery_notifications_restaurant_status_idx
  on public.delivery_notifications (
    restaurant_id,
    status
  );

create index delivery_notifications_status_idx
  on public.delivery_notifications (status);

create index delivery_notifications_provider_message_id_idx
  on public.delivery_notifications (provider_message_id)
  where provider_message_id is not null;

-- =========================================================
-- PUSH SUBSCRIPTIONS
-- =========================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  constraint push_subscriptions_delivery_endpoint_unique
    unique (
      delivery_id,
      endpoint
    )
);

create index push_subscriptions_delivery_id_idx
  on public.push_subscriptions (delivery_id);

create index push_subscriptions_delivery_active_idx
  on public.push_subscriptions (
    delivery_id,
    active
  );

-- =========================================================
-- IMPORTANT DOMAIN NOTES
-- =========================================================
--
-- COURIER LOCATION
--
-- Location should only be recorded while the courier is operating
-- an active route.
--
-- Expected operational states:
--
-- Route = ON_ROUTE
-- Route = RETURNING
--
-- The courier must only submit their own location.
--
-- These authorization and route-state rules will be enforced later
-- through RLS and controlled backend/RPC operations.
--
-- Public customers must never receive direct SELECT access to
-- courier_locations.
--
-- Customer tracking will use a controlled public endpoint/function
-- that exposes only the information required for that Delivery.
--
--
-- DELIVERY NOTIFICATIONS
--
-- delivery_notifications is an audit/history table for outbound
-- communication.
--
-- Examples:
--
-- TRACKING_LINK
-- NEXT_DELIVERY
-- DELIVERY_COMPLETED
-- DELIVERY_CANCELLED
--
-- Provider credentials must never be stored in this table.
--
-- provider_message_id stores only the external provider message ID.
--
--
-- PUSH SUBSCRIPTIONS
--
-- A push subscription belongs to a specific Delivery.
--
-- The customer must explicitly enable notifications before the
-- browser notification permission is requested.
--
-- A revoked or invalid subscription should be marked:
--
-- active = false
-- revoked_at = now()
--
--
-- LOCATION RETENTION
--
-- courier_locations is intended as temporary operational history.
--
-- A retention period will be defined separately before production.