-- Contracts for the courier card in the store panel and the courier photo (migration 20261126120000).
-- Runs after account-deletion-contracts.sql. Uses whichever open shift store A (101) has; its courier
-- has an ACTIVE link there. Owner B (4) and the outsider (8) are not members of A.

-- Runs a statement as an actor under the authenticated role: 'ok' or the SQLSTATE it raised.
create function core_test.try_as(actor integer, statement text) returns text language plpgsql as $$
begin
 perform core_test.act(actor);
 begin
  set local role authenticated;
  execute statement;
  reset role;
  return 'ok';
 exception when others then
  return sqlstate;
 end;
end; $$;

select set_config('core.card_shift',(select s.id::text from public.courier_shifts s
 join public.restaurant_couriers rc on rc.id=s.restaurant_courier_id
 where s.restaurant_id=core_test.id(101) and s.status not in ('ENDED','REJECTED') and rc.status='ACTIVE'
 order by s.requested_at, s.id limit 1),false);
select set_config('core.card_user',(select c.user_id::text from public.courier_shifts s
 join public.couriers c on c.id=s.courier_id where s.id=current_setting('core.card_shift')::uuid),false);
-- The actor number of that courier, for core_test.act (ids are core_test.id(n)).
select set_config('core.card_actor',(select n::text from generate_series(1,40) n
 where core_test.id(n)=current_setting('core.card_user')::uuid),false);
update public.profiles set photo_url=null where id=current_setting('core.card_user')::uuid;

select core_test.check('store A has an open shift to read', current_setting('core.card_shift') <> ''
 and current_setting('core.card_actor') <> '');

select set_config('core.card',core_test.as_actor(1,format('select public.get_courier_card(%L)',
 current_setting('core.card_shift')))::text,false);
select core_test.check('the owner reads the card: name, motorcycle, link and today',
 (select current_setting('core.card')::jsonb->>'name' = p.name
     and current_setting('core.card')::jsonb->'motorcycle'->>'plate' = c.motorcycle_plate
     and current_setting('core.card')::jsonb->>'linkStatus' = 'ACTIVE'
     and current_setting('core.card')::jsonb->>'linkedSince' is not null
     and current_setting('core.card')::jsonb->>'shiftId' = current_setting('core.card_shift')
     and (current_setting('core.card')::jsonb->'today'->>'deliveries')::int >= 0
     and (current_setting('core.card')::jsonb->>'deliveriesHere')::int
         >= (current_setting('core.card')::jsonb->'today'->>'deliveries')::int
   from public.couriers c join public.profiles p on p.id=c.user_id
  where c.user_id=current_setting('core.card_user')::uuid));
select core_test.check('without a photo there is no path',
 current_setting('core.card')::jsonb->'photoPath'='null'::jsonb);
select core_test.check('the operator of the same store reads it too',
 core_test.as_actor(2,format('select public.get_courier_card(%L)',current_setting('core.card_shift')))->>'name'
  = current_setting('core.card')::jsonb->>'name');
select core_test.check('another store reads it as missing',
 core_test.try_as(4,format('select public.get_courier_card(%L)',current_setting('core.card_shift')))='P0002');
select core_test.check('an outsider reads it as missing',
 core_test.try_as(8,format('select public.get_courier_card(%L)',current_setting('core.card_shift')))='P0002');
select core_test.check('an unknown shift reads as missing',
 core_test.try_as(1,format('select public.get_courier_card(%L)',core_test.id(999)))='P0002');

-- ---------------------------------------------------------
-- The photo
-- ---------------------------------------------------------
select core_test.check('the courier uploads the photo to their own path',
 core_test.try_as(current_setting('core.card_actor')::int,format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)','courier-photos',current_setting('core.card_user')||'/avatar.jpg'))='ok');
select core_test.check('and can replace it',
 core_test.try_as(current_setting('core.card_actor')::int,format(
  'update storage.objects set owner=null where bucket_id=%L and name=%L','courier-photos',current_setting('core.card_user')||'/avatar.jpg'))='ok');
select core_test.check('never to another courier''s path',
 core_test.try_as(current_setting('core.card_actor')::int,format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)','courier-photos',core_test.id(5)||'/avatar.jpg'))='42501');
select core_test.check('nor to another file name',
 core_test.try_as(current_setting('core.card_actor')::int,format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)','courier-photos',current_setting('core.card_user')||'/other.jpg'))='42501');
select core_test.check('a store owner cannot write a courier photo',
 core_test.try_as(1,format('insert into storage.objects(bucket_id,name) values (%L,%L)','courier-photos',core_test.id(1)||'/avatar.jpg'))='42501');

select core_test.check('the courier marks the photo',
 core_test.as_actor(current_setting('core.card_actor')::int,'select public.set_courier_photo(true)')->>'hasPhoto'='true');
-- A new statement: the one above cannot see its own function's update.
select core_test.check('the mark is the path derived from the user id',
 (select photo_url from public.profiles where id=current_setting('core.card_user')::uuid)
   = current_setting('core.card_user')||'/avatar.jpg');
select core_test.check('the card now carries the path derived from the user id',
 core_test.as_actor(1,format('select public.get_courier_card(%L)',current_setting('core.card_shift')))->>'photoPath'
  = current_setting('core.card_user')||'/avatar.jpg');
select core_test.check('a store member cannot mark a photo: only couriers have one',
 core_test.try_as(1,'select public.set_courier_photo(true)')='42501');

create function core_test.photo_rows(actor integer) returns integer language plpgsql as $$
declare v integer;
begin
 perform core_test.act(actor);
 set local role authenticated;
 select count(*) into v from storage.objects
  where bucket_id='courier-photos' and name=current_setting('core.card_user')||'/avatar.jpg';
 reset role;
 return v;
end; $$;
select core_test.check('the courier sees the photo', core_test.photo_rows(current_setting('core.card_actor')::int)=1);
select core_test.check('the owner and the operator of a store linked to the courier see it',
 core_test.photo_rows(1)=1 and core_test.photo_rows(2)=1);
select core_test.check('the outsider never sees it', core_test.photo_rows(8)=0);
select core_test.check('another store sees it only if that courier is linked to it',
 core_test.photo_rows(4) = (select count(*)::int from public.restaurant_couriers rc join public.couriers c on c.id=rc.courier_id
  where rc.restaurant_id=core_test.id(102) and c.user_id=current_setting('core.card_user')::uuid and rc.status='ACTIVE'));

select core_test.check('the courier removes the photo',
 core_test.try_as(current_setting('core.card_actor')::int,format(
  'delete from storage.objects where bucket_id=%L and name=%L','courier-photos',current_setting('core.card_user')||'/avatar.jpg'))='ok'
 and core_test.as_actor(current_setting('core.card_actor')::int,'select public.set_courier_photo(false)')->>'hasPhoto'='false');
select core_test.check('and the mark is gone',
 (select photo_url from public.profiles where id=current_setting('core.card_user')::uuid) is null);
select core_test.check('and the card shows no photo again',
 core_test.as_actor(1,format('select public.get_courier_card(%L)',current_setting('core.card_shift')))->'photoPath'='null'::jsonb);

select core_test.check('the photo bucket is private, JPEG only, up to 1 MB',
 exists (select 1 from storage.buckets where id='courier-photos' and public=false
  and file_size_limit=1048576 and allowed_mime_types=array['image/jpeg']));
select core_test.check('the card and the photo mark are for signed-in users only',
 has_function_privilege('authenticated','public.get_courier_card(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.get_courier_card(uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.set_courier_photo(boolean)','EXECUTE')
 and not has_function_privilege('anon','public.set_courier_photo(boolean)','EXECUTE'));
