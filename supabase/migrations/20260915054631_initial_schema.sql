-- RpmDelivery
-- Initial schema
-- Foundation: enums, profiles, restaurants, couriers and shifts

create extension if not exists pgcrypto with schema extensions;

-- =========================================================
-- ENUMS
-- =========================================================

create type public.restaurant_member_role as enum (
  'OWNER',
  'MANAGER',
  'OPERATOR'
);

create type public.restaurant_courier_status as enum (
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED'
);

create type public.courier_shift_status as enum (
  'PENDING',
  'AVAILABLE',
  'ON_ROUTE',
  'RETURNING',
  'ENDED',
  'REJECTED'
);

create type public.order_status as enum (
  'OPEN',
  'DELIVERING',
  'DELIVERED',
  'CANCELLED'
);

create type public.delivery_status as enum (
  'WAITING',
  'ASSIGNED',
  'ON_ROUTE',
  'NEXT',
  'ATTEMPT_FAILED',
  'RETURN_TO_STORE',
  'DELIVERED',
  'CANCELLED'
);

create type public.delivery_issue_reason as enum (
  'CUSTOMER_NOT_FOUND',
  'CUSTOMER_NOT_RESPONDING',
  'ADDRESS_PROBLEM',
  'OTHER'
);

create type public.route_status as enum (
  'PREPARING',
  'ON_ROUTE',
  'RETURNING',
  'COMPLETED',
  'CANCELLED'
);

create type public.notification_channel as enum (
  'WHATSAPP',
  'SMS',
  'PUSH'
);

create type public.notification_type as enum (
  'TRACKING_LINK',
  'NEXT_DELIVERY',
  'DELIVERY_COMPLETED',
  'DELIVERY_CANCELLED'
);

create type public.notification_status as enum (
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

-- =========================================================
-- PROFILES
-- =========================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- RESTAURANTS
-- =========================================================

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text not null,
  latitude numeric,
  longitude numeric,
  minimum_delivery_fee numeric(10,2) not null default 0,
  price_per_km numeric(10,2) not null default 0,
  delivery_issue_timeout_minutes integer not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint restaurants_minimum_delivery_fee_check
    check (minimum_delivery_fee >= 0),

  constraint restaurants_price_per_km_check
    check (price_per_km >= 0),

  constraint restaurants_delivery_issue_timeout_check
    check (delivery_issue_timeout_minutes > 0),

  constraint restaurants_latitude_check
    check (
      latitude is null
      or latitude between -90 and 90
    ),

  constraint restaurants_longitude_check
    check (
      longitude is null
      or longitude between -180 and 180
    )
);

-- =========================================================
-- RESTAURANT MEMBERS
-- =========================================================

create table public.restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  user_id uuid not null references public.profiles(id),
  role public.restaurant_member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint restaurant_members_restaurant_user_unique
    unique (restaurant_id, user_id)
);

create index restaurant_members_restaurant_id_idx
  on public.restaurant_members (restaurant_id);

create index restaurant_members_user_id_idx
  on public.restaurant_members (user_id);

create index restaurant_members_restaurant_active_idx
  on public.restaurant_members (restaurant_id, active);

-- =========================================================
-- COURIERS
-- =========================================================

create table public.couriers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id),
  motorcycle_model text,
  motorcycle_plate text,
  motorcycle_color text,
  last_latitude numeric,
  last_longitude numeric,
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint couriers_last_latitude_check
    check (
      last_latitude is null
      or last_latitude between -90 and 90
    ),

  constraint couriers_last_longitude_check
    check (
      last_longitude is null
      or last_longitude between -180 and 180
    )
);

-- O unique(user_id) já cria índice automaticamente.

-- =========================================================
-- RESTAURANT COURIERS
-- =========================================================

create table public.restaurant_couriers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  courier_id uuid not null references public.couriers(id),
  status public.restaurant_courier_status not null default 'PENDING',
  is_primary boolean not null default false,
  external_sharing_enabled boolean not null default false,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint restaurant_couriers_restaurant_courier_unique
  unique (restaurant_id, courier_id),

constraint restaurant_couriers_identity_unique
  unique (id, restaurant_id, courier_id)
);

create index restaurant_couriers_restaurant_id_idx
  on public.restaurant_couriers (restaurant_id);

create index restaurant_couriers_courier_id_idx
  on public.restaurant_couriers (courier_id);

create index restaurant_couriers_restaurant_status_idx
  on public.restaurant_couriers (restaurant_id, status);

create index restaurant_couriers_courier_status_idx
  on public.restaurant_couriers (courier_id, status);

-- =========================================================
-- COURIER SHIFTS
-- =========================================================

create table public.courier_shifts (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id),
  restaurant_id uuid not null references public.restaurants(id),
  restaurant_courier_id uuid not null,
  status public.courier_shift_status not null default 'PENDING',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  started_at timestamptz,
  available_since timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint courier_shifts_restaurant_courier_match
    foreign key (
      restaurant_courier_id,
      restaurant_id,
      courier_id
    )
    references public.restaurant_couriers (
      id,
      restaurant_id,
      courier_id
    ),

  constraint courier_shifts_identity_unique
    unique (id, restaurant_id, courier_id)
);

create index courier_shifts_courier_id_idx
  on public.courier_shifts (courier_id);

create index courier_shifts_restaurant_id_idx
  on public.courier_shifts (restaurant_id);

create index courier_shifts_status_idx
  on public.courier_shifts (status);

create index courier_shifts_restaurant_status_idx
  on public.courier_shifts (restaurant_id, status);

create index courier_shifts_courier_started_at_idx
  on public.courier_shifts (courier_id, started_at desc);

-- Um motoboy só pode possuir um turno ainda não finalizado.
--
-- PENDING também conta como turno aberto para impedir que o motoboy
-- solicite turno simultaneamente em duas lojas.
create unique index courier_shifts_one_open_shift_per_courier_idx
  on public.courier_shifts (courier_id)
  where status not in ('ENDED', 'REJECTED');

-- =========================================================
-- COURIER INVITES
-- =========================================================

create table public.courier_invites (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  token uuid not null unique default gen_random_uuid(),
  code text not null unique,
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint courier_invites_used_count_check
    check (used_count >= 0),

  constraint courier_invites_max_uses_check
    check (
      max_uses is null
      or max_uses > 0
    ),

  constraint courier_invites_usage_limit_check
    check (
      max_uses is null
      or used_count <= max_uses
    )
);

create index courier_invites_restaurant_id_idx
  on public.courier_invites (restaurant_id);

create index courier_invites_active_idx
  on public.courier_invites (active);