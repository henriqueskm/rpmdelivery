-- RpmDelivery
-- Delivery core
-- Orders, deliveries, routes and route assignments

-- =========================================================
-- ORDERS
-- =========================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  customer_name text not null,
  customer_phone text not null,
  delivery_address text not null,
  neighborhood text,
  reference text,
  notes text,
  status public.order_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_identity_unique
    unique (id, restaurant_id)
);

create index orders_restaurant_id_idx
  on public.orders (restaurant_id);

create index orders_restaurant_status_idx
  on public.orders (restaurant_id, status);

create index orders_created_at_idx
  on public.orders (created_at);

create index orders_customer_phone_idx
  on public.orders (customer_phone);

-- =========================================================
-- DELIVERIES
-- =========================================================

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  order_id uuid not null unique,
  status public.delivery_status not null default 'WAITING',
  distance_km numeric(8,2),
  delivery_fee numeric(10,2),
  tracking_token uuid not null unique default gen_random_uuid(),
  issue_reason public.delivery_issue_reason,
  issue_notes text,
  issue_reported_at timestamptz,
  issue_decision_deadline timestamptz,
  assigned_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deliveries_identity_unique
  unique (id, restaurant_id),

 constraint deliveries_order_restaurant_match
  foreign key (
    order_id,
    restaurant_id
  )
  references public.orders (
    id,
    restaurant_id
  ),
  constraint deliveries_distance_km_check
    check (
      distance_km is null
      or distance_km >= 0
    ),

  constraint deliveries_delivery_fee_check
    check (
      delivery_fee is null
      or delivery_fee >= 0
    ),

  constraint deliveries_issue_reason_required_check
    check (
      status <> 'ATTEMPT_FAILED'
      or issue_reason is not null
    ),

  constraint deliveries_issue_reported_at_required_check
    check (
      status <> 'ATTEMPT_FAILED'
      or issue_reported_at is not null
    )
);

create index deliveries_restaurant_id_idx
  on public.deliveries (restaurant_id);

create index deliveries_status_idx
  on public.deliveries (status);

create index deliveries_restaurant_status_idx
  on public.deliveries (restaurant_id, status);

create index deliveries_issue_decision_deadline_idx
  on public.deliveries (issue_decision_deadline)
  where issue_decision_deadline is not null;

-- unique(order_id) e unique(tracking_token) já criam índices.

-- =========================================================
-- ROUTES
-- =========================================================

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  courier_id uuid not null references public.couriers(id),
  courier_shift_id uuid not null,
  status public.route_status not null default 'PREPARING',
  started_at timestamptz,
  returning_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

    constraint routes_restaurant_identity_unique
    unique (id, restaurant_id),

  constraint routes_courier_identity_unique
    unique (id, courier_id),

  constraint routes_courier_shift_match
    foreign key (
      courier_shift_id,
      restaurant_id,
      courier_id
    )
    references public.courier_shifts (
      id,
      restaurant_id,
      courier_id
    )
);

create index routes_restaurant_id_idx
  on public.routes (restaurant_id);

create index routes_courier_id_idx
  on public.routes (courier_id);

create index routes_courier_shift_id_idx
  on public.routes (courier_shift_id);

create index routes_status_idx
  on public.routes (status);

create index routes_restaurant_status_idx
  on public.routes (restaurant_id, status);

create index routes_courier_status_idx
  on public.routes (courier_id, status);

-- Um motoboy não pode possuir mais de uma rota operacional ativa.
create unique index routes_one_active_route_per_courier_idx
  on public.routes (courier_id)
  where status in ('PREPARING', 'ON_ROUTE', 'RETURNING');

-- =========================================================
-- ROUTE DELIVERIES
-- =========================================================

create table public.route_deliveries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  route_id uuid not null,
  delivery_id uuid not null,
  sequence integer not null,
  created_at timestamptz not null default now(),

  constraint route_deliveries_route_restaurant_match
    foreign key (
      route_id,
      restaurant_id
    )
    references public.routes (
      id,
      restaurant_id
    ),

  constraint route_deliveries_delivery_restaurant_match
    foreign key (
      delivery_id,
      restaurant_id
    )
    references public.deliveries (
      id,
      restaurant_id
    ),

  constraint route_deliveries_sequence_check
    check (sequence > 0),

  constraint route_deliveries_route_delivery_unique
    unique (route_id, delivery_id),

  constraint route_deliveries_route_sequence_unique
    unique (route_id, sequence)
);

create index route_deliveries_route_id_idx
  on public.route_deliveries (route_id);

create index route_deliveries_delivery_id_idx
  on public.route_deliveries (delivery_id);

create index route_deliveries_route_sequence_idx
  on public.route_deliveries (route_id, sequence);

-- =========================================================
-- IMPORTANT DOMAIN NOTES
-- =========================================================
--
-- A Delivery may appear in more than one Route over its lifetime.
-- Example:
--   Route 1 -> failed / returned to store
--   Route 2 -> same Delivery retried later
--
-- However, the same Delivery must never belong to two active Routes
-- at the same time.
--
-- This rule depends on the status of another table (routes), so it
-- cannot be represented by a simple unique constraint.
-- It will be enforced later through RPC/backend transaction logic.
--
-- Route composition rules:
--
-- PREPARING:
--   - deliveries may be added
--   - deliveries may be removed
--   - sequence may be changed
--
-- ON_ROUTE:
--   - no new deliveries may be added
--   - sequence may not be manually reordered
--   - a failed delivery may be skipped without changing sequence
--
-- Delivery failure rules:
--
-- NEXT
--   -> DELIVERED
--
-- or
--
-- NEXT
--   -> ATTEMPT_FAILED
--
-- Store may then choose:
--
-- ATTEMPT_FAILED
--   -> ON_ROUTE
--   -> NEXT later
--
-- or
--
-- ATTEMPT_FAILED
--   -> RETURN_TO_STORE
--
-- If the store does not decide before issue_decision_deadline,
-- the system may automatically move it to RETURN_TO_STORE.
--
-- If all other deliveries are finished and an ATTEMPT_FAILED
-- still has no decision, it should also become RETURN_TO_STORE.
--
-- Route becomes RETURNING when every Delivery in it is one of:
--
-- DELIVERED
-- CANCELLED
-- RETURN_TO_STORE