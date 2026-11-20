-- A loja sempre decide a ocorrência, também na última entrega da rota.
-- Forward-only; hosted application requires separate approval.
-- Before: when the failed stop was the last one left, the route closed its open
-- occurrences at once (OTHERS_FINISHED) and sent the courier back. Now the route
-- waits, the courier sees "aguardando a loja decidir", and only the store's
-- decision or the decision deadline (10 min by default, TIMEOUT) ends it.
begin;

-- Same as before until nothing is left to attempt; then undecided failures wait.
create or replace function private.advance_route(p_route_id uuid, p_now timestamptz)
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

  -- Nothing left to attempt. An occurrence still open is the store's call: the
  -- route stays on the street until it decides or the deadline passes
  -- (settle_route_issues, run by every route command and by settle_courier_route).
  if exists (select 1 from public.delivery_attempts
    where route_id = p_route_id and outcome = 'FAILED' and decision is null) then
    return;
  end if;

  update public.routes set status='RETURNING', returning_at=p_now where id = p_route_id;
  update public.courier_shifts set status='RETURNING'
    where id = v_route.courier_shift_id and status = 'ON_ROUTE';
end; $$;

-- The courier's app calls this while it waits for the store: past the decision
-- deadline the occurrence closes as TIMEOUT and the route starts returning.
-- Nothing else changes; calling it early or twice is harmless.
create function public.settle_courier_route(p_route_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_courier uuid := private.require_courier();
  v_route public.routes;
begin
  perform private.courier_route_id(v_courier, p_route_id);
  v_route := private.lock_route_execution(p_route_id);
  if v_route.status = 'ON_ROUTE' then
    perform private.settle_route_issues(v_route.id, v_now);
    perform private.advance_route(v_route.id, v_now);
  end if;
  return private.route_progress(v_route.id);
end; $$;

revoke all on function private.advance_route(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.settle_courier_route(uuid) from public, anon;
grant execute on function public.settle_courier_route(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
