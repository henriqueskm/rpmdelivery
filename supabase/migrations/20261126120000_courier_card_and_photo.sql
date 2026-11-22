-- Courier card in the store panel, and the courier's profile photo.
--
-- Photo: private bucket courier-photos, one JPEG per courier at "<user id>/avatar.jpg" (up to 1 MB).
-- Only the courier writes it; the courier and the stores that can already see that courier
-- (private.can_view_courier: ACTIVE link, or PENDING for owner/manager) read it, through short signed URLs.
-- profiles.photo_url only says "there is a photo"; the path is always derived from the user id.
--
-- Card: get_courier_card(shift) for members of the shift's store, read only when the counter opens it.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('courier-photos', 'courier-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.is_own_courier_photo(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_name = auth.uid()::text || '/avatar.jpg'
    and exists (select 1 from public.couriers c where c.user_id = auth.uid());
$$;

create or replace function private.can_view_courier_photo(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_own_courier_photo(p_name)
    or exists (
      select 1 from public.couriers c
      where c.user_id::text || '/avatar.jpg' = p_name and private.can_view_courier(c.id)
    );
$$;

revoke all on function private.is_own_courier_photo(text) from public;
revoke all on function private.can_view_courier_photo(text) from public;
grant execute on function private.is_own_courier_photo(text) to authenticated;
grant execute on function private.can_view_courier_photo(text) to authenticated;

drop policy if exists courier_photos_select on storage.objects;
drop policy if exists courier_photos_insert on storage.objects;
drop policy if exists courier_photos_update on storage.objects;
drop policy if exists courier_photos_delete on storage.objects;

create policy courier_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'courier-photos' and private.can_view_courier_photo(name));
-- Replacing the photo is an upsert: insert, or update the same object.
create policy courier_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'courier-photos' and private.is_own_courier_photo(name));
create policy courier_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'courier-photos' and private.is_own_courier_photo(name))
  with check (bucket_id = 'courier-photos' and private.is_own_courier_photo(name));
create policy courier_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'courier-photos' and private.is_own_courier_photo(name));

-- =========================================================
-- COURIER: "there is a photo" after uploading it, or none after removing it
-- =========================================================

create function public.set_courier_photo(p_has_photo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.couriers where user_id = v_user) then
    raise exception 'RPM_COURIER_REQUIRED' using errcode = '42501';
  end if;
  update public.profiles
     set photo_url = case when coalesce(p_has_photo, false) then v_user::text || '/avatar.jpg' end,
         updated_at = now()
   where id = v_user;
  return jsonb_build_object('hasPhoto', coalesce(p_has_photo, false));
end; $$;

-- =========================================================
-- STORE: the courier card, opened from the couriers column
-- =========================================================

create function public.get_courier_card(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  v_today date := private.local_today();
  v_deliveries integer;
  v_total integer;
  v_here integer;
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  select s.id as shift_id, s.restaurant_id, s.status as shift_status, s.requested_at, s.available_since,
         c.id as courier_id, c.user_id, c.motorcycle_model, c.motorcycle_plate, c.motorcycle_color,
         c.location_updated_at, p.name, p.phone, p.photo_url,
         rc.status as link_status, rc.requested_at as link_requested_at, rc.approved_at
    into v
    from public.courier_shifts s
    join public.couriers c on c.id = s.courier_id
    join public.profiles p on p.id = c.user_id
    join public.restaurant_couriers rc on rc.id = s.restaurant_courier_id
   where s.id = p_shift_id;
  -- Another store's shift reads exactly like a missing one.
  if not found or not private.is_restaurant_member(v.restaurant_id) then
    raise exception 'RPM_COURIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(sum(e.deliveries), 0), coalesce(sum(e.shift_fee_cents + e.delivery_fees_cents), 0)
    into v_deliveries, v_total
    from private.courier_earnings(v.courier_id, v.restaurant_id, v_today, v_today) e;
  select coalesce(sum(e.deliveries), 0) into v_here
    from private.courier_earnings(v.courier_id, v.restaurant_id, date '2000-01-01', v_today) e;

  return jsonb_build_object(
    'shiftId', v.shift_id,
    'name', v.name,
    'phone', v.phone,
    'photoPath', case when v.photo_url is not null then v.user_id::text || '/avatar.jpg' end,
    'motorcycle', jsonb_build_object('model', v.motorcycle_model, 'plate', v.motorcycle_plate, 'color', v.motorcycle_color),
    'linkStatus', v.link_status,
    'linkedSince', coalesce(v.approved_at, v.link_requested_at),
    'shiftStatus', v.shift_status,
    'requestedAt', v.requested_at,
    'availableSince', v.available_since,
    'locationAt', v.location_updated_at,
    'today', jsonb_build_object('deliveries', v_deliveries, 'totalCents', v_total),
    'deliveriesHere', v_here);
end; $$;

revoke all on function public.set_courier_photo(boolean) from public, anon;
revoke all on function public.get_courier_card(uuid) from public, anon;
grant execute on function public.set_courier_photo(boolean) to authenticated;
grant execute on function public.get_courier_card(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
