-- Disposable identities: actual actor identity always comes from auth.uid().
select set_config('request.jwt.claim.sub',gps_test.id(1)::text,false);
set role authenticated;
do $$declare v jsonb;begin
 v:=public.create_courier_invite(gps_test.id(101),72,2);
 perform onboard_test.check('generated 80-bit code; no token exposed',v->>'code' ~ '^[0-9a-f]{20}$' and not(v?'token'));
 perform onboard_test.check('owner lists own store',jsonb_array_length(public.list_courier_management(gps_test.id(101))->'invites')>=2);
 begin perform public.create_courier_invite(gps_test.id(102),72,1);raise exception 'Cross-store allowed';exception when insufficient_privilege then null;end;
 begin perform public.revoke_courier_invite(gps_test.id(101),gps_test.id(802));raise exception 'Wrong invite accepted';exception when no_data_found then null;end;
end;$$;
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(5)::text,false);set role authenticated;
select onboard_test.check('MANAGER can generate',public.create_courier_invite(gps_test.id(102),1,1)->>'code' ~ '^[0-9a-f]{20}$');
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(4)::text,false);set role authenticated;
do $$begin
 begin perform public.create_courier_invite(gps_test.id(102),1,1);raise exception 'Operator create';exception when insufficient_privilege then null;end;
 begin perform public.list_courier_management(gps_test.id(102));raise exception 'Operator list';exception when insufficient_privilege then null;end;
 begin perform public.revoke_courier_invite(gps_test.id(102),gps_test.id(802));raise exception 'Operator revoke';exception when insufficient_privilege then null;end;
 begin perform public.review_courier_membership(gps_test.id(102),gps_test.id(302),true);raise exception 'Operator review';exception when insufficient_privilege then null;end;
 perform onboard_test.check('OPERATOR cannot read invite secrets',(select count(*) from public.courier_invites)=0);
end;$$;
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(8)::text,false);set role authenticated;
select onboard_test.check('profile required before request',public.request_courier_membership('aaaaaaaaaaaaaaaa0002')->>'reason'='profile_required');
select onboard_test.check('registration reuses existing RPC',public.complete_courier_registration('Fixture Courier','+5511999999999','Moto','ABC1D23','Azul')=public.create_courier_profile(null,null,null));
select onboard_test.check('valid invite preview minimal',public.inspect_courier_invite('AAAA-AAAA-AAAA-AAAA-0002')->>'restaurantName'='Synthetic B');
select onboard_test.check('request is PENDING',public.request_courier_membership('aaaaaaaaaaaaaaaa0002')->>'status'='PENDING');
select onboard_test.check('duplicate request stays PENDING',public.request_courier_membership('aaaaaaaaaaaaaaaa0002')->>'status'='PENDING');
select onboard_test.check('pending grants no customer/order/route access',(select count(*) from public.orders)=0 and (select count(*) from public.routes)=0 and (select count(*) from public.courier_locations)=0);
select onboard_test.check('own status visible',public.list_my_establishments()->0->>'status'='PENDING');
do $$begin
 begin insert into public.restaurant_couriers(restaurant_id,courier_id) values(gps_test.id(101),private.current_courier_id());raise exception 'Direct relationship write';exception when insufficient_privilege then null;end;
 begin insert into public.courier_invites(restaurant_id,code,created_by) values(gps_test.id(101),'client',auth.uid());raise exception 'Direct invite write';exception when insufficient_privilege then null;end;
 begin perform * from private.courier_invite_attempts;raise exception 'Rate table exposed';exception when insufficient_privilege then null;end;
 begin perform last_latitude from public.couriers;raise exception 'GPS exposed';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select onboard_test.check('single usage after retries',(select used_count=1 from public.courier_invites where id=gps_test.id(802)));
select set_config('request.jwt.claim.sub',gps_test.id(1)::text,false);set role authenticated;
do $$declare relationship uuid;begin
 -- ID supplied by client cannot authorize cross-store decisions.
 select (public.list_my_establishments()->0->>'id')::uuid into relationship;
 begin perform public.review_courier_membership(gps_test.id(102),gps_test.id(302),true);raise exception 'Cross-store review';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(5)::text,false);set role authenticated;
do $$declare rid uuid;begin
 rid:=(public.list_courier_management(gps_test.id(102))->'requests'->0->>'id')::uuid;
 perform onboard_test.check('manager approval',public.review_courier_membership(gps_test.id(102),rid,true)='ACTIVE');
 perform onboard_test.check('approval retry idempotent',public.review_courier_membership(gps_test.id(102),rid,true)='ACTIVE');
 begin perform public.review_courier_membership(gps_test.id(102),rid,false);raise exception 'Active rejected by stale request';exception when invalid_parameter_value then null;end;
end;$$;
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(8)::text,false);set role authenticated;
select onboard_test.check('approval persists in My establishments',public.list_my_establishments()->0->>'status'='ACTIVE');
select onboard_test.check('ACTIVE relationship alone grants no order/route/GPS access',
 (select count(*) from public.orders)=0 and (select count(*) from public.routes)=0 and (select count(*) from public.courier_locations)=0);
reset role;
-- Expired/revoked/exhausted/unknown all share one non-enumerating outcome.
update private.courier_invite_attempts set window_started_at=clock_timestamp()-interval '16 minutes';
select set_config('request.jwt.claim.sub',gps_test.id(9)::text,false);set role authenticated;
select public.complete_courier_registration('Fixture Other',null,'Moto','XYZ1A23','Preta') is not null;
do $$declare code text;begin
 foreach code in array array['aaaaaaaaaaaaaaaa0003','aaaaaaaaaaaaaaaa0004','aaaaaaaaaaaaaaaa0005','ffffffffffffffffffff','bad'] loop
  perform onboard_test.check('unavailable preview',public.inspect_courier_invite(code)->>'reason'='unavailable');
 end loop;
 perform onboard_test.check('expired request denied',public.request_courier_membership('aaaaaaaaaaaaaaaa0003')->>'reason'='unavailable');
 perform onboard_test.check('revoked request denied',public.request_courier_membership('aaaaaaaaaaaaaaaa0004')->>'reason'='unavailable');
 perform onboard_test.check('exhausted request denied',public.request_courier_membership('aaaaaaaaaaaaaaaa0005')->>'reason'='unavailable');
end;$$;
reset role;
update private.courier_invite_attempts set window_started_at=clock_timestamp()-interval '16 minutes';
select set_config('request.jwt.claim.sub',gps_test.id(8)::text,false);set role authenticated;
select onboard_test.check('multiple stores supported',public.request_courier_membership('aaaaaaaaaaaaaaaa0006')->>'status'='PENDING');
select onboard_test.check('two establishments',jsonb_array_length(public.list_my_establishments())=2);
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(1)::text,false);set role authenticated;
do $$declare rid uuid;begin
 rid:=(public.list_courier_management(gps_test.id(101))->'requests'->0->>'id')::uuid;
 perform onboard_test.check('rejection',public.review_courier_membership(gps_test.id(101),rid,false)='REJECTED');
end;$$;
select public.revoke_courier_invite(gps_test.id(101),gps_test.id(806));
reset role;
select set_config('request.jwt.claim.sub',gps_test.id(8)::text,false);set role authenticated;
select onboard_test.check('completed receipt retries after revocation without reopening rejection',public.request_courier_membership('aaaaaaaaaaaaaaaa0006')->>'status'='REJECTED');
reset role;
update private.courier_invite_attempts set window_started_at=clock_timestamp()-interval '16 minutes';
select set_config('request.jwt.claim.sub',gps_test.id(12)::text,false);set role authenticated;
do $$declare n integer;begin
 for n in 1..10 loop perform public.inspect_courier_invite('not-a-code');end loop;
 perform onboard_test.check('invalid attempts persist and rate-limit',public.inspect_courier_invite('aaaaaaaaaaaaaaaa0002')->>'reason'='rate_limited');
end;$$;
reset role;
select onboard_test.check('rate cap persisted',(select attempts=11 from private.courier_invite_attempts where user_id=gps_test.id(12)));
set role anon;
do $$begin
 begin perform public.inspect_courier_invite('aaaaaaaaaaaaaaaa0002');raise exception 'Anon lookup';exception when insufficient_privilege then null;end;
 begin perform public.list_my_establishments();raise exception 'Anon membership';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select onboard_test.check('policies unchanged',(select policies from onboard_test.snapshot)=(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p));
select onboard_test.check('default ACL unchanged',(select defaults from onboard_test.snapshot)=(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d));
select onboard_test.check('GPS sequence hardening preserved',(select sequence_acl from onboard_test.snapshot)=(select relacl::text from pg_class where oid='public.courier_locations_id_seq'::regclass));
select onboard_test.check('new public RPCs have minimal EXECUTE and safe search_path',not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_courier_invite','revoke_courier_invite',
 'inspect_courier_invite','request_courier_membership','review_courier_membership',
 'list_my_establishments','list_courier_management','complete_courier_registration')
 and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE')
   or not has_function_privilege('authenticated',p.oid,'EXECUTE'))));
