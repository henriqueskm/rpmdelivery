-- RPM-ONBOARD-001. Forward-only; hosted application requires separate approval.
begin;

alter table public.restaurant_couriers
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles(id);

create table private.courier_invite_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 11)
);
create table private.courier_invite_redemptions (
  invite_id uuid not null references public.courier_invites(id),
  courier_id uuid not null references public.couriers(id),
  relationship_id uuid not null references public.restaurant_couriers(id),
  created_at timestamptz not null default now(),
  primary key (invite_id,courier_id)
);
alter table private.courier_invite_attempts enable row level security;
alter table private.courier_invite_redemptions enable row level security;
revoke all on private.courier_invite_attempts,private.courier_invite_redemptions
  from public,anon,authenticated;

create function private.require_courier_invite_manager(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'RPM_AUTH_REQUIRED' using errcode='28000'; end if;
  -- Lock authorization until command commits; no client-provided actor.
  perform 1 from public.restaurant_members
    where restaurant_id=p_restaurant_id and user_id=auth.uid() and active
      and role in ('OWNER','MANAGER') for share;
  if not found then raise exception 'RPM_MANAGER_REQUIRED' using errcode='42501'; end if;
end; $$;

create function private.courier_invite_attempt_allowed()
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'RPM_AUTH_REQUIRED' using errcode='28000'; end if;
  insert into private.courier_invite_attempts(user_id,window_started_at,attempts)
    values(auth.uid(),v_now,1)
  on conflict(user_id) do update set
    window_started_at=case when courier_invite_attempts.window_started_at <= v_now-interval '15 minutes'
      then v_now else courier_invite_attempts.window_started_at end,
    attempts=case when courier_invite_attempts.window_started_at <= v_now-interval '15 minutes'
      then 1 else least(courier_invite_attempts.attempts+1,11) end
    returning attempts into n;
  return n<=10;
end; $$;

create function public.create_courier_invite(
  p_restaurant_id uuid,p_hours integer default 72,p_max_uses integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.courier_invites;
begin
  perform private.require_courier_invite_manager(p_restaurant_id);
  if p_hours is null or p_hours not between 1 and 168
    or p_max_uses is null or p_max_uses not between 1 and 100 then
    raise exception 'RPM_INVITE_PARAMETERS' using errcode='22023';
  end if;
  insert into public.courier_invites(restaurant_id,code,expires_at,max_uses,created_by)
    values(p_restaurant_id,encode(extensions.gen_random_bytes(10),'hex'),
      clock_timestamp()+make_interval(hours=>p_hours),p_max_uses,auth.uid()) returning * into v;
  return jsonb_build_object('id',v.id,'code',v.code,'active',v.active,
    'expiresAt',v.expires_at,'maxUses',v.max_uses,'usedCount',v.used_count);
end; $$;

create function public.revoke_courier_invite(p_restaurant_id uuid,p_invite_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_courier_invite_manager(p_restaurant_id);
  update public.courier_invites set active=false
    where id=p_invite_id and restaurant_id=p_restaurant_id;
  if not found then raise exception 'RPM_INVITE_NOT_FOUND' using errcode='P0002'; end if;
end; $$;

create function public.inspect_courier_invite(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.courier_invites; v_code text;
begin
  -- Return failures rather than RAISE: attempts must survive failed guesses.
  if not private.courier_invite_attempt_allowed() then
    return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
  if p_code is null or length(p_code)>80 then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  v_code:=lower(regexp_replace(btrim(coalesce(p_code,'')),'[-[:space:]]','','g'));
  if v_code !~ '^[0-9a-f]{20}$' then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  select * into v from public.courier_invites i where i.code=v_code;
  if not found or not v.active or v.expires_at is null or v.expires_at<=clock_timestamp()
    or v.max_uses is null or v.used_count>=v.max_uses then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  return jsonb_build_object('ok',true,'registered',exists(select 1 from public.couriers where user_id=auth.uid()),'restaurantName',
    (select name from public.restaurants where id=v.restaurant_id));
end; $$;

create function public.request_courier_membership(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.courier_invites; c uuid; link public.restaurant_couriers; v_code text;
begin
  if not private.courier_invite_attempt_allowed() then
    return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
  if p_code is null or length(p_code)>80 then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  v_code:=lower(regexp_replace(btrim(coalesce(p_code,'')),'[-[:space:]]','','g'));
  if v_code !~ '^[0-9a-f]{20}$' then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  select * into v from public.courier_invites i where i.code=v_code for update;
  if not found then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  select id into c from public.couriers where user_id=auth.uid();
  if c is null then return jsonb_build_object('ok',false,'reason','profile_required'); end if;
  -- A completed retry is idempotent even if this invite expired/exhausted/revoked later.
  select rc.* into link from private.courier_invite_redemptions r
    join public.restaurant_couriers rc on rc.id=r.relationship_id
    where r.invite_id=v.id and r.courier_id=c;
  if found then return jsonb_build_object('ok',true,'status',link.status,'id',link.id); end if;
  if not v.active or v.expires_at is null or v.expires_at<=clock_timestamp()
    or v.max_uses is null or v.used_count>=v.max_uses then
    return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  -- Different invites for the same courier/store cannot double-consume either.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c::text||v.restaurant_id::text,0));
  select * into link from public.restaurant_couriers
    where restaurant_id=v.restaurant_id and courier_id=c for update;
  if not found then
    insert into public.restaurant_couriers(restaurant_id,courier_id,status)
      values(v.restaurant_id,c,'PENDING') returning * into link;
    update public.courier_invites set used_count=used_count+1 where id=v.id;
    insert into private.courier_invite_redemptions(invite_id,courier_id,relationship_id)
      values(v.id,c,link.id);
  end if;
  return jsonb_build_object('ok',true,'status',link.status,'id',link.id);
end; $$;

create function public.review_courier_membership(
  p_restaurant_id uuid,p_relationship_id uuid,p_approve boolean)
returns text language plpgsql security definer set search_path='' as $$
declare v public.restaurant_couriers; target public.restaurant_courier_status;
begin
  perform private.require_courier_invite_manager(p_restaurant_id);
  if p_approve is null then raise exception 'RPM_REVIEW_PARAMETERS' using errcode='22023'; end if;
  select * into v from public.restaurant_couriers where id=p_relationship_id
    and restaurant_id=p_restaurant_id for update;
  if not found then raise exception 'RPM_RELATIONSHIP_NOT_FOUND' using errcode='P0002'; end if;
  target:=case when p_approve then 'ACTIVE' else 'REJECTED' end;
  if v.status=target then return target::text; end if;
  if v.status<>'PENDING' then raise exception 'RPM_REVIEW_STALE' using errcode='22023'; end if;
  update public.restaurant_couriers set status=target,
    approved_at=case when p_approve then clock_timestamp() else null end,
    approved_by=case when p_approve then auth.uid() else null end,
    reviewed_at=clock_timestamp(),reviewed_by=auth.uid()
    where id=v.id;
  return target::text;
end; $$;

create function public.complete_courier_registration(
  p_name text,p_phone text,p_model text,p_plate text,p_color text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'RPM_AUTH_REQUIRED' using errcode='28000'; end if;
  select id into c from public.couriers where user_id=auth.uid();
  if c is not null then return c; end if;
  if nullif(btrim(p_name),'') is null or length(p_name)>120
    or nullif(btrim(p_model),'') is null or length(p_model)>80
    or nullif(btrim(p_plate),'') is null or length(p_plate)>20
    or nullif(btrim(p_color),'') is null or length(p_color)>40
    or (nullif(btrim(p_phone),'') is not null and p_phone !~ '^[+]55[1-9][0-9]9[0-9]{8}$') then
    raise exception 'RPM_COURIER_FIELDS' using errcode='22023';
  end if;
  -- Serialize registration per identity and reuse the existing idempotent RPC.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,1));
  select id into c from public.couriers where user_id=auth.uid();
  if c is not null then return c; end if;
  update public.profiles set name=btrim(p_name),phone=nullif(btrim(p_phone),'')
    where id=auth.uid();
  return public.create_courier_profile(p_model,p_plate,p_color);
end; $$;

create function public.list_my_establishments()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'RPM_AUTH_REQUIRED' using errcode='28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'restaurantName',r.name,
    'status',rc.status) order by rc.created_at,rc.id)
    from public.restaurant_couriers rc join public.couriers c on c.id=rc.courier_id
    join public.restaurants r on r.id=rc.restaurant_id where c.user_id=auth.uid()),'[]'::jsonb);
end; $$;

create function public.list_courier_management(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_courier_invite_manager(p_restaurant_id);
  return jsonb_build_object(
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,
      'active',i.active,'expiresAt',i.expires_at,'maxUses',i.max_uses,'usedCount',i.used_count)
      order by i.created_at desc,i.id) from public.courier_invites i where i.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'name',p.name,
      'motorcycleModel',c.motorcycle_model,'motorcyclePlate',c.motorcycle_plate,
      'motorcycleColor',c.motorcycle_color,'requestedAt',rc.requested_at)
      order by rc.requested_at,rc.id) from public.restaurant_couriers rc
      join public.couriers c on c.id=rc.courier_id join public.profiles p on p.id=c.user_id
      where rc.restaurant_id=p_restaurant_id and rc.status='PENDING'),'[]'::jsonb));
end; $$;

revoke all on function private.require_courier_invite_manager(uuid),
  private.courier_invite_attempt_allowed() from public,anon,authenticated;
revoke all on function public.create_courier_invite(uuid,integer,integer),
  public.revoke_courier_invite(uuid,uuid),public.inspect_courier_invite(text),
  public.request_courier_membership(text),public.review_courier_membership(uuid,uuid,boolean),
  public.list_my_establishments(),public.list_courier_management(uuid),
  public.complete_courier_registration(text,text,text,text,text) from public,anon;
grant execute on function public.create_courier_invite(uuid,integer,integer),
  public.revoke_courier_invite(uuid,uuid),public.inspect_courier_invite(text),
  public.request_courier_membership(text),public.review_courier_membership(uuid,uuid,boolean),
  public.list_my_establishments(),public.list_courier_management(uuid),
  public.complete_courier_registration(text,text,text,text,text) to authenticated;

-- No changes to orders, shifts, routes, GPS, existing RLS or direct table writes.
notify pgrst,'reload schema';
commit;
