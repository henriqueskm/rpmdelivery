-- Correção: "Fechar o dia" não abria ("Não foi possível concluir agora").
-- Forward-only; hosted application requires separate approval.
--
-- get_day_close and get_day_close_report are STABLE, so the API (PostgREST) runs them in a READ ONLY
-- transaction. They checked the member with private.require_restaurant_member, which locks the
-- membership row (FOR SHARE) for commands, and a lock is refused in a read-only transaction
-- (25006). Reads check the member without locking, as get_courier_pay does.
begin;

create function private.require_member_to_read(p_restaurant_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode='28000';
  end if;
  if not exists (select 1 from public.restaurant_members rm
      join public.restaurants r on r.id = rm.restaurant_id
      where rm.restaurant_id = p_restaurant_id and rm.user_id = auth.uid() and rm.active and r.is_active) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode='42501';
  end if;
end; $$;

create or replace function public.get_day_close(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_from timestamptz;
begin
  perform private.require_member_to_read(p_restaurant_id);
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

create or replace function public.get_day_close_report(p_restaurant_id uuid, p_close_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb;
begin
  perform private.require_member_to_read(p_restaurant_id);
  select c.report into v_report from private.store_day_closes c
    where c.id = p_close_id and c.restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'RPM_DAY_CLOSE_NOT_FOUND' using errcode='P0002';
  end if;
  return v_report;
end; $$;

revoke all on function private.require_member_to_read(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
