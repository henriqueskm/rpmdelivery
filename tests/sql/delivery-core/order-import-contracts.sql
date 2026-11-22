-- Contracts for order source and import_order (migration 20261130120000). Store A (101): owner 1, operator 2.
-- Owner B (4), outsider (8). core_test.try_as comes from courier-card-contracts.sql, as_actor from earnings.

select core_test.check('orders typed in the panel come from PANEL and carry no external code',
 not exists (select 1 from public.orders where source <> 'PANEL' or external_id is not null or source_app is not null));

-- Each import goes in its own statement: a write is only visible to the next statement.
select set_config('core.import1', core_test.as_actor(2, format(
  'select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L, p_neighborhood => %L)',
  core_test.id(101), 'PRINTER', ' 5127 ', 'Joana Importada', '(11) 95555-4433', 'Rua Impressa, 9', 'Balcão', 'Centro'))::text, false);
select core_test.check('the operator imports a printed order: created, with origin, app and code',
 (current_setting('core.import1')::jsonb->>'created')::boolean
 and exists (select 1 from public.orders o
   where o.id = (current_setting('core.import1')::jsonb->>'orderId')::uuid
     and o.source = 'PRINTER' and o.source_app = 'Balcão' and o.external_id = '5127'
     and o.customer_phone = '+5511955554433' and o.neighborhood = 'Centro' and o.created_by = core_test.id(2)));

select set_config('core.import2', core_test.as_actor(1, format(
  'select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L)',
  core_test.id(101), 'PRINTER', '5127', 'Outro Nome', '11955554499', 'Outra Rua, 1', 'Balcão'))::text, false);
select core_test.check('the same code again answers the order already created and changes nothing',
 current_setting('core.import2')::jsonb = jsonb_set(current_setting('core.import1')::jsonb, '{created}', 'false')
 and (select count(*) from public.orders where external_id = '5127') = 1
 and (select customer_name from public.orders where external_id = '5127') = 'Joana Importada');

select set_config('core.import3', core_test.as_actor(1, format(
  'select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L)',
  core_test.id(101), 'OPEN_DELIVERY', '5127', 'Davi App', '11955554455', 'Rua do App, 3', '99Food'))::text, false);
select set_config('core.import4', core_test.as_actor(1, format(
  'select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L)',
  core_test.id(101), 'OPEN_DELIVERY', '5127', 'Lia App', '11955554466', 'Rua do App, 4', 'Keeta'))::text, false);
select set_config('core.import5', core_test.as_actor(4, format(
  'select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L)',
  core_test.id(102), 'PRINTER', '5127', 'Joana em B', '11955554433', 'Rua de B, 2', 'Balcão'))::text, false);
select core_test.check('the same code from another system, another app or another store is another order',
 (current_setting('core.import3')::jsonb->>'created')::boolean
 and (current_setting('core.import4')::jsonb->>'created')::boolean
 and (current_setting('core.import5')::jsonb->>'created')::boolean
 and (select count(distinct id) from public.orders where external_id = '5127') = 4);

select core_test.check('only PRINTER and OPEN_DELIVERY are imported, always with a code',
 core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PANEL', 'x1', 'Ana', '11955554477', 'Rua A, 1')) = '22023'
 and core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', '  ', 'Ana', '11955554477', 'Rua A, 1')) = '22023'
 and core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', repeat('9', 81), 'Ana', '11955554477', 'Rua A, 1')) = '22023'
 and core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', E'a\nb', 'Ana', '11955554477', 'Rua A, 1')) = '22023'
 and core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L, p_source_app => %L)',
   core_test.id(101), 'PRINTER', 'x2', 'Ana', '11955554477', 'Rua A, 1', repeat('a', 41))) = '22023');
select core_test.check('the order checks of create_order still apply (no phone, no order)',
 core_test.try_as(1, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', 'x3', 'Ana', '123', 'Rua A, 1')) = '22023'
 and not exists (select 1 from public.orders where external_id in ('x1', 'x2', 'x3')));
select core_test.check('another store and outsiders are refused',
 core_test.try_as(4, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', 'y1', 'Ana', '11955554477', 'Rua A, 1')) = '42501'
 and core_test.try_as(8, format('select public.import_order(%L, %L, %L, %L, %L, %L)',
   core_test.id(101), 'PRINTER', 'y1', 'Ana', '11955554477', 'Rua A, 1')) = '42501');
select core_test.check('signed-in users only',
 not has_function_privilege('anon', 'public.import_order(uuid, text, text, text, text, text, text, text, text, text, text, double precision, double precision, text, text, timestamptz, integer)', 'EXECUTE')
 and has_function_privilege('authenticated', 'public.import_order(uuid, text, text, text, text, text, text, text, text, text, text, double precision, double precision, text, text, timestamptz, integer)', 'EXECUTE'));

do $$ begin
  begin
    update public.orders set external_id = 'z' where source = 'PANEL';
    raise exception 'CORE CHECK FAILED: a panel order took an external code';
  exception when check_violation then null;
  end;
  begin
    update public.orders set external_id = null where external_id = '5127';
    raise exception 'CORE CHECK FAILED: an imported order lost its code';
  exception when check_violation then null;
  end;
  begin
    insert into public.orders(restaurant_id, customer_name, customer_phone, delivery_address, source, source_app, external_id)
      values (core_test.id(101), 'Dup', '+5511955554433', 'Rua', 'PRINTER', 'Balcão', '5127');
    raise exception 'CORE CHECK FAILED: a second order with the same code was stored';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: panel orders take no code, imported ones keep theirs, one order per code';
end $$;

select set_config('core.ib', core_test.as_actor(1, format('select public.get_operations_board(%L)', core_test.id(101)))::text, false);
select core_test.check('the board says where each imported order came from, and lists no panel order',
 current_setting('core.ib')::jsonb->'orderSources' @> jsonb_build_array(
   jsonb_build_object('deliveryId', current_setting('core.import1')::jsonb->>'deliveryId',
     'source', 'PRINTER', 'app', 'Balcão', 'externalId', '5127'),
   jsonb_build_object('deliveryId', current_setting('core.import3')::jsonb->>'deliveryId',
     'source', 'OPEN_DELIVERY', 'app', '99Food', 'externalId', '5127'))
 and jsonb_array_length(current_setting('core.ib')::jsonb->'orderSources') = 3
 and not (current_setting('core.ib')::jsonb->'orderSources' @> jsonb_build_array(jsonb_build_object(
   'deliveryId', current_setting('core.import5')::jsonb->>'deliveryId'))));

-- Leave the orders as they were for anything after this file.
delete from public.deliveries where order_id in (select id from public.orders where external_id is not null);
delete from public.orders where external_id is not null;
