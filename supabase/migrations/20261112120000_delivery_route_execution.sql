-- RPM-CORE-003. Núcleo operacional, fatia 3: execução da rota.
-- Forward-only; hosted application requires separate approval.
-- Design: docs/delivery-core-commands.md, docs/delivery-occurrences-prototype.md
begin;

-- =========================================================
-- SCHEMA
-- =========================================================

-- Minutes the store has to decide a failed attempt before it returns.
alter table public.restaurants
  add column issue_decision_minutes integer not null default 10,
  add constraint restaurants_issue_decision_minutes_check
    check (issue_decision_minutes between 1 and 60);

-- A retried delivery goes after the remaining first attempts, in the order
-- the store decided the retries. The planned sequence never changes.
alter table public.route_deliveries
  add column retry_queued_at timestamptz;

-- Append-only record of every attempt: what happened at the door and, for
-- failures, how the occurrence was closed. Also the idempotency key of the
-- courier's commands (Android retries/offline sync).
create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  route_id uuid not null,
  delivery_id uuid not null,
  attempt integer not null,
  outcome text not null,
  reason public.delivery_issue_reason,
  notes text,
  reported_at timestamptz not null,
  reported_by uuid not null references public.profiles(id),
  decision_deadline timestamptz,
  decision text,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  client_request_id uuid not null,

  constraint delivery_attempts_route_restaurant_match
    foreign key (route_id, restaurant_id) references public.routes (id, restaurant_id),
  constraint delivery_attempts_delivery_restaurant_match
    foreign key (delivery_id, restaurant_id) references public.deliveries (id, restaurant_id),
  constraint delivery_attempts_route_delivery_match
    foreign key (route_id, delivery_id) references public.route_deliveries (route_id, delivery_id),
  constraint delivery_attempts_attempt_check check (attempt > 0),
  constraint delivery_attempts_outcome_check check (outcome in ('DELIVERED','FAILED')),
  constraint delivery_attempts_decision_check
    check (decision in ('RETRY','RETURN','CANCEL','TIMEOUT','OTHERS_FINISHED')),
  constraint delivery_attempts_notes_check check (char_length(notes) <= 500),
  constraint delivery_attempts_shape_check check (
    (outcome = 'DELIVERED' and reason is null and decision_deadline is null and decision is null)
    or (outcome = 'FAILED' and reason is not null and decision_deadline is not null)),
  constraint delivery_attempts_decision_pair_check
    check ((decision is null) = (decided_at is null)),
  -- Only people decide; automatic closures have no actor.
  constraint delivery_attempts_decided_by_check
    check (decided_by is null or decision in ('RETRY','RETURN','CANCEL')),
  constraint delivery_attempts_number_unique unique (route_id, delivery_id, attempt),
  constraint delivery_attempts_request_unique unique (route_id, client_request_id)
);

create index delivery_attempts_restaurant_id_idx on public.delivery_attempts (restaurant_id);
create index delivery_attempts_delivery_id_idx on public.delivery_attempts (delivery_id);
-- At most one undecided failure per delivery.
create unique index delivery_attempts_one_open_issue_idx
  on public.delivery_attempts (delivery_id)
  where outcome = 'FAILED' and decision is null;

alter table public.delivery_attempts enable row level security;
revoke all on table public.delivery_attempts from public, anon, authenticated;
grant select on table public.delivery_attempts to authenticated;
create policy delivery_attempts_select_allowed
on public.delivery_attempts
for select
to authenticated
using (
  private.is_restaurant_member(restaurant_id)
  or private.courier_owns_route(route_id)
);

-- An offline batch sent twice must not duplicate the trail.
create unique index courier_locations_route_recorded_at_unique_idx
  on public.courier_locations (route_id, recorded_at);

-- =========================================================
-- PRIVATE HELPERS
-- =========================================================

create function private.require_courier()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_courier uuid;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  v_courier := private.current_courier_id();
  if v_courier is null then
    raise exception 'RPM_COURIER_REQUIRED' using errcode='42501';
  end if;
  return v_courier;
end; $$;

-- Locks shift -> route -> every delivery of the route (id order), each in
-- its own statement. Returns the route row read under its lock, or NULL.
create function private.lock_route_execution(p_route_id uuid)
returns public.routes language plpgsql security definer set search_path='' as $$
declare
  v_shift_id uuid;
  v_route public.routes;
begin
  -- courier_shift_id never changes, so reading it unlocked is safe.
  select courier_shift_id into v_shift_id from public.routes where id = p_route_id;
  if not found then return null; end if;
  perform 1 from public.courier_shifts where id = v_shift_id for update;
  select * into v_route from public.routes where id = p_route_id for update;
  perform private.lock_deliveries(v_route.restaurant_id, private.route_delivery_ids(v_route.id));
  return v_route;
end; $$;

-- Courier's own route or the same "not found" for anything else.
create function private.courier_route_id(p_courier_id uuid, p_route_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if not exists (select 1 from public.routes where id = p_route_id and courier_id = p_courier_id) then
    raise exception 'RPM_ROUTE_NOT_FOUND' using errcode='P0002';
  end if;
  return p_route_id;
end; $$;

-- Undecided failures past their deadline return to the store. The deadline
-- wins at the exact boundary, even over a decision arriving in the same tick.
-- Caller holds the route execution locks.
create function private.settle_route_issues(p_route_id uuid, p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  with closed as (
    update public.delivery_attempts set decision='TIMEOUT', decided_at=p_now
      where route_id = p_route_id and outcome = 'FAILED' and decision is null
        and decision_deadline <= p_now
      returning delivery_id
  )
  update public.deliveries set status='RETURN_TO_STORE', issue_decision_deadline=null
    where id in (select delivery_id from closed) and status = 'ATTEMPT_FAILED';
end; $$;

-- Keeps exactly one NEXT while something is left to attempt: first attempts
-- in planned sequence, then retries in decision order. When nothing is
-- left, undecided failures return and the route/shift become RETURNING.
-- Caller holds the route execution locks.
create function private.advance_route(p_route_id uuid, p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_route public.routes;
  v_next uuid;
begin
  select * into v_route from public.routes where id = p_route_id;
  if v_route.status <> 'ON_ROUTE' then return; end if;
  if exists (select 1 from public.route_deliveries rd
    join public.deliveries d on d.id = rd.delivery_id
    where rd.route_id = p_route_id and d.status = 'NEXT') then
    return;
  end if;

  select rd.delivery_id into v_next from public.route_deliveries rd
    join public.deliveries d on d.id = rd.delivery_id
    where rd.route_id = p_route_id and d.status = 'ON_ROUTE'
    order by (rd.retry_queued_at is not null), rd.retry_queued_at, rd.sequence
    limit 1;
  if found then
    update public.deliveries set status='NEXT' where id = v_next;
    return;
  end if;

  with closed as (
    update public.delivery_attempts set decision='OTHERS_FINISHED', decided_at=p_now
      where route_id = p_route_id and outcome = 'FAILED' and decision is null
      returning delivery_id
  )
  update public.deliveries set status='RETURN_TO_STORE', issue_decision_deadline=null
    where id in (select delivery_id from closed) and status = 'ATTEMPT_FAILED';
  update public.routes set status='RETURNING', returning_at=p_now where id = p_route_id;
  update public.courier_shifts set status='RETURNING'
    where id = v_route.courier_shift_id and status = 'ON_ROUTE';
end; $$;

create function private.route_progress(p_route_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('routeId', r.id, 'status', r.status,
    'version', r.composition_version,
    'nextDeliveryId', (select rd.delivery_id from public.route_deliveries rd
      join public.deliveries d on d.id = rd.delivery_id
      where rd.route_id = r.id and d.status = 'NEXT'))
  from public.routes r where r.id = p_route_id;
$$;

create function private.delivery_state(p_delivery_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('deliveryId', d.id, 'deliveryStatus', d.status)
  from public.deliveries d where d.id = p_delivery_id;
$$;

-- Status of a delivery inside a route, or NULL when it is not part of it.
create function private.route_delivery_status(p_route_id uuid, p_delivery_id uuid)
returns public.delivery_status language sql stable security definer set search_path='' as $$
  select d.status from public.route_deliveries rd
    join public.deliveries d on d.id = rd.delivery_id
    where rd.route_id = p_route_id and rd.delivery_id = p_delivery_id;
$$;

-- The started route of the restaurant that currently carries the delivery.
create function private.on_route_route_id(p_restaurant_id uuid, p_delivery_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select r.id from public.route_deliveries rd
    join public.routes r on r.id = rd.route_id
    where rd.delivery_id = p_delivery_id and r.restaurant_id = p_restaurant_id
      and r.status = 'ON_ROUTE';
$$;

-- =========================================================
-- COURIER COMMANDS
-- =========================================================

-- "Recolhi os pedidos · Iniciar rota". Only the assigned courier, only
-- after the store released the pickup of the composition they saw.
create function public.start_route(p_route_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
  v_shift public.courier_shifts;
  v_ids uuid[];
begin
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);

  if v_route.status in ('ON_ROUTE','RETURNING','COMPLETED') then
    return private.route_progress(v_route.id) || jsonb_build_object('started', false);
  end if;
  if v_route.status <> 'PREPARING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  if p_expected_version is distinct from v_route.composition_version then
    raise exception 'RPM_ROUTE_STALE' using errcode='55000';
  end if;
  if v_route.pickup_released_at is null then
    raise exception 'RPM_PICKUP_NOT_RELEASED' using errcode='55000';
  end if;

  select * into v_shift from public.courier_shifts where id = v_route.courier_shift_id;
  if v_shift.status <> 'AVAILABLE' then
    raise exception 'RPM_SHIFT_NOT_AVAILABLE' using errcode='55000';
  end if;
  perform 1 from public.restaurant_couriers rc
    join public.restaurants r on r.id = rc.restaurant_id
    where rc.id = v_shift.restaurant_courier_id and rc.status = 'ACTIVE' and r.is_active
    for share of rc;
  if not found then
    raise exception 'RPM_COURIER_LINK_REQUIRED' using errcode='55000';
  end if;

  v_ids := private.route_delivery_ids(v_route.id);
  if cardinality(v_ids) = 0 or exists (select 1 from public.deliveries
    where id = any(v_ids) and status <> 'ASSIGNED') then
    raise exception 'RPM_DELIVERY_UNAVAILABLE' using errcode='55000';
  end if;

  update public.deliveries set status='ON_ROUTE', started_at=v_now where id = any(v_ids);
  update public.orders set status='DELIVERING'
    where id in (select order_id from public.deliveries where id = any(v_ids));
  update public.routes set status='ON_ROUTE', started_at=v_now where id = v_route.id;
  update public.courier_shifts set status='ON_ROUTE' where id = v_shift.id;
  perform private.advance_route(v_route.id, v_now);
  return private.route_progress(v_route.id) || jsonb_build_object('started', true);
end; $$;

create function public.complete_delivery(p_request_id uuid, p_route_id uuid, p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
  v_attempt public.delivery_attempts;
  v_status public.delivery_status;
begin
  if p_request_id is null then
    raise exception 'RPM_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);

  -- Replay check after the locks: a concurrent replay sees the committed attempt.
  select * into v_attempt from public.delivery_attempts
    where route_id = v_route.id and client_request_id = p_request_id;
  if found then
    return private.route_progress(v_route.id) || private.delivery_state(v_attempt.delivery_id)
      || jsonb_build_object('outcome', v_attempt.outcome, 'replayed', true);
  end if;
  if v_route.status <> 'ON_ROUTE' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  perform private.settle_route_issues(v_route.id, v_now);

  v_status := private.route_delivery_status(v_route.id, p_delivery_id);
  if v_status is null then
    raise exception 'RPM_DELIVERY_NOT_FOUND' using errcode='P0002';
  end if;
  -- Only the current stop. A delivery cancelled meanwhile reports its status.
  if v_status <> 'NEXT' then
    raise exception 'RPM_DELIVERY_STATE' using errcode='55000', detail=v_status::text;
  end if;

  insert into public.delivery_attempts (restaurant_id, route_id, delivery_id, attempt,
    outcome, reported_at, reported_by, client_request_id)
  values (v_route.restaurant_id, v_route.id, p_delivery_id,
    (select count(*) + 1 from public.delivery_attempts
      where route_id = v_route.id and delivery_id = p_delivery_id),
    'DELIVERED', v_now, auth.uid(), p_request_id);
  update public.deliveries set status='DELIVERED', delivered_at=v_now where id = p_delivery_id;
  update public.orders set status='DELIVERED'
    where id = (select order_id from public.deliveries where id = p_delivery_id);
  perform private.advance_route(v_route.id, v_now);
  return private.route_progress(v_route.id) || private.delivery_state(p_delivery_id)
    || jsonb_build_object('outcome', 'DELIVERED', 'replayed', false);
end; $$;

-- "Não consegui entregar". OTHER requires a short description.
create function public.report_delivery_failure(
  p_request_id uuid, p_route_id uuid, p_delivery_id uuid, p_reason text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_notes text := private.clean_text(p_notes);
  v_route public.routes;
  v_attempt public.delivery_attempts;
  v_status public.delivery_status;
  v_deadline timestamptz;
begin
  if p_request_id is null then
    raise exception 'RPM_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;
  if p_reason is null or p_reason not in
    ('CUSTOMER_NOT_FOUND','CUSTOMER_NOT_RESPONDING','ADDRESS_PROBLEM','OTHER') then
    raise exception 'RPM_FAILURE_FIELDS' using errcode='22023', detail='reason';
  end if;
  if char_length(v_notes) > 500
    or (p_reason = 'OTHER' and coalesce(char_length(v_notes), 0) < 3) then
    raise exception 'RPM_FAILURE_FIELDS' using errcode='22023', detail='notes';
  end if;
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);

  select * into v_attempt from public.delivery_attempts
    where route_id = v_route.id and client_request_id = p_request_id;
  if found then
    return private.route_progress(v_route.id) || private.delivery_state(v_attempt.delivery_id)
      || jsonb_build_object('outcome', v_attempt.outcome, 'replayed', true);
  end if;
  if v_route.status <> 'ON_ROUTE' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  perform private.settle_route_issues(v_route.id, v_now);

  v_status := private.route_delivery_status(v_route.id, p_delivery_id);
  if v_status is null then
    raise exception 'RPM_DELIVERY_NOT_FOUND' using errcode='P0002';
  end if;
  if v_status <> 'NEXT' then
    raise exception 'RPM_DELIVERY_STATE' using errcode='55000', detail=v_status::text;
  end if;

  select v_now + make_interval(mins => issue_decision_minutes) into v_deadline
    from public.restaurants where id = v_route.restaurant_id;
  insert into public.delivery_attempts (restaurant_id, route_id, delivery_id, attempt,
    outcome, reason, notes, reported_at, reported_by, decision_deadline, client_request_id)
  values (v_route.restaurant_id, v_route.id, p_delivery_id,
    (select count(*) + 1 from public.delivery_attempts
      where route_id = v_route.id and delivery_id = p_delivery_id),
    'FAILED', p_reason::public.delivery_issue_reason, v_notes, v_now, auth.uid(),
    v_deadline, p_request_id);
  update public.deliveries set status='ATTEMPT_FAILED',
    issue_reason=p_reason::public.delivery_issue_reason, issue_notes=v_notes,
    issue_reported_at=v_now, issue_decision_deadline=v_deadline
    where id = p_delivery_id;
  -- With nothing else to attempt, the failure returns to the store at once.
  perform private.advance_route(v_route.id, v_now);
  return private.route_progress(v_route.id) || private.delivery_state(p_delivery_id)
    || jsonb_build_object('outcome', 'FAILED', 'replayed', false);
end; $$;

-- Back at the store: the courier joins the end of the available queue.
create function public.arrive_at_store(p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);
  if v_route.status = 'COMPLETED' then
    return private.route_progress(v_route.id) || jsonb_build_object('changed', false);
  end if;
  if v_route.status <> 'RETURNING' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  update public.routes set status='COMPLETED', arrived_at=v_now, completed_at=v_now
    where id = v_route.id;
  update public.courier_shifts set status='AVAILABLE', available_since=v_now
    where id = v_route.courier_shift_id and status = 'RETURNING';
  return private.route_progress(v_route.id) || jsonb_build_object('changed', true);
end; $$;

-- Batch of up to 100 GPS points: [{latitude, longitude, accuracy?, recordedAt}].
-- Points outside the route's window (device clock, late sync) are dropped;
-- repeated points are ignored. Returns how many were stored.
create function public.record_courier_locations(p_route_id uuid, p_points jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
  v_inserted integer;
  v_last record;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  select * into v_route from public.routes where id = p_route_id;
  if v_route.status not in ('ON_ROUTE','RETURNING','COMPLETED') then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;
  -- Shape first, then values: CASE fixes the evaluation order so a malformed
  -- point never reaches a cast.
  if jsonb_typeof(p_points) is distinct from 'array' then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end if;
  if jsonb_array_length(p_points) not between 1 and 100
    or exists (select 1 from jsonb_array_elements(p_points) e
      where case
        when jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e->'latitude') is distinct from 'number'
          or jsonb_typeof(e->'longitude') is distinct from 'number'
          or coalesce(jsonb_typeof(e->'accuracy'), 'null') not in ('number','null')
          or jsonb_typeof(e->'recordedAt') is distinct from 'string' then true
        else (e->>'latitude')::double precision not between -90 and 90
          or (e->>'longitude')::double precision not between -180 and 180
          or coalesce((e->>'accuracy')::double precision, 0) < 0
      end) then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end if;

  begin
    with points as (
      select (e->>'latitude')::numeric as latitude, (e->>'longitude')::numeric as longitude,
        (e->>'accuracy')::numeric as accuracy, (e->>'recordedAt')::timestamptz as recorded_at
      from jsonb_array_elements(p_points) e
    ), accepted as (
      insert into public.courier_locations (courier_id, route_id, latitude, longitude, accuracy, recorded_at)
        select distinct on (recorded_at) v_courier, v_route.id, latitude, longitude, accuracy, recorded_at
        from points
        where recorded_at between v_route.started_at - interval '1 minute'
          and least(coalesce(v_route.completed_at, v_now), v_now) + interval '1 minute'
        order by recorded_at
      on conflict (route_id, recorded_at) do nothing
      returning latitude, longitude, recorded_at
    )
    select count(*) as n, (array_agg(a.latitude order by a.recorded_at desc))[1] as latitude,
      (array_agg(a.longitude order by a.recorded_at desc))[1] as longitude,
      max(a.recorded_at) as recorded_at
      into v_last from accepted a;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'RPM_LOCATION_FIELDS' using errcode='22023';
  end;
  v_inserted := v_last.n;

  -- The live position only moves forward and only during an active route.
  if v_inserted > 0 and v_route.status in ('ON_ROUTE','RETURNING') then
    update public.couriers set last_latitude=v_last.latitude, last_longitude=v_last.longitude,
      location_updated_at=v_last.recorded_at
      where id = v_courier
        and (location_updated_at is null or location_updated_at < v_last.recorded_at);
  end if;
  return v_inserted;
end; $$;

-- =========================================================
-- STORE COMMANDS (active member, including OPERATOR)
-- =========================================================

-- Decision on a failed attempt: RETRY later in this route, RETURN to the
-- store, or CANCEL the order. Repeating the applied decision is a success.
create function public.decide_delivery_failure(
  p_restaurant_id uuid, p_delivery_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_route_id uuid;
  v_route public.routes;
  v_attempt public.delivery_attempts;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_decision is null or p_decision not in ('RETRY','RETURN','CANCEL') then
    raise exception 'RPM_DECISION_FIELDS' using errcode='22023', detail='decision';
  end if;

  v_route_id := private.on_route_route_id(p_restaurant_id, p_delivery_id);
  if v_route_id is not null then
    v_route := private.lock_route_execution(v_route_id);
    if v_route.status = 'ON_ROUTE' then
      perform private.settle_route_issues(v_route.id, v_now);
    end if;
  end if;

  select * into v_attempt from public.delivery_attempts
    where delivery_id = p_delivery_id and restaurant_id = p_restaurant_id and outcome = 'FAILED'
    order by reported_at desc, attempt desc
    limit 1;
  if not found then
    raise exception 'RPM_ISSUE_NOT_FOUND' using errcode='P0002';
  end if;
  if v_attempt.decision is not null then
    if v_attempt.decision = p_decision then
      return private.delivery_state(p_delivery_id)
        || jsonb_build_object('decision', v_attempt.decision, 'changed', false);
    end if;
    -- Closed by another decision, the deadline or the end of the route.
    raise exception 'RPM_ISSUE_CLOSED' using errcode='55000', detail=v_attempt.decision;
  end if;
  -- Open issues only exist on started routes, which are locked above.
  if v_route.id is distinct from v_attempt.route_id or v_route.status <> 'ON_ROUTE' then
    raise exception 'RPM_ROUTE_STATE' using errcode='55000';
  end if;

  update public.delivery_attempts set decision=p_decision, decided_at=v_now, decided_by=auth.uid()
    where id = v_attempt.id;
  if p_decision = 'RETRY' then
    update public.deliveries set status='ON_ROUTE', issue_decision_deadline=null
      where id = p_delivery_id;
    update public.route_deliveries set retry_queued_at=v_now
      where route_id = v_route.id and delivery_id = p_delivery_id;
  elsif p_decision = 'RETURN' then
    update public.deliveries set status='RETURN_TO_STORE', issue_decision_deadline=null
      where id = p_delivery_id;
  else
    update public.deliveries set status='CANCELLED', cancelled_at=v_now, issue_decision_deadline=null
      where id = p_delivery_id;
    update public.orders set status='CANCELLED'
      where id = (select order_id from public.deliveries where id = p_delivery_id);
  end if;
  perform private.advance_route(v_route.id, v_now);
  return private.delivery_state(p_delivery_id)
    || jsonb_build_object('decision', p_decision, 'changed', true);
end; $$;

-- Customer gave up while the courier is out. Closes an open failure too.
create function public.cancel_delivery_on_route(p_restaurant_id uuid, p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_route_id uuid;
  v_route public.routes;
  v_status public.delivery_status;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  v_route_id := private.on_route_route_id(p_restaurant_id, p_delivery_id);
  if v_route_id is not null then
    v_route := private.lock_route_execution(v_route_id);
  end if;
  if v_route.status is distinct from 'ON_ROUTE' then
    select status into v_status from public.deliveries
      where id = p_delivery_id and restaurant_id = p_restaurant_id;
    if not found then
      raise exception 'RPM_DELIVERY_NOT_FOUND' using errcode='P0002';
    end if;
    if v_status = 'CANCELLED' then
      return private.delivery_state(p_delivery_id) || jsonb_build_object('changed', false);
    end if;
    raise exception 'RPM_DELIVERY_STATE' using errcode='55000', detail=v_status::text;
  end if;

  perform private.settle_route_issues(v_route.id, v_now);
  v_status := private.route_delivery_status(v_route.id, p_delivery_id);
  if v_status = 'CANCELLED' then
    return private.delivery_state(p_delivery_id) || jsonb_build_object('changed', false);
  end if;
  if v_status not in ('ON_ROUTE','NEXT','ATTEMPT_FAILED') then
    raise exception 'RPM_DELIVERY_STATE' using errcode='55000', detail=v_status::text;
  end if;

  update public.delivery_attempts set decision='CANCEL', decided_at=v_now, decided_by=auth.uid()
    where route_id = v_route.id and delivery_id = p_delivery_id
      and outcome = 'FAILED' and decision is null;
  update public.deliveries set status='CANCELLED', cancelled_at=v_now, issue_decision_deadline=null
    where id = p_delivery_id;
  update public.orders set status='CANCELLED'
    where id = (select order_id from public.deliveries where id = p_delivery_id);
  perform private.advance_route(v_route.id, v_now);
  return private.delivery_state(p_delivery_id) || jsonb_build_object('changed', true);
end; $$;

-- A returned order goes back to the queue only after the courier is back.
-- Never automatic: the store decides whether to dispatch it again.
create function public.requeue_delivery(p_restaurant_id uuid, p_delivery_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_delivery public.deliveries;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select * into v_delivery from public.deliveries
    where id = p_delivery_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'RPM_DELIVERY_NOT_FOUND' using errcode='P0002';
  end if;
  if v_delivery.status = 'WAITING' then return 'WAITING'; end if;
  if v_delivery.status <> 'RETURN_TO_STORE' then
    raise exception 'RPM_DELIVERY_STATE' using errcode='55000', detail=v_delivery.status::text;
  end if;
  if exists (select 1 from public.route_deliveries rd
    join public.routes r on r.id = rd.route_id
    where rd.delivery_id = p_delivery_id and r.status in ('PREPARING','ON_ROUTE','RETURNING')) then
    raise exception 'RPM_DELIVERY_IN_TRANSIT' using errcode='55000';
  end if;
  update public.deliveries set status='WAITING', assigned_at=null, started_at=null,
    issue_decision_deadline=null
    where id = p_delivery_id;
  update public.orders set status='OPEN' where id = v_delivery.order_id;
  return 'WAITING';
end; $$;

-- =========================================================
-- PRIVILEGES
-- =========================================================

revoke all on function private.require_courier(),
  private.lock_route_execution(uuid),
  private.courier_route_id(uuid,uuid),
  private.settle_route_issues(uuid,timestamptz),
  private.advance_route(uuid,timestamptz),
  private.route_progress(uuid),
  private.delivery_state(uuid),
  private.route_delivery_status(uuid,uuid),
  private.on_route_route_id(uuid,uuid)
  from public, anon, authenticated;

revoke all on function
  public.start_route(uuid,integer),
  public.complete_delivery(uuid,uuid,uuid),
  public.report_delivery_failure(uuid,uuid,uuid,text,text),
  public.arrive_at_store(uuid),
  public.record_courier_locations(uuid,jsonb),
  public.decide_delivery_failure(uuid,uuid,text),
  public.cancel_delivery_on_route(uuid,uuid),
  public.requeue_delivery(uuid,uuid)
  from public, anon;

grant execute on function
  public.start_route(uuid,integer),
  public.complete_delivery(uuid,uuid,uuid),
  public.report_delivery_failure(uuid,uuid,uuid,text,text),
  public.arrive_at_store(uuid),
  public.record_courier_locations(uuid,jsonb),
  public.decide_delivery_failure(uuid,uuid,text),
  public.cancel_delivery_on_route(uuid,uuid),
  public.requeue_delivery(uuid,uuid)
  to authenticated;

-- Only SELECT (RLS) on delivery_attempts; no other table write grants.
notify pgrst, 'reload schema';
commit;
