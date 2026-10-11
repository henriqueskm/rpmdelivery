-- Forward-only: latitude/longitude already exist as numeric in the foundation.
-- NOT VALID preserves legacy rows while enforcing new inserts/updates.
begin;

alter table public.restaurants
  alter column latitude type double precision using latitude::double precision,
  alter column longitude type double precision using longitude::double precision,
  add column address_provider text,
  add column address_provider_id text;

alter table public.restaurants add constraint restaurants_coordinates_pair_check
  check ((latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)) not valid;

alter table public.restaurants add constraint restaurants_address_provider_check
  check ((address_provider is null and address_provider_id is null)
    or (address_provider is not null and address_provider = 'mapbox'
      and address_provider_id is not null
      and address_provider_id ~ '^[A-Za-z0-9_-]{1,255}$'
      and latitude is not null and longitude is not null)) not valid;

alter table public.restaurants add constraint restaurants_mobile_phone_check
  check (phone is null or phone ~ '^\+55[1-9][0-9]9[0-9]{8}$') not valid;

-- Existing latitude/longitude interval constraints remain in force.
-- No table grants, RLS policies, legacy addresses or phone data are changed.
drop function public.create_restaurant(text, text, text);

create function public.create_restaurant(
  p_name text,
  p_address text,
  p_phone text,
  p_latitude double precision,
  p_longitude double precision,
  p_address_provider text,
  p_address_provider_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits text;
  v_restaurant_id uuid;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Perfil não encontrado' using errcode = 'P0002';
  end if;
  if v_name = '' or char_length(v_name) > 160
    or v_address = '' or char_length(v_address) > 500 then
    raise exception 'Nome ou endereço inválido' using errcode = '22023';
  end if;
  if p_latitude is null or not (p_latitude between -90 and 90)
    or p_longitude is null or not (p_longitude between -180 and 180)
    or p_address_provider is distinct from 'mapbox'
    or p_address_provider_id is null
    or p_address_provider_id !~ '^[A-Za-z0-9_-]{1,255}$' then
    raise exception 'Localização inválida' using errcode = '22023';
  end if;
  if v_phone is not null then
    if char_length(v_phone) > 30 or v_phone !~ '^\+?[0-9() .-]+$'
      or (v_phone like '+%' and v_phone not like '+55%') then
      raise exception 'Celular inválido' using errcode = '22023';
    end if;
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if v_phone like '+55%' and char_length(v_digits) = 13 then
      v_digits := substring(v_digits from 3);
    end if;
    if v_digits !~ '^[1-9][0-9]9[0-9]{8}$' then
      raise exception 'Celular inválido' using errcode = '22023';
    end if;
    v_phone := '+55' || v_digits;
  end if;

  insert into public.restaurants
    (name, address, phone, latitude, longitude, address_provider, address_provider_id)
  values (v_name, v_address, v_phone, p_latitude, p_longitude, p_address_provider, p_address_provider_id)
  returning id into v_restaurant_id;

  insert into public.restaurant_members (restaurant_id, user_id, role, active)
  values (v_restaurant_id, v_user_id, 'OWNER', true);
  return v_restaurant_id;
end;
$$;

revoke all on function public.create_restaurant(text, text, text, double precision, double precision, text, text)
  from public, anon, authenticated;
grant execute on function public.create_restaurant(text, text, text, double precision, double precision, text, text)
  to authenticated;

commit;
