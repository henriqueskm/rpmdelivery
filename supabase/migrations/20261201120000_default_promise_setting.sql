-- The store changes its default delivery promise ("Padrão 60 min") from the panel.
-- Forward-only; hosted application requires separate approval.
-- The value already lives in restaurants.default_delivery_promise_minutes (1..240) and reaches the
-- panel through get_operations_board; this only adds the command that changes it.
begin;

-- Any member of the store's team (owner, manager, operator): the promise is a dispatch-desk choice,
-- like the promise of each order. Orders already saved keep the promise they were given.
create function public.set_default_promise(p_restaurant_id uuid, p_minutes integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 1 and 240 then
    raise exception 'RPM_PROMISE_INVALID' using errcode = '22023';
  end if;
  update public.restaurants
     set default_delivery_promise_minutes = p_minutes
   where id = p_restaurant_id;
  return p_minutes;
end; $$;

revoke all on function public.set_default_promise(uuid, integer) from public, anon;
grant execute on function public.set_default_promise(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
