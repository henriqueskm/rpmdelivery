-- Supplement to the existing invitation contract: legacy profiles, own repairs.
insert into auth.users(id,email) select gps_test.id(n),'legacy-'||n||'@fixture.invalid'
  from generate_series(13,18)n;
select set_config('request.jwt.claim.sub',gps_test.id(13)::text,false);set role authenticated;
select public.create_courier_profile(null,null,null);
reset role;
update public.profiles set name=E' \t\n' where id=gps_test.id(13);
select set_config('request.jwt.claim.sub',gps_test.id(13)::text,false);set role authenticated;
select onboard_test.check('legacy row is not complete',
  (public.inspect_courier_invite('aaaaaaaaaaaaaaaa0002')->>'registered')::boolean=false);
select onboard_test.check('direct request cannot bypass mandatory fields',
  public.request_courier_membership('aaaaaaaaaaaaaaaa0002')->>'reason'='profile_required');
do $$begin
  begin perform public.complete_courier_registration('Name',null,null,'ABC1D23','Azul');
    raise exception 'Missing model accepted';exception when invalid_parameter_value then null;end;
  begin update public.couriers set motorcycle_model='Bypass' where user_id=auth.uid();
    raise exception 'Direct vehicle update allowed';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select onboard_test.check('invalid repairs and requests have no partial effects',
  (select motorcycle_model is null from public.couriers where user_id=gps_test.id(13))
  and not exists(select 1 from public.restaurant_couriers rc join public.couriers c on c.id=rc.courier_id
    where c.user_id=gps_test.id(13))
  and (select used_count=1 from public.courier_invites where id=gps_test.id(802)));
select set_config('request.jwt.claim.sub',gps_test.id(13)::text,false);set role authenticated;
select public.complete_courier_registration(E' \tNome reparado\n',null,E' \tMoto nova\n',' abc1d23 ',' Azul ');
select onboard_test.check('repaired registration passes inspection',
  (public.inspect_courier_invite('aaaaaaaaaaaaaaaa0002')->>'registered')::boolean);
select onboard_test.check('repaired registration can request normally',
  public.request_courier_membership('aaaaaaaaaaaaaaaa0002')->>'status'='PENDING');
reset role;
select onboard_test.check('new values normalized with unchanged courier identity',
  (select c.motorcycle_model='Moto nova' and c.motorcycle_plate='ABC1D23'
    and c.motorcycle_color='Azul' and p.name='Nome reparado'
    from public.couriers c join public.profiles p on p.id=c.user_id where c.user_id=gps_test.id(13)));

-- Partial record: valid fields are immutable through this completion command.
select set_config('request.jwt.claim.sub',gps_test.id(14)::text,false);set role authenticated;
select public.create_courier_profile(' Modelo preservado ',null,'Azul');
reset role;
update public.profiles set name='Nome preservado',phone='+5511999999999' where id=gps_test.id(14);
-- Deliberate legacy whitespace stays byte-for-byte when valid after normalization.
update public.couriers set motorcycle_model=' Modelo preservado ' where user_id=gps_test.id(14);
select set_config('request.jwt.claim.sub',gps_test.id(14)::text,false);set role authenticated;
select onboard_test.check('inspection exposes only own valid prefill',
  public.inspect_courier_invite('aaaaaaaaaaaaaaaa0007')->'profile'
    =jsonb_build_object('name','Nome preservado','phone','+5511999999999',
      'model','Modelo preservado','plate',null,'color','Azul'));
select onboard_test.check('one missing plate also blocks the direct membership command',
  public.request_courier_membership('aaaaaaaaaaaaaaaa0007')->>'reason'='profile_required');
select public.complete_courier_registration('Overwrite','+5521988888888','Other model',' xyz1a23 ','Vermelha');
reset role;
select onboard_test.check('valid name, phone, model and color preserved',
  (select p.name='Nome preservado' and p.phone='+5511999999999'
    and c.motorcycle_model=' Modelo preservado ' and c.motorcycle_color='Azul'
    and c.motorcycle_plate='XYZ1A23' from public.profiles p join public.couriers c on c.user_id=p.id
    where p.id=gps_test.id(14)));
create table onboard_test.completed_snapshot as select to_jsonb(c) courier,to_jsonb(p) profile
  from public.couriers c join public.profiles p on p.id=c.user_id where c.user_id=gps_test.id(14);
select set_config('request.jwt.claim.sub',gps_test.id(14)::text,false);set role authenticated;
select public.complete_courier_registration(null,null,null,null,null);
reset role;
select onboard_test.check('completed retry leaves every field and timestamp unchanged',
  (select s.courier=to_jsonb(c) and s.profile=to_jsonb(p) from onboard_test.completed_snapshot s,
    public.couriers c join public.profiles p on p.id=c.user_id where c.user_id=gps_test.id(14)));

-- Oversized and whitespace-only legacy values must also be repaired.
insert into public.couriers(user_id,motorcycle_model,motorcycle_plate,motorcycle_color)
  values(gps_test.id(15),E' \t\n',repeat('X',21),repeat('X',41));
update public.profiles set name=repeat('X',121) where id=gps_test.id(15);
select set_config('request.jwt.claim.sub',gps_test.id(15)::text,false);set role authenticated;
select onboard_test.check('invalid legacy lengths cannot bypass membership gate',
  public.request_courier_membership('aaaaaaaaaaaaaaaa0007')->>'reason'='profile_required');
do $$begin
  begin perform public.complete_courier_registration('Name',null,repeat('X',81),'ABC1D23','Azul');
    raise exception 'Oversized model accepted';exception when invalid_parameter_value then null;end;
  begin perform public.complete_courier_registration('Name',null,'Moto','ABC1D23',E'\t\n');
    raise exception 'Whitespace color accepted';exception when invalid_parameter_value then null;end;
  begin perform public.complete_courier_registration(p_name=>'Name',p_phone=>null,
    p_model=>'Moto',p_plate=>'ABC1D23',p_color=>'Azul',p_user_id=>gps_test.id(14));
    raise exception 'Forged UID parameter accepted';exception when undefined_function then null;end;
end;$$;
select public.complete_courier_registration('Nome válido',null,'Moto','abc1d23','Preta');
select onboard_test.check('own repaired fields are complete',
  (public.inspect_courier_invite('aaaaaaaaaaaaaaaa0007')->>'registered')::boolean);
reset role;
select onboard_test.check('other identity untouched by repair or forged UID',
  (select s.courier=to_jsonb(c) and s.profile=to_jsonb(p) from onboard_test.completed_snapshot s,
    public.couriers c join public.profiles p on p.id=c.user_id where c.user_id=gps_test.id(14)));
select set_config('request.jwt.claim.sub',gps_test.id(16)::text,false);set role authenticated;
select onboard_test.check('inspect never returns another courier profile',
  public.inspect_courier_invite('aaaaaaaaaaaaaaaa0007')->'profile'->>'plate' is null);
do $$begin
  begin perform public.complete_courier_registration('Name',null,null,'ABC1D23','Azul');
    raise exception 'Invalid fresh profile accepted';exception when invalid_parameter_value then null;end;
end;$$;
reset role;
select onboard_test.check('failed fresh registration rolls back courier creation',
  not exists(select 1 from public.couriers where user_id=gps_test.id(16)));
select onboard_test.check('normalized mandatory limits are shared',
  private.courier_registration_complete(repeat('N',120),repeat('M',80),repeat('P',20),repeat('C',40))
  and not private.courier_registration_complete(repeat('N',121),'M','P','C')
  and not private.courier_registration_complete('N',repeat('M',81),'P','C')
  and not private.courier_registration_complete('N','M',repeat('P',21),'C')
  and not private.courier_registration_complete('N','M','P',repeat('C',41))
  and not private.courier_registration_complete('N','M','P',E' \t\n'));
select onboard_test.check('pure registration helpers not callable by common roles',
  not has_function_privilege('authenticated','private.courier_registration_value(text,integer)','EXECUTE')
  and not has_function_privilege('anon','private.courier_registration_complete(text,text,text,text)','EXECUTE'));
set role anon;
do $$begin
  begin perform public.complete_courier_registration('Anon',null,'Moto','ABC1D23','Azul');
    raise exception 'Anon repaired profile';exception when insufficient_privilege then null;end;
end;$$;
reset role;
