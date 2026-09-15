# RpmDelivery — Database Schema

## Objetivo

Este documento define a estrutura inicial do banco de dados do RpmDelivery.

Princípios:

- PostgreSQL / Supabase
- UUID como chave primária
- `created_at` e `updated_at` onde fizer sentido
- isolamento por restaurante
- regras críticas validadas no backend
- RLS em todas as tabelas expostas
- evitar lógica crítica apenas no frontend
- manter o schema preparado para expansão futura

---

# 1. Enums

## restaurant_member_role

- OWNER
- MANAGER
- OPERATOR

## restaurant_courier_status

- PENDING
- ACTIVE
- SUSPENDED
- REJECTED

## courier_shift_status

- PENDING
- AVAILABLE
- ON_ROUTE
- RETURNING
- ENDED
- REJECTED

## order_status

- OPEN
- DELIVERING
- DELIVERED
- CANCELLED

## delivery_status

- WAITING
- ASSIGNED
- ON_ROUTE
- NEXT
- ATTEMPT_FAILED
- RETURN_TO_STORE
- DELIVERED
- CANCELLED

## delivery_issue_reason

- CUSTOMER_NOT_FOUND
- CUSTOMER_NOT_RESPONDING
- ADDRESS_PROBLEM
- OTHER

## route_status

- PREPARING
- ON_ROUTE
- RETURNING
- COMPLETED
- CANCELLED

## notification_channel

- WHATSAPP
- SMS
- PUSH

## notification_type

- TRACKING_LINK
- NEXT_DELIVERY
- DELIVERY_COMPLETED
- DELIVERY_CANCELLED

## notification_status

- PENDING
- SENT
- DELIVERED
- READ
- FAILED

---

# 2. profiles

Perfil base ligado ao Supabase Auth.

Campos:

- id uuid primary key references auth.users(id) on delete cascade
- name text not null
- phone text
- photo_url text
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Regras:

- um profile por auth user
- não armazenar senha
- autenticação continua em auth.users

---

# 3. restaurants

Representa um estabelecimento.

Campos:

- id uuid primary key default gen_random_uuid()
- name text not null
- phone text
- address text not null
- latitude numeric
- longitude numeric
- minimum_delivery_fee numeric(10,2) not null default 0
- price_per_km numeric(10,2) not null default 0
- is_active boolean not null default true
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- delivery_issue_timeout_minutes integer not null default 10

Constraints:

- minimum_delivery_fee >= 0
- price_per_km >= 0
- delivery_issue_timeout_minutes > 0

---

# 4. restaurant_members

Liga usuários administrativos aos restaurantes.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- user_id uuid not null references profiles(id)
- role restaurant_member_role not null
- active boolean not null default true
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Constraints:

- unique(restaurant_id, user_id)

Índices:

- restaurant_id
- user_id
- restaurant_id + active

---

# 5. couriers

Representa o motoboy como identidade própria.

Campos:

- id uuid primary key default gen_random_uuid()
- user_id uuid not null unique references profiles(id)
- motorcycle_model text
- motorcycle_plate text
- motorcycle_color text

- last_latitude numeric
- last_longitude numeric
- location_updated_at timestamptz
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Regras:

- motoboy pode existir sem vínculo ativo com restaurante
- status AVAILABLE exige vínculo ACTIVE para operar naquele restaurante
- status não deve ser alterado livremente pelo frontend

Índices:

- user_id


---

# 6. restaurant_couriers

Relaciona motoboy e restaurante.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- courier_id uuid not null references couriers(id)
- status restaurant_courier_status not null default 'PENDING'
- is_primary boolean not null default false
- external_sharing_enabled boolean not null default false
- requested_at timestamptz not null default now()
- approved_at timestamptz
- approved_by uuid references profiles(id)
- suspended_at timestamptz
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Constraints:

- unique(restaurant_id, courier_id)

Regras:

- só vínculo ACTIVE pode operar para o restaurante
- external_sharing_enabled não significa aceite automático de entrega externa

Índices:

- restaurant_id
- courier_id
- restaurant_id + status
- courier_id + status

---

# courier_shifts

Representa o turno operacional do motoboy em um estabelecimento.

O motoboy pode possuir vínculo ACTIVE com vários restaurantes ao longo do tempo, mas só pode possuir um turno não encerrado por vez.

Campos:

- id uuid primary key default gen_random_uuid()
- courier_id uuid not null references couriers(id)
- restaurant_id uuid not null references restaurants(id)
- restaurant_courier_id uuid not null references restaurant_couriers(id)
- status courier_shift_status not null default 'PENDING'
- requested_at timestamptz not null default now()
- approved_at timestamptz
- approved_by uuid references profiles(id)
- started_at timestamptz
- available_since timestamptz
- ended_at timestamptz
- ended_by uuid references profiles(id)
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Regras:

- o motoboy só pode solicitar turno em restaurante onde possui vínculo ACTIVE
- um motoboy só pode possuir um turno não encerrado por vez
- ao solicitar início do turno, status = PENDING
- a loja deve aprovar o início do turno
- após aprovação, status = AVAILABLE
- approved_at deve ser preenchido na aprovação
- started_at deve ser preenchido quando o turno for aprovado
- available_since deve ser preenchido quando o turno entrar em AVAILABLE
- ao receber uma rota, AVAILABLE → ON_ROUTE
- após concluir a última entrega, ON_ROUTE → RETURNING
- ao retornar ao estabelecimento, RETURNING → AVAILABLE
- ao encerrar o expediente, AVAILABLE → ENDED
- se a loja recusar a solicitação, PENDING → REJECTED
- não é permitido encerrar o turno enquanto houver rota ativa
- não é permitido encerrar o turno em ON_ROUTE
- não é permitido encerrar o turno em RETURNING
- não é permitido iniciar turno em outro restaurante enquanto existir turno não encerrado
- não é permitido trocar o restaurante de um turno já criado
- um turno ENDED ou REJECTED não pode ser reutilizado

Índices:

- courier_id
- restaurant_id
- status
- restaurant_id + status
- courier_id + started_at desc

Constraint crítica:

Deve existir no máximo um turno não encerrado por courier.

Essa regra deverá ser garantida posteriormente por índice parcial ou mecanismo equivalente no PostgreSQL.

# 7. courier_invites

Convites para motoboys se vincularem a um restaurante.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- token uuid not null unique default gen_random_uuid()
- code text not null unique
- active boolean not null default true
- expires_at timestamptz
- max_uses integer
- used_count integer not null default 0
- created_by uuid not null references profiles(id)
- created_at timestamptz not null default now()

Constraints:

- used_count >= 0
- max_uses is null or max_uses > 0

Regras:

- token imprevisível
- código curto apenas para experiência do usuário
- backend valida expiração e limite de usos

Índices:

- restaurant_id
- token
- code
- active

---

# 8. orders

Representa o pedido comercial.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- customer_name text not null
- customer_phone text not null
- delivery_address text not null
- neighborhood text
- reference text
- notes text
- status order_status not null default 'OPEN'
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Índices:

- restaurant_id
- restaurant_id + status
- created_at
- customer_phone

---

# 9 deliveries

Representa a operação logística de um pedido.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- order_id uuid not null unique references orders(id)
- status delivery_status not null default 'WAITING'
- distance_km numeric(8,2)
- delivery_fee numeric(10,2)
- tracking_token uuid not null unique default gen_random_uuid()
- issue_reason delivery_issue_reason
- issue_notes text
- issue_reported_at timestamptz
- issue_decision_deadline timestamptz
- assigned_at timestamptz
- started_at timestamptz
- delivered_at timestamptz
- cancelled_at timestamptz
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Constraints:

- distance_km is null or distance_km >= 0
- delivery_fee is null or delivery_fee >= 0

Regras:

- ATTEMPT_FAILED deve possuir issue_reason
- ao entrar em ATTEMPT_FAILED, issue_reported_at deve ser preenchido
- issue_decision_deadline deve ser calculado com base na configuração do restaurante
- uma entrega ATTEMPT_FAILED não bloqueia o avanço da rota
- a loja pode transformar ATTEMPT_FAILED em nova tentativa
- a loja pode transformar ATTEMPT_FAILED em RETURN_TO_STORE
- após o prazo de decisão, ATTEMPT_FAILED pode ser convertido automaticamente em RETURN_TO_STORE
- ao final das demais entregas da rota, qualquer ATTEMPT_FAILED ainda sem decisão deve ser convertido automaticamente em RETURN_TO_STORE
- CANCELLED e RETURN_TO_STORE não devem voltar automaticamente para NEXT

Índices:

- restaurant_id
- order_id
- status
- tracking_token
- restaurant_id + status
- issue_decision_deadline

---

# 10. routes

Representa uma saída física do motoboy durante um turno.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- courier_id uuid not null references couriers(id)
- courier_shift_id uuid not null references courier_shifts(id)
- status route_status not null default 'PREPARING'
- started_at timestamptz
- completed_at timestamptz
- returning_at timestamptz
- arrived_at timestamptz
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()

Regras:

- courier_shift deve estar ativo
- courier_shift deve pertencer ao mesmo courier
- courier_shift deve pertencer ao mesmo restaurant
- motoboy não pode possuir duas rotas ON_ROUTE simultaneamente
- alterações críticas devem passar por RPC/backend
- uma Route representa uma única saída física do estabelecimento
- um mesmo CourierShift pode possuir várias Routes
- novas entregas só podem ser adicionadas enquanto a Route estiver PREPARING
- após Route = ON_ROUTE, não é permitido adicionar novas entregas
- após Route = ON_ROUTE, a sequência planejada não deve ser reordenada manualmente
- uma entrega ATTEMPT_FAILED pode ser temporariamente pulada sem alterar sua sequence original
- Route entra automaticamente em RETURNING quando todas as entregas estiverem DELIVERED, CANCELLED ou RETURN_TO_STORE

Índices:

- restaurant_id
- courier_id
- courier_shift_id
- status
- restaurant_id + status
- courier_id + status

---

# 11. route_deliveries

Relaciona entregas às rotas.

Campos:

- id uuid primary key default gen_random_uuid()
- route_id uuid not null references routes(id)
- delivery_id uuid not null unique references deliveries(id)
- sequence integer not null
- created_at timestamptz not null default now()

Constraints:

- sequence > 0
- unique(route_id, sequence)

Regras:

- entrega não pode pertencer a duas rotas ativas ao mesmo tempo
- sequência de entregas já concluídas não pode ser alterada

Índices:

- route_id
- delivery_id
- route_id + sequence

---

# 12. courier_locations

Histórico temporário de localização do motoboy.

Campos:

- id bigint generated always as identity primary key
- courier_id uuid not null references couriers(id)
- route_id uuid not null references routes(id)
- latitude numeric not null
- longitude numeric not null
- accuracy numeric
- recorded_at timestamptz not null default now()

Regras:

- somente localização de rota ativa
- motoboy só envia localização própria
- cliente público nunca consulta esta tabela diretamente
- retenção deve ser definida posteriormente

Índices:

- courier_id + recorded_at desc
- route_id + recorded_at desc

---

# 13. delivery_notifications

Registra comunicações relacionadas à entrega.

Campos:

- id uuid primary key default gen_random_uuid()
- restaurant_id uuid not null references restaurants(id)
- delivery_id uuid not null references deliveries(id)
- channel notification_channel not null
- type notification_type not null
- destination text
- provider text
- provider_message_id text
- status notification_status not null default 'PENDING'
- error_message text
- sent_at timestamptz
- delivered_at timestamptz
- read_at timestamptz
- created_at timestamptz not null default now()

Índices:

- delivery_id
- restaurant_id
- status
- provider_message_id

---

# 14. push_subscriptions

Push notification do cliente para uma entrega específica.

Campos:

- id uuid primary key default gen_random_uuid()
- delivery_id uuid not null references deliveries(id)
- endpoint text not null
- p256dh text not null
- auth text not null
- active boolean not null default true
- created_at timestamptz not null default now()
- revoked_at timestamptz

Regras:

- subscription vinculada à entrega
- deve ser desativada/revogada quando necessário
- não expor diretamente para usuários internos sem necessidade

Índices:

- delivery_id
- active

---

# 15. Entidades principais

- profiles
- restaurants
- restaurant_members
- couriers
- restaurant_couriers
- courier_shifts
- courier_invites
- orders
- deliveries
- routes
- route_deliveries
- courier_locations
- delivery_notifications
- push_subscriptions

# 15-1. Relações principais

profiles
→ restaurant_members
→ restaurants

profiles
→ couriers
→ restaurant_couriers
→ restaurants

restaurants
→ courier_invites

restaurants
→ orders
→ deliveries

restaurants
→ routes
→ route_deliveries
→ deliveries

couriers
→ routes

couriers
→ courier_locations

deliveries
→ delivery_notifications

deliveries
→ push_subscriptions

couriers
→ restaurant_couriers
→ restaurants

couriers
→ courier_shifts
→ restaurants

courier_shifts
→ routes

---

# 16. Transições críticas

As seguintes operações não devem ser feitas como updates livres no frontend:

- aprovar motoboy
- suspender motoboy
- iniciar rota
- concluir entrega
- marcar próxima entrega
- iniciar retorno
- confirmar chegada
- cancelar rota
- cancelar entrega
- alterar status operacional do motoboy

Essas operações devem passar por RPCs ou backend seguro.

---

# 17. RPCs / Commands previstos

Ainda não implementar nesta etapa.

Planejados:

- request_restaurant_link
- approve_restaurant_courier
- reject_restaurant_courier
- request_courier_shift
- approve_courier_shift
- reject_courier_shift
- end_courier_shift
- create_route
- assign_delivery_to_route
- start_route
- complete_delivery
- start_return
- confirm_arrival
- cancel_delivery
- cancel_route
- report_delivery_attempt_failure
- retry_delivery
- return_delivery_to_store

Cada comando deve:

- validar usuário
- validar restaurante
- validar estado atual
- usar transação quando necessário
- impedir transições inválidas
- registrar timestamps automaticamente

---

# 18. RLS — princípios

Todas as tabelas operacionais devem usar RLS.

## Restaurante

Usuário pode acessar somente restaurantes onde possui membership ativo.

## Motoboy

Pode acessar apenas:

- seu próprio perfil de courier;
- vínculos próprios;
- rotas atribuídas a ele;
- entregas de suas rotas;
- inserção de sua própria localização.

## Cliente público

Não possui acesso direto às tabelas internas.

Tracking público deve passar por endpoint, função ou visão segura que retorne apenas os dados necessários.

---

# 19. Tracking público

O tracking público deve retornar apenas:

- status da entrega
- quantidade de entregas antes da atual
- status atual da rota
- posição permitida do motoboy
- ETA quando disponível
- nome/foto pública do motoboy se habilitado

Nunca retornar:

- telefone de outros clientes
- endereços de outras entregas
- dados administrativos
- histórico completo de localização
- IDs internos desnecessários

---

# 20. Decisões futuras já previstas

Não implementar agora, mas o schema deve permitir evolução para:

- motoboy vinculado a múltiplas lojas;
- rede compartilhada de motoboys;
- ofertas de entrega externa;
- payout do motoboy;
- comissão da loja de origem;
- taxa da plataforma;
- múltiplos provedores de mensageria;
- otimização de rotas;
- pagamentos;
- geofence automático;
- retenção automática de localizações.

---

# 21. Fora deste documento

Ainda serão definidos separadamente:

- migrations SQL;
- políticas RLS;
- RPCs;
- workers;
- integração WhatsApp;
- integração SMS;
- mapas;
- cálculo de distância;
- push notifications;
- geofence.