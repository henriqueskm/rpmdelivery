-- RPM-CORE-014. "Excluir minha conta" no app do motoboy (exigência da Play Store e da LGPD).
-- Forward-only; hosted application requires separate approval.
--
-- What is the person goes: name, phone, photo, motorcycle, every GPS point, the links to
-- stores, and (in the Edge Function delete-account) the login itself. What the stores need for
-- their own records stays, without the person: the shifts, routes, deliveries and amounts paid,
-- now under "Conta excluída". The row ids stay so those records keep pointing somewhere.
--
-- Called only by the Edge Function delete-account (service_role) with the user id it verified
-- from the caller's session. Refused while a shift is open (the store is counting on the
-- courier) or when the same login also belongs to a store's team (that is the panel's job).
-- Running it again changes nothing more.
begin;

create function public.erase_courier_account(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_courier public.couriers;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null then
    raise exception 'RPM_ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'RPM_ACCOUNT_NOT_FOUND' using errcode='P0002';
  end if;
  if exists (select 1 from public.restaurant_members where user_id = p_user_id and active) then
    raise exception 'RPM_ACCOUNT_STORE_MEMBER' using errcode='55000';
  end if;

  select * into v_courier from public.couriers where user_id = p_user_id for update;
  if found then
    if exists (select 1 from public.courier_shifts
        where courier_id = v_courier.id and status not in ('ENDED','REJECTED')) then
      raise exception 'RPM_ACCOUNT_SHIFT_OPEN' using errcode='55000';
    end if;
    delete from public.courier_locations where courier_id = v_courier.id;
    update public.couriers set motorcycle_model = null, motorcycle_plate = null, motorcycle_color = null,
        last_latitude = null, last_longitude = null, location_updated_at = null, updated_at = v_now
      where id = v_courier.id;
    -- The stores see the link ended; nobody can approve it again.
    update public.restaurant_couriers set status = 'SUSPENDED', suspended_at = coalesce(suspended_at, v_now),
        updated_at = v_now
      where courier_id = v_courier.id and status in ('ACTIVE','PENDING');
  end if;

  update public.profiles set name = 'Conta excluída', phone = null, photo_url = null, updated_at = v_now
    where id = p_user_id;
  delete from private.courier_invite_attempts where user_id = p_user_id;
  return jsonb_build_object('erased', true);
end; $$;

revoke all on function public.erase_courier_account(uuid) from public, anon, authenticated;
grant execute on function public.erase_courier_account(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
