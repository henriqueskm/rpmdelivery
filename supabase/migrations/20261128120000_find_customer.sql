-- Quick order: a customer who already ordered from this store is recognized by the WhatsApp number.
-- Answers the store's own last order for that number (name, address with its pin, bairro, complement)
-- and how many orders the number made here. Members of the store only; never another store's orders.
begin;

create function public.find_customer(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := private.normalize_br_phone(p_phone);
  v public.orders;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  if v_phone is null then
    return null;
  end if;
  select * into v from public.orders
   where restaurant_id = p_restaurant_id and customer_phone = v_phone
   order by coalesce(ordered_at, created_at) desc, created_at desc, id
   limit 1;
  if not found then
    return null;
  end if;
  select count(*) into v_count from public.orders
   where restaurant_id = p_restaurant_id and customer_phone = v_phone and status <> 'CANCELLED';
  return jsonb_build_object(
    'name', v.customer_name,
    'address', v.delivery_address,
    'neighborhood', v.neighborhood,
    'complement', v.complement,
    -- The pin only when it came from the address search, as a new order would carry it.
    'location', case when v.latitude is not null and v.address_provider = 'mapbox' then jsonb_build_object(
      'latitude', v.latitude, 'longitude', v.longitude, 'providerId', v.address_provider_id) end,
    'orders', v_count,
    'lastOrderAt', coalesce(v.ordered_at, v.created_at));
end; $$;

create index if not exists orders_restaurant_phone_idx on public.orders (restaurant_id, customer_phone);

revoke all on function public.find_customer(uuid, text) from public, anon;
grant execute on function public.find_customer(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
