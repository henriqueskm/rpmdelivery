-- Fechamento do dia: encerra o turno de todos os motoboys e guarda o relatório.
-- Forward-only; hosted application requires separate approval.
--
-- At the end of the day the store closes it in one command:
--   * every courier's open shift ends (in line or waiting for approval). A courier still out on a
--     route keeps the shift until coming back, and the report says so: closing never waits on them;
--   * a report of the period is saved: from the previous close (or the last 24 hours, the first
--     time) until now. A period, not a calendar day, so a store that closes at 1 a.m. keeps its
--     deliveries after midnight in the same report.
-- The report keeps what each courier delivered, earned (encosta + per delivery, the values copied
-- when earned) and collected at the door (cash, card, Pix), and what happened to the orders
-- received. It is saved as it was at closing time: later changes never rewrite it.
begin;

create table private.store_day_closes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  period_start timestamptz not null,
  closed_at timestamptz not null,
  closed_by uuid references public.profiles(id) on delete set null,
  client_request_id uuid not null,
  report jsonb not null,
  constraint store_day_closes_period_check check (period_start < closed_at),
  constraint store_day_closes_request_unique unique (restaurant_id, client_request_id)
);
create index store_day_closes_recent_idx on private.store_day_closes (restaurant_id, closed_at desc);
revoke all on table private.store_day_closes from public, anon, authenticated;

-- Where the open period starts: the last close, or 24 hours ago the first time.
create function private.day_period_start(p_restaurant uuid, p_now timestamptz)
returns timestamptz language sql stable security definer set search_path='' as $$
  select coalesce(
    (select max(c.closed_at) from private.store_day_closes c where c.restaurant_id = p_restaurant),
    p_now - interval '24 hours');
$$;

-- The report of [p_from, p_to). Couriers by name; amounts in cents.
create function private.day_report(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  with delivered as (
    -- Each delivery done in the period, by whom, with what the courier earned and collected.
    select r.courier_id, coalesce(a.courier_fee_cents, 0) as fee, o.payment_method as method,
           coalesce(o.amount_due_cents, 0) as due
      from public.delivery_attempts a
      join public.routes r on r.id = a.route_id
      join public.deliveries d on d.id = a.delivery_id
      join public.orders o on o.id = d.order_id
      where r.restaurant_id = p_restaurant and a.outcome = 'DELIVERED'
        and a.reported_at >= p_from and a.reported_at < p_to
  ), encosta as (
    -- The encosta counts once per courier per day, as in the courier's earnings.
    select x.courier_id, sum(x.fee)::integer as fee
      from (select s.courier_id, (s.approved_at at time zone 'America/Sao_Paulo')::date,
              (array_agg(coalesce(s.shift_fee_cents, 0) order by s.approved_at, s.id))[1] as fee
            from public.courier_shifts s
            where s.restaurant_id = p_restaurant and s.approved_at >= p_from and s.approved_at < p_to
            group by 1, 2) x
      group by x.courier_id
  ), per_courier as (
    select coalesce(e.courier_id, d.courier_id) as courier_id,
           coalesce(d.deliveries, 0) as deliveries, coalesce(e.fee, 0) as shift_fee,
           coalesce(d.fees, 0) as delivery_fees, coalesce(d.cash, 0) as cash,
           coalesce(d.card, 0) as card, coalesce(d.pix, 0) as pix
      from encosta e
      full join (select courier_id, count(*)::integer as deliveries, sum(fee)::integer as fees,
                   sum(due) filter (where method = 'CASH')::integer as cash,
                   sum(due) filter (where method = 'CARD')::integer as card,
                   sum(due) filter (where method = 'PIX')::integer as pix
                 from delivered group by courier_id) d on d.courier_id = e.courier_id
  ), received as (
    select o.status, d.status as delivery_status
      from public.orders o join public.deliveries d on d.order_id = o.id
      where o.restaurant_id = p_restaurant and o.created_at >= p_from and o.created_at < p_to
  )
  select jsonb_build_object(
    'periodStart', p_from,
    'periodEnd', p_to,
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'name', p.name, 'deliveries', c.deliveries,
        'shiftFeeCents', c.shift_fee, 'deliveryFeesCents', c.delivery_fees,
        'totalCents', c.shift_fee + c.delivery_fees,
        'cashCents', c.cash, 'cardCents', c.card, 'pixCents', c.pix)
        order by p.name, c.courier_id)
      from per_courier c
      join public.couriers k on k.id = c.courier_id
      join public.profiles p on p.id = k.user_id), '[]'::jsonb),
    'orders', (select jsonb_build_object(
        'received', count(*),
        'delivered', count(*) filter (where status = 'DELIVERED'),
        'cancelled', count(*) filter (where status = 'CANCELLED'),
        'waiting', count(*) filter (where status = 'OPEN' and delivery_status = 'WAITING'),
        'onTheWay', count(*) filter (where status not in ('DELIVERED', 'CANCELLED')
          and not (status = 'OPEN' and delivery_status = 'WAITING')))
      from received),
    'payments', (select jsonb_build_object(
        'paid', count(*) filter (where method = 'PAID'),
        'cashCents', coalesce(sum(due) filter (where method = 'CASH'), 0),
        'cardCents', coalesce(sum(due) filter (where method = 'CARD'), 0),
        'pixCents', coalesce(sum(due) filter (where method = 'PIX'), 0),
        'notInformed', count(*) filter (where method is null))
      from delivered));
$$;

-- The store's couriers with an open shift: in line, waiting for approval, or out on a route.
create function private.open_shifts(p_restaurant uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'shiftId', s.id, 'name', p.name, 'status', s.status,
      'onRoute', s.status in ('ON_ROUTE', 'RETURNING') or exists (select 1 from public.routes r
        where r.courier_shift_id = s.id and r.status in ('PREPARING', 'ON_ROUTE', 'RETURNING')))
      order by p.name, s.id), '[]'::jsonb)
    from public.courier_shifts s
    join public.couriers k on k.id = s.courier_id
    join public.profiles p on p.id = k.user_id
    where s.restaurant_id = p_restaurant and s.status in ('PENDING', 'AVAILABLE', 'ON_ROUTE', 'RETURNING');
$$;

-- What closing now would do and say, and the last closes. Any active member.
create function public.get_day_close(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_from timestamptz;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  v_from := private.day_period_start(p_restaurant_id, v_now);
  return jsonb_build_object(
    'openShifts', private.open_shifts(p_restaurant_id),
    'preview', private.day_report(p_restaurant_id, v_from, v_now),
    'closes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'periodStart', c.period_start, 'closedAt', c.closed_at,
        'closedBy', coalesce(p.name, 'Conta excluída'))
        order by c.closed_at desc)
      from (select * from private.store_day_closes
              where restaurant_id = p_restaurant_id order by closed_at desc limit 60) c
      left join public.profiles p on p.id = c.closed_by), '[]'::jsonb));
end; $$;

-- A saved report, as it was when the day was closed.
create function public.get_day_close_report(p_restaurant_id uuid, p_close_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  select c.report into v_report from private.store_day_closes c
    where c.id = p_close_id and c.restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'RPM_DAY_CLOSE_NOT_FOUND' using errcode='P0002';
  end if;
  return v_report;
end; $$;

-- Ends the shift of every courier not out on a route, and saves the report of the period.
-- A replay (same request id) answers the close already saved.
create function public.close_store_day(p_restaurant_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz;
  v_from timestamptz;
  v_close private.store_day_closes;
  v_ended jsonb;
  v_report jsonb;
begin
  perform private.require_restaurant_member(p_restaurant_id);
  if p_request_id is null then
    raise exception 'RPM_REQUEST_ID_REQUIRED' using errcode='22023';
  end if;
  -- One close at a time per store: two counters pressing it together make one close, then a second
  -- one for the (empty) moment between them, never two overlapping periods. "No key update" still
  -- lets orders and routes of the store be saved meanwhile.
  perform 1 from public.restaurants where id = p_restaurant_id for no key update;

  select * into v_close from private.store_day_closes
    where restaurant_id = p_restaurant_id and client_request_id = p_request_id;
  if found then
    return jsonb_build_object('closeId', v_close.id, 'created', false, 'report', v_close.report);
  end if;

  v_now := clock_timestamp();
  v_from := private.day_period_start(p_restaurant_id, v_now);

  -- Lock first, check after, in two statements: a statement that waited for a lock still sees the
  -- rows as they were before the wait (READ COMMITTED), so a route the store created meanwhile would
  -- be missed. The next statement takes a fresh look. Shifts are locked in id order.
  perform 1 from public.courier_shifts s
    where s.restaurant_id = p_restaurant_id and s.status in ('PENDING', 'AVAILABLE')
    order by s.id
    for update;
  with ended as (
    update public.courier_shifts s set status = 'ENDED', ended_at = v_now, ended_by = auth.uid()
      where s.restaurant_id = p_restaurant_id and s.status in ('PENDING', 'AVAILABLE')
        and not exists (select 1 from public.routes r
          where r.courier_shift_id = s.id and r.status in ('PREPARING', 'ON_ROUTE', 'RETURNING'))
      returning s.courier_id
  )
  select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) into v_ended
    from ended e
    join public.couriers k on k.id = e.courier_id
    join public.profiles p on p.id = k.user_id;

  v_report := private.day_report(p_restaurant_id, v_from, v_now) || jsonb_build_object(
    'endedShifts', v_ended,
    -- Still out on a route: their shift goes on until they come back.
    'stillOut', (select coalesce(jsonb_agg(x->>'name' order by x->>'name'), '[]'::jsonb)
      from jsonb_array_elements(private.open_shifts(p_restaurant_id)) x));

  insert into private.store_day_closes (restaurant_id, period_start, closed_at, closed_by, client_request_id, report)
    values (p_restaurant_id, v_from, v_now, auth.uid(), p_request_id, v_report)
    returning * into v_close;
  return jsonb_build_object('closeId', v_close.id, 'created', true, 'report', v_report);
end; $$;

revoke all on function
  private.day_period_start(uuid, timestamptz),
  private.day_report(uuid, timestamptz, timestamptz),
  private.open_shifts(uuid)
  from public, anon, authenticated;
revoke all on function
  public.get_day_close(uuid),
  public.get_day_close_report(uuid, uuid),
  public.close_store_day(uuid, uuid)
  from public, anon;
grant execute on function
  public.get_day_close(uuid),
  public.get_day_close_report(uuid, uuid),
  public.close_store_day(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
