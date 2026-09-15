-- RpmDelivery
-- Onboarding commands
--
-- Estas RPCs são os primeiros caminhos de escrita controlados do app.
--
-- SECURITY DEFINER é intencional:
--   - escrita direta nas tabelas continua bloqueada por grants/RLS;
--   - a identidade sempre vem de auth.uid();
--   - user_id nunca é aceito como parâmetro do cliente.

-- =========================================================
-- public.create_restaurant
-- =========================================================
--
-- Cria o restaurante e o vínculo OWNER do usuário autenticado
-- de forma atômica. Se qualquer etapa falhar, nada é persistido.
--
-- Os campos minimum_delivery_fee, price_per_km,
-- delivery_issue_timeout_minutes e is_active usam os defaults
-- da própria tabela public.restaurants.

create or replace function public.create_restaurant(
  p_name text,
  p_address text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text;
  v_address text;
  v_phone text;
  v_restaurant_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Usuário não autenticado'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
  ) then
    raise exception 'Perfil não encontrado para o usuário autenticado'
      using errcode = 'P0002';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  v_address := btrim(coalesce(p_address, ''));
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');

  if v_name = '' then
    raise exception 'Nome do restaurante é obrigatório'
      using errcode = '22023';
  end if;

  if v_address = '' then
    raise exception 'Endereço do restaurante é obrigatório'
      using errcode = '22023';
  end if;

  insert into public.restaurants (name, address, phone)
  values (v_name, v_address, v_phone)
  returning id into v_restaurant_id;

  insert into public.restaurant_members (
    restaurant_id,
    user_id,
    role,
    active
  )
  values (
    v_restaurant_id,
    v_user_id,
    'OWNER',
    true
  );

  return v_restaurant_id;
end;
$$;

-- =========================================================
-- public.create_courier_profile
-- =========================================================
--
-- Idempotente: segura para retry.
--
-- Se o usuário autenticado já possui um courier, o id existente é
-- devolvido e nenhum campo é alterado.
--
-- Concorrência: usa a constraint UNIQUE existente em
-- public.couriers.user_id junto com ON CONFLICT DO NOTHING, de
-- modo que duas chamadas simultâneas nunca criam duplicatas.

create or replace function public.create_courier_profile(
  p_motorcycle_model text default null,
  p_motorcycle_plate text default null,
  p_motorcycle_color text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_model text;
  v_plate text;
  v_color text;
  v_courier_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Usuário não autenticado'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
  ) then
    raise exception 'Perfil não encontrado para o usuário autenticado'
      using errcode = 'P0002';
  end if;

  select id into v_courier_id
  from public.couriers
  where user_id = v_user_id;

  if v_courier_id is not null then
    return v_courier_id;
  end if;

  v_model := nullif(btrim(coalesce(p_motorcycle_model, '')), '');
  v_plate := nullif(upper(btrim(coalesce(p_motorcycle_plate, ''))), '');
  v_color := nullif(btrim(coalesce(p_motorcycle_color, '')), '');

  insert into public.couriers (
    user_id,
    motorcycle_model,
    motorcycle_plate,
    motorcycle_color
  )
  values (
    v_user_id,
    v_model,
    v_plate,
    v_color
  )
  on conflict (user_id) do nothing
  returning id into v_courier_id;

  if v_courier_id is null then
    -- Outra chamada concorrente criou a linha primeiro.
    select id into v_courier_id
    from public.couriers
    where user_id = v_user_id;
  end if;

  return v_courier_id;
end;
$$;

-- =========================================================
-- PRIVILÉGIOS
-- =========================================================
--
-- Estas RPCs são os únicos caminhos de escrita desta migration.
-- Escrita direta nas tabelas continua negada por grants/RLS.

revoke all
on function public.create_restaurant(text, text, text)
from public;

revoke all
on function public.create_restaurant(text, text, text)
from anon;

revoke all
on function public.create_restaurant(text, text, text)
from authenticated;

grant execute
on function public.create_restaurant(text, text, text)
to authenticated;

revoke all
on function public.create_courier_profile(text, text, text)
from public;

revoke all
on function public.create_courier_profile(text, text, text)
from anon;

revoke all
on function public.create_courier_profile(text, text, text)
from authenticated;

grant execute
on function public.create_courier_profile(text, text, text)
to authenticated;
