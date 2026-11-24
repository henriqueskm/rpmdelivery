-- Aviso ao motoboy: a loja encerrou o turno dele.
-- Forward-only; hosted application requires separate approval.
--
-- The store may end a courier's shift ("Fechar o dia", or end_shift from the panel). The app only saw
-- the shift disappear. get_courier_home now also says when the courier's last shift was ended by
-- someone else, so the app tells them ("A Cozinha da Vila encerrou seu turno às 23:40"). Only the
-- latest shift, only in the last 12 hours, and never once a newer shift exists; a shift the courier
-- ended on their own says nothing.
begin;

alter function public.get_courier_home() set schema private;
alter function private.get_courier_home() rename to courier_home_core;

create function public.get_courier_home()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_home jsonb := private.courier_home_core();
  v_courier uuid := private.current_courier_id();
begin
  -- The core checked the courier.
  return v_home || jsonb_build_object('shiftEndedByStore', (
    select jsonb_build_object('shiftId', s.id, 'restaurantName', r.name, 'endedAt', s.ended_at)
      from (select * from public.courier_shifts
              where courier_id = v_courier order by requested_at desc, id desc limit 1) s
      join public.restaurants r on r.id = s.restaurant_id
      join public.couriers c on c.id = s.courier_id
      where s.status = 'ENDED' and s.ended_at >= clock_timestamp() - interval '12 hours'
        and s.ended_by is distinct from c.user_id));
end; $$;

revoke all on function private.courier_home_core() from public, anon, authenticated;
revoke all on function public.get_courier_home() from public, anon;
grant execute on function public.get_courier_home() to authenticated;

notify pgrst, 'reload schema';
commit;
