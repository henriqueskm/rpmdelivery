# Núcleo operacional — comandos (RPCs)

Objetivo: permitir a **simulação familiar** de ponta a ponta — loja cria pedido, monta rota, motoboy sai, entrega (ou falha), retorna e volta à fila; cliente acompanha pelo link.

Hoje o painel `/preview/operacao` e o app Android usam dados fictícios. Este documento define os comandos reais do banco que vão substituí-los. Toda escrita continua passando somente por RPCs `SECURITY DEFINER`; nenhuma tabela operacional recebe `INSERT/UPDATE/DELETE` direto.

## Princípios

- **Identidade vem do servidor.** O ator é sempre `auth.uid()`. Nenhum `user_id`, `actorId` ou papel é aceito do cliente.
- **Locks na ordem fixa** para evitar deadlock: `courier_shifts` → `routes` → `deliveries`. Toda RPC que muda uma entrega trava a linha da entrega (`FOR UPDATE`).
- **Travar e conferir são comandos separados.** Em READ COMMITTED, uma única expressão (`if trava(...) and exists(...)`) usa o snapshot tirado *antes* de esperar o lock e enxerga o estado antigo. Isso deixou o mesmo pedido entrar em duas rotas no teste de corrida do PostgreSQL 17 (o PGlite, com conexão única, não reproduz). Primeiro trava, depois confere num statement novo, ou lê a linha no próprio `SELECT ... FOR UPDATE`.
- **Idempotência.** Comandos que criam algo recebem `p_request_id uuid` gerado pelo app. Repetir o mesmo comando (rede ruim, retry do Android) devolve o mesmo resultado sem duplicar. Isso prepara o modo offline do app do motoboy.
- **Repetir uma transição já aplicada é sucesso** (ex.: aprovar turno já aprovado). Transição conflitante é erro.
- **Erros com código estável** `RPM_*` para o front traduzir em mensagens.
- Prazos usam `timestamptz` e relógio do servidor (`clock_timestamp()`), nunca o relógio do aparelho.

## Fatias

| Fatia | Comandos | Estado |
| --- | --- | --- |
| 1. Pedidos e turnos | `create_order`, `cancel_order`, `request_shift`, `review_shift`, `end_shift` | PR #24 |
| 2. Montagem de rota | `create_route`, `update_route_composition`, `release_route_pickup`, `revoke_route_pickup`, `cancel_route` | **em revisão** |
| 3. Execução da rota | `start_route`, `complete_delivery`, `report_delivery_failure`, `decide_delivery_failure`, `cancel_delivery_on_route`, `arrive_at_store`, `record_courier_location` | depois |
| 4. Rastreamento público | `get_tracking(token)` (anon, dados mínimos) + link WhatsApp `wa.me` | depois |

Fora do caminho até a simulação: otimização/planejamento automático, push, WhatsApp/SMS por API, taxa por km, ofertas externas.

## Fatia 1 — Pedidos e turnos

### Mudanças de schema

`restaurants.default_delivery_promise_minutes` (1–240, padrão 60).

`orders` ganha: `complement`, `latitude`/`longitude` (opcionais, em par), `address_provider`/`address_provider_id` (mesma regra de `restaurants`), `ordered_at`, `promised_minutes` (1–240), `created_by`, `client_request_id` (único por restaurante).

Coordenadas são **opcionais**: em cidade pequena a geocodificação pode falhar e a loja não pode ficar travada. Sem coordenada, a entrega funciona, mas sem mapa/ETA para aquele cliente.

### Comandos

| RPC | Quem | Regra |
| --- | --- | --- |
| `create_order(...)` | membro ativo (inclui OPERATOR) | Cria `orders` (OPEN) + `deliveries` (WAITING) na mesma transação. Idempotente por `p_request_id`. Telefone `+55` + DDD + 8/9 dígitos. `ordered_at` entre 24 h atrás e agora; padrão = agora. Promessa padrão = do restaurante. |
| `cancel_order(restaurant, order)` | membro ativo | Só enquanto a entrega está WAITING (fora de rota). Cancelamento em rota é da fatia 3. Repetir é sucesso. |
| `request_shift(restaurant)` | motoboy | Exige cadastro completo e vínculo ACTIVE. Cria turno PENDING. Já existe turno aberto na mesma loja → devolve o existente; em outra loja → `RPM_SHIFT_OPEN_ELSEWHERE`. |
| `review_shift(restaurant, shift, approve)` | membro ativo (inclui OPERATOR) | PENDING → AVAILABLE (`started_at = available_since = agora`) ou REJECTED. Revalida vínculo ACTIVE na aprovação. |
| `end_shift(shift)` | o próprio motoboy ou membro ativo da loja | PENDING ou AVAILABLE → ENDED, sem rota ativa no turno. ON_ROUTE/RETURNING → `RPM_SHIFT_BUSY`. |

**Decisão:** OPERATOR pode aprovar turno. Quem está no balcão é quem vê o motoboy chegar; exigir gerente travaria a operação. Convites e vínculo continuam restritos a OWNER/MANAGER.

### Leituras

Continuam pelas tabelas com RLS existente (pedidos, entregas, turnos e rotas do próprio restaurante; motoboy vê só os próprios turnos). Uma RPC agregada de leitura para o painel fica para quando o painel for ligado aos dados reais.

## Fatia 2 — Montagem de rota

Segue o contrato já registrado em `docs/delivery-deadlines-pickup.md`: a rota nasce PREPARING com um motoboy reservado; a loja ajusta a composição, libera a retirada, e só então (fatia 3) o motoboy pode iniciar.

### Mudanças de schema

`routes` ganha: `composition_version` (começa em 1), `pickup_released_at`/`pickup_released_by`, `cancelled_at`/`cancelled_by`, `created_by` e `client_request_id` (único por restaurante).

### Exclusividade da entrega

Uma entrega só entra numa rota se estiver **WAITING**, verificado com a linha travada (`FOR UPDATE`). Ao entrar vira ASSIGNED; ao sair (remoção ou cancelamento da rota) volta para WAITING. Assim a mesma entrega nunca fica em duas rotas ativas, mesmo com dois operadores clicando ao mesmo tempo. As entregas são travadas em ordem de `id` para evitar deadlock entre comandos concorrentes.

### Comandos (todos: membro ativo da loja, inclusive OPERATOR)

| RPC | Regra |
| --- | --- |
| `create_route(restaurant, request_id, shift, delivery_ids[])` | Turno da loja em AVAILABLE, vínculo ACTIVE, sem outra rota ativa do motoboy. 1–30 entregas, sem repetição, todas WAITING. A ordem do array é a sequência. Idempotente por `request_id`. |
| `update_route_composition(restaurant, route, expected_version, delivery_ids[])` | Só PREPARING. `expected_version` diferente da atual → `RPM_ROUTE_STALE` (a tela recarrega). Mudar o **conjunto** limpa a liberação; só reordenar mantém. Toda mudança incrementa a versão. Lista idêntica é no-op. |
| `release_route_pickup(restaurant, route, expected_version)` | Só PREPARING e na versão atual. Repetir mantém o horário original. |
| `revoke_route_pickup(restaurant, route)` | Só PREPARING. Repetir é sucesso. Depois de ON_ROUTE é recusado. |
| `cancel_route(restaurant, route)` | Só PREPARING. Entregas voltam para WAITING; o motoboy volta a ficar livre. Repetir é sucesso. |

Atribuir e liberar **não** disparam tracking nem notificação ao cliente; isso só acontece no início da rota (fatia 3).

### Riscos e o que não cobre

- Aplicação no Supabase hospedado exige aprovação separada (`supabase db push` não é executado aqui).
- PGlite roda em conexão única: os testes cobrem regras, papéis e isolamento, não corrida real entre conexões. As corridas relevantes desta fatia são protegidas por índice único (turno aberto, `client_request_id`) e `FOR UPDATE`.
- `orders.status` duplica parte de `deliveries.status`; as RPCs mantêm os dois em sincronia.
