-- RPM-CORE-003 fix. The store's decision window already existed as
-- restaurants.delivery_issue_timeout_minutes (initial schema, default 10).
-- Slice 3 added a duplicate, issue_decision_minutes; this moves
-- report_delivery_failure back to the original column and drops the copy.
-- Forward-only; hosted application requires separate approval.
begin;

-- Never drop a value someone chose: stop if the two columns disagree.
do $$
begin
  if exists (select 1 from public.restaurants
             where issue_decision_minutes <> delivery_issue_timeout_minutes) then
    raise exception 'RPM_DECISION_COLUMNS_DIVERGE'
      using detail = 'restaurants.issue_decision_minutes differs from delivery_issue_timeout_minutes';
  end if;
end $$;

-- Same body as slice 3, reading delivery_issue_timeout_minutes.
-- CREATE OR REPLACE keeps the existing owner and grants.
create or replace function public.report_delivery_failure(
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

  select v_now + make_interval(mins => delivery_issue_timeout_minutes) into v_deadline
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

alter table public.restaurants
  drop constraint restaurants_issue_decision_minutes_check,
  drop column issue_decision_minutes;

notify pgrst, 'reload schema';
commit;
