-- Route suggestions, phase 3: where each bairro is, learned from the store's own orders.
-- The center of a bairro is the average pin of the store's orders there in the last 180 days
-- (only orders confirmed on the map). "Sugerir rotas" calls two bairros neighbors when their
-- centers are close, instead of judging by the two orders at hand. Members of the store only.
begin;

create function public.get_neighborhood_centers(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'RPM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_restaurant_member(p_restaurant_id) then
    raise exception 'RPM_MEMBER_REQUIRED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('neighborhood', c.neighborhood, 'latitude', c.latitude,
                                        'longitude', c.longitude, 'orders', c.orders) order by c.orders desc, c.neighborhood)
      from (
        select min(btrim(o.neighborhood)) as neighborhood,
               round(avg(o.latitude)::numeric, 6)::double precision as latitude,
               round(avg(o.longitude)::numeric, 6)::double precision as longitude,
               count(*)::int as orders
          from public.orders o
         where o.restaurant_id = p_restaurant_id
           and o.latitude is not null and o.longitude is not null
           and nullif(btrim(o.neighborhood), '') is not null
           and coalesce(o.ordered_at, o.created_at) > now() - interval '180 days'
         group by lower(btrim(o.neighborhood))
         order by count(*) desc
         limit 500
      ) c), '[]'::jsonb);
end; $$;

revoke all on function public.get_neighborhood_centers(uuid) from public, anon;
grant execute on function public.get_neighborhood_centers(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
