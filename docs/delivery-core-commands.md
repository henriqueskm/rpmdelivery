# Núcleo operacional — comandos (RPCs)

Objetivo: permitir a **simulação familiar** de ponta a ponta — loja cria pedido, monta rota, motoboy sai, entrega (ou falha), retorna e volta à fila; cliente acompanha pelo link.

Hoje o painel `/preview/operacao` e o app Android usam dados fictícios. Este documento define os comandos reais do banco que vão substituí-los. Toda escrita continua passando somente por RPCs `SECURITY DEFINER`; nenhuma tabela operacional recebe `INSERT/UPDATE/DELETE` direto.

## Princípios

- **Identidade vem do servidor.** O ator é sempre `auth.uid()`. Nenhum `user_id`, `actorId` ou papel é aceito do cliente.
- **Locks na ordem fixa** para evitar deadlock: `courier_shifts` → `routes` → `deliveries`. Toda RPC que muda uma entrega trava a linha da entrega (`FOR UPDATE`).
- **Idempotência.** Comandos que criam algo recebem `p_request_id uuid` gerado pelo app. Repetir o mesmo comando (rede ruim, retry do Android) devolve o mesmo resultado sem duplicar. Isso prepara o modo offline do app do motoboy.
- **Repetir uma transição já aplicada é sucesso** (ex.: aprovar turno já aprovado). Transição conflitante é erro.
- **Erros com código estável** `RPM_*` para o front traduzir em mensagens.
- Prazos usam `timestamptz` e relógio do servidor (`clock_timestamp()`), nunca o relógio do aparelho.

## Fatias

| Fatia | Comandos | Estado |
| --- | --- | --- |
| 1. Pedidos e turnos | `create_order`, `cancel_order`, `request_shift`, `review_shift`, `end_shift` | **esta PR** |
| 2. Montagem de rota | `create_route`, `update_route_composition`, `release_route_pickup`, `revoke_route_pickup`, `cancel_route` | próxima |
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

### Riscos e o que não cobre

- Aplicação no Supabase hospedado exige aprovação separada (`supabase db push` não é executado aqui).
- PGlite roda em conexão única: os testes cobrem regras, papéis e isolamento, não corrida real entre conexões. As corridas relevantes desta fatia são protegidas por índice único (turno aberto, `client_request_id`) e `FOR UPDATE`.
- `orders.status` duplica parte de `deliveries.status`; as RPCs mantêm os dois em sincronia.
