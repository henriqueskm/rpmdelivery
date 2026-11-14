# Núcleo operacional — comandos (RPCs)

Objetivo: permitir a **simulação familiar** de ponta a ponta — loja cria pedido, monta rota, motoboy sai, entrega (ou falha), retorna e volta à fila; cliente acompanha pelo link.

O painel da loja (`/dashboard`) usa dados reais desde a fatia 5; o `/preview/operacao` e o app Android ainda usam dados fictícios. Este documento define os comandos reais do banco que vão substituí-los. Toda escrita continua passando somente por RPCs `SECURITY DEFINER`; nenhuma tabela operacional recebe `INSERT/UPDATE/DELETE` direto.

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
| 1. Pedidos e turnos | `create_order`, `cancel_order`, `request_shift`, `review_shift`, `end_shift` | no `main` (PR #24) |
| 2. Montagem de rota | `create_route`, `update_route_composition`, `release_route_pickup`, `revoke_route_pickup`, `cancel_route` | no `main` (PR #25) |
| 3. Execução da rota | `start_route`, `complete_delivery`, `report_delivery_failure`, `decide_delivery_failure`, `cancel_delivery_on_route`, `requeue_delivery`, `arrive_at_store`, `record_courier_locations` | no `main` (PR #26) |
| 4. Rastreamento público | `get_tracking(token)` (anon, dados mínimos) + link WhatsApp `wa.me` (`lib/tracking/links.ts`) | no `main` (PR #27) |
| 5. Painel da loja | `get_operations_board(restaurant)` (leitura agregada) e o `/dashboard` ligado aos comandos das fatias 1–3 | **em revisão** |

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
- PGlite roda em conexão única: os testes cobrem regras, papéis e isolamento. As corridas reais entre conexões rodam no PostgreSQL 17 (`tests/sql/run-delivery-core.sh`, também no CI).
- `orders.status` duplica parte de `deliveries.status`; as RPCs mantêm os dois em sincronia.

## Fatia 3 — Execução da rota

Segue as regras do protótipo de ocorrências (`docs/delivery-occurrences-prototype.md`), agora no banco. O motoboy executa uma parada por vez; a loja decide as falhas; ninguém fica preso esperando.

### Mudanças de schema

- Prazo da loja para decidir uma falha: `restaurants.delivery_issue_timeout_minutes` (já existia no schema inicial, padrão 10). A fatia 3 tinha criado por engano uma coluna duplicada, `issue_decision_minutes`, removida pela migration `20261112230000_issue_decision_original_column.sql`.
- `route_deliveries.retry_queued_at`: fila de nova tentativa, separada da sequência planejada (que nunca muda depois do início).
- Tabela nova `delivery_attempts` (somente leitura pela API, RLS: membros da loja e o motoboy dono da rota). Cada tentativa registra resultado (DELIVERED/FAILED), motivo, relato, ator, horário, prazo de decisão e como a ocorrência foi fechada (RETRY, RETURN, CANCEL, TIMEOUT, OTHERS_FINISHED). Uma ocorrência aberta por entrega, no máximo. O `client_request_id` dela é a idempotência dos comandos do motoboy.
- Índice único `courier_locations (route_id, recorded_at)`: reenviar o mesmo lote de GPS não duplica pontos.

### Comandos do motoboy (só o motoboy dono da rota; outra rota → `RPM_ROUTE_NOT_FOUND`)

| RPC | Regra |
| --- | --- |
| `start_route(route, expected_version)` | PREPARING, liberação vigente (`RPM_PICKUP_NOT_RELEASED`), versão que o motoboy viu (`RPM_ROUTE_STALE`), turno AVAILABLE e vínculo ACTIVE. Rota e turno viram ON_ROUTE, entregas ON_ROUTE, pedidos DELIVERING; a primeira parada vira NEXT. Repetir devolve o estado. |
| `complete_delivery(request_id, route, delivery)` | Só a parada NEXT (senão `RPM_DELIVERY_STATE` com o status atual no `detail`, ex.: CANCELLED pela loja). Entrega e pedido DELIVERED; a próxima parada vira NEXT. |
| `report_delivery_failure(request_id, route, delivery, reason, notes)` | Só a NEXT. Motivos: CUSTOMER_NOT_FOUND, CUSTOMER_NOT_RESPONDING, ADDRESS_PROBLEM, OTHER (relato de 3–500 caracteres). Abre ocorrência com prazo e a rota segue. |
| `arrive_at_store(route)` | RETURNING → COMPLETED. O turno volta a AVAILABLE com `available_since = agora` (fim da fila). Repetir é sucesso. |
| `record_courier_locations(route, points)` | Lote de 1–100 pontos `{latitude, longitude, accuracy?, recordedAt}` em rota ON_ROUTE/RETURNING/COMPLETED. Pontos fora da janela da rota (relógio do aparelho, sincronização atrasada) são descartados; repetidos, ignorados. A posição ao vivo só avança e só com a rota ativa. |

### Comandos da loja (membro ativo, inclusive OPERATOR)

| RPC | Regra |
| --- | --- |
| `decide_delivery_failure(restaurant, delivery, decision)` | RETRY (volta para a fila de nova tentativa, depois das primeiras tentativas restantes), RETURN ou CANCEL. Repetir a mesma decisão é sucesso; ocorrência já fechada por outra decisão, pelo prazo ou pelo fim da rota → `RPM_ISSUE_CLOSED` (motivo no `detail`). |
| `cancel_delivery_on_route(restaurant, delivery)` | Entrega ON_ROUTE, NEXT ou ATTEMPT_FAILED de rota em andamento. Fecha a ocorrência aberta com CANCEL. Repetir é sucesso. |
| `requeue_delivery(restaurant, delivery)` | RETURN_TO_STORE → WAITING (pedido volta a OPEN) só depois que o motoboy chegou (`RPM_DELIVERY_IN_TRANSIT` antes). Nunca é automático: a loja decide se despacha de novo ou cancela com `cancel_order`. |

### Progressão automática

- Sempre existe exatamente uma NEXT enquanto há algo a tentar: primeiras tentativas na ordem planejada, depois novas tentativas na ordem em que a loja decidiu.
- Quando nada resta, falhas sem decisão voltam para a loja (OTHERS_FINISHED) e rota e turno viram RETURNING. Vale também para falha na única ou última parada: o motoboy nunca fica esperando.
- **Prazo sem worker.** Não há agendador: todo comando que mexe na rota fecha antes as ocorrências vencidas (TIMEOUT). O prazo vence na fronteira exata, mesmo contra uma decisão que chega no mesmo instante. Como a rota só fica ON_ROUTE enquanto o motoboy ainda tem paradas, o próximo comando dele sempre resolve o vencido. Até lá, a tela da loja deve tratar ATTEMPT_FAILED com prazo passado como "voltando para a loja".
- Suspender o vínculo durante a rota não trava as entregas em andamento; o vínculo é exigido no início.

### Concorrência

Todo comando de execução trava `courier_shifts` → `routes` → entregas da rota (ordem de `id`), cada trava num statement próprio, e só depois confere o estado. Corridas cobertas no PostgreSQL 17: início × revogação da liberação, "Entregue" repetido ao mesmo tempo, conclusão × cancelamento pela loja, decisão da loja × fim da rota.

### Fora desta fatia

Disparo de link/notificação ao cliente no início (fatia 4 e depois), configuração do prazo pela tela, auditoria de eventos além de `delivery_attempts`, retenção do GPS e leitura agregada para o painel.

## Fatia 4 — Rastreamento público

O cliente abre `/acompanhar/<tracking_token>` sem login. O token (UUID aleatório, já existente em `deliveries`) é a única credencial, então a resposta só traz o necessário para aquela entrega.

### `get_tracking(token)` (anon e authenticated)

| Campo | Conteúdo |
| --- | --- |
| `status` | PREPARING (WAITING/ASSIGNED), ON_ROUTE, NEXT, ATTEMPT_FAILED, RETURNING_TO_STORE, DELIVERED ou CANCELLED |
| `restaurantName` | Nome da loja |
| `stopsBefore` | Paradas antes desta, na mesma ordem de execução da rota (primeiras tentativas, depois novas tentativas). Só com a entrega em rota |
| `courier` | Último ponto de GPS dos últimos 10 minutos, **só quando a entrega é NEXT** |
| `destination` | Coordenadas do próprio pedido, só quando NEXT e se houver geocodificação |
| `issueReason` | Motivo da falha (sem o relato do motoboy), só em ATTEMPT_FAILED |
| `startedAt`, `deliveredAt` | Saída para entrega e conclusão |

**Nunca aparece:** nome, telefone, endereço ou observações de qualquer cliente; identidade, moto ou telefone do motoboy; outras paradas.

**Desvio consciente da arquitetura (seção 14):** a posição do motoboy não aparece enquanto ele faz outra entrega. Parado na porta de outro cliente, a posição revelaria aquele endereço. Até lá, a página mostra só "N entregas antes da sua".

**Validade:** entregue ou cancelada, o link responde por 24 h; em qualquer outro estado, por 7 dias desde o cadastro. Token vencido e token inexistente dão o mesmo `RPM_TRACKING_NOT_FOUND`, sem enumeração.

### A página `/acompanhar/<token>`

- **Arquivos:**
  - rota: `app/acompanhar/[token]/page.tsx`;
  - tela: `features/tracking/`;
  - textos e regras: `lib/tracking/view.ts`, com testes em `tests/unit/tracking-view.test.ts`.
- **Leitura:** chama `get_tracking` no navegador, com a chave pública. Um token com formato inválido nem chega a consultar o banco.
- **Atualização automática:**
  - a cada 15 s em rota, quando o cliente é o próximo e quando a entrega falhou;
  - a cada 30 s em preparo e quando o pedido voltou para a loja;
  - para quando a entrega termina, entregue ou cancelada.
  - Com a aba escondida, a página não consulta; volta a consultar quando a aba aparece de novo.
- **Sem conexão:** se a primeira leitura falhar, a página mostra "Tentar novamente". Depois de carregada, uma queda mantém o último status com o aviso "Sem conexão" e continua tentando a cada 15 s.
- **Mapa:** só quando o cliente é o próximo. É um mapa interativo do Mapbox GL (`mapbox-gl`, versão fixa) com o entregador e o endereço do próprio cliente, feito com o token público `NEXT_PUBLIC_MAPBOX_MAP_TOKEN`. Sem posição recente, a página mostra "Aguardando a posição do entregador".
  - **Movimento:** a cada leitura nova, o entregador desliza da posição anterior até a nova durante os 15 s até a próxima leitura, e parece andar sem parar. Leituras a mais de 2 km uma da outra (lacuna de GPS) e o modo "reduzir movimento" do aparelho saltam direto. Regras em `lib/tracking/motion.ts`.
  - **Custo:** o Mapbox cobra por mapa aberto, não por movimento. A página cria um único mapa por visita e só move os marcadores; a biblioteca só é baixada quando o cliente vira o próximo.
  - **Gestos:** com um dedo a página rola normalmente; mover o mapa pede dois dedos (ou Ctrl + rolagem no computador). Enquanto o cliente mexe no mapa, a página não reenquadra; 6 s depois que ele para, o mapa volta sozinho para o entregador e o endereço.
  - **Falhas:** sem WebGL ou com o token recusado, aparece "Mapa indisponível no momento." e o resto do acompanhamento continua.
  - As métricas de desempenho do Mapbox ficam desligadas; o evento de abertura do mapa, que o Mapbox usa para cobrança, continua.
- **Privacidade:** `referrer: no-referrer`, para o token não ir a outros sites, inclusive o Mapbox. Por isso o token público do mapa não pode ter restrição por URL (ela depende do referrer). `noindex`, para não aparecer em buscadores.
- **Fora desta versão:**
  - "Ativar notificações" (push), congelado até a simulação;
  - previsão de chegada.
- **Visual:** não existe frame aprovado no Figma para esta tela. Segue o design system e o raio atuais.

### Avisar o cliente — em aberto

Como o cliente fica sabendo que o pedido saiu e que ele é o próximo **ainda não está decidido**. Restrições já fixadas:

- O motoboy nunca recebe o telefone do cliente (um `wa.me` no celular dele exporia o número e o deixaria no WhatsApp pessoal).
- Web push não alcança iPhone sem instalar a página na tela de início, então não pode ser o único canal.
- Mandar cada aviso à mão pelo WhatsApp da loja dá trabalho demais para o balcão; não é o plano.

`lib/tracking/links.ts` (link público e mensagem `wa.me`) fica disponível, mas nenhuma tela depende dele. A decisão sai antes de ligar o painel e o app aos dados reais.

**Atualização:** o "saiu para entrega" passa a ser automático pela WhatsApp Cloud API (número de teste da Meta na simulação). Ver `docs/customer-notifications.md`. "Você é o próximo" continua em aberto.

## Leitura do motoboy sem o telefone do cliente

Antes, o motoboy com rota ativa lia a linha inteira de `orders` pela RLS, telefone incluído. Loja e motoboy usam o mesmo papel `authenticated`, então um grant por coluna não separa os dois. Agora:

- A policy `orders_select_allowed` admite só membros da loja.
- O app do motoboy lê a rota por `get_courier_route()`: rota ativa (PREPARING, ON_ROUTE ou RETURNING) ou `null`, com `routeId`, `status`, `version`, `nextDeliveryId`, `pickupReleasedAt`, `startedAt`, a loja (nome, telefone, endereço e coordenadas) e as paradas na ordem planejada (nome do cliente, endereço, complemento, bairro, referência, observações, coordenadas, prazo, status, tentativas e fila de nova tentativa). **Nenhum telefone de cliente.**
- `deliveries`, `routes` e `route_deliveries` continuam legíveis pelo motoboy dono da rota; nenhuma tem telefone.

Problema na porta passa pela loja: o motoboy registra a falha e a loja liga para o cliente.

## Fatia 5 — Painel da loja com dados reais

O `/dashboard` deixa de usar dados fictícios. O `/preview/operacao` continua com os cenários de demonstração.

### `get_operations_board(restaurant)` (membros da loja, inclusive OPERATOR)

Uma leitura só, num retrato consistente, a cada 5 s com a aba visível e logo depois de cada comando. É `stable`, não trava nada e não muda nada. Fora da loja, inativo, motoboy ou `anon`: `RPM_MEMBER_REQUIRED` (42501).

| Campo | Conteúdo |
| --- | --- |
| `restaurant` | Prazo padrão e tempo de resposta das ocorrências |
| `couriers` | Turnos abertos (PENDING, AVAILABLE, ON_ROUTE, RETURNING), na ordem da fila (`available_since`), com nome e se o vínculo está ativo |
| `routes` | Rotas ativas e as concluídas nas últimas 12 h enquanto o turno do motoboy segue aberto. Referência `R-n` pela ordem na loja, versão da composição, liberação, paradas na ordem planejada e fila de nova tentativa |
| `orders` | Entregas em aberto, as encerradas nas últimas 12 h e todas as das rotas mostradas. Referência da loja ou, sem ela, o número do pedido na loja. Inclui o telefone (a loja já o lê pela policy de `orders`) |
| `issues` | Falhas das rotas mostradas, abertas e decididas, com relato, prazo e quem decidiu |
| `serverNow` | Relógio do servidor, para a tela calcular prazos sem depender do relógio do computador |

Rotas canceladas não aparecem; as entregas delas voltam a aguardar.

### O que a tela faz

- **Comandos:** cadastrar pedido (`create_order`), aprovar ou recusar turno (`review_shift`), montar e editar rota (`create_route`, `update_route_composition` com a versão vista), liberar e cancelar a liberação, decidir ocorrência e cancelar entrega em rota. Cada comando recarrega o painel em seguida.
- **Idempotência:** se a rede cair no meio do cadastro de um pedido ou da criação de uma rota, repetir a mesma ação reaproveita o `request_id` e o banco devolve o que já criou, sem duplicar.
- **Conflitos:** erros `RPM_*` viram frases para o balcão (ex.: "A rota mudou em outro aparelho") e o painel recarrega.
- **Prazo das ocorrências:** sem agendador, uma ocorrência vencida continua aberta no banco até o próximo comando da rota. A tela já a mostra encerrada por prazo, com o pedido voltando para a loja, e não deixa mais decidir.
- **Sem conexão:** se a primeira leitura falhar, a tela oferece "Tentar novamente". Depois disso, uma queda mantém o último painel com o aviso "Sem conexão" e o painel tenta de novo sozinho.
- **Avisos vistos/fechados** ficam neste aparelho (`localStorage`), como o som.

### Fora desta fatia (escondido no painel real)

Montagem automática e sugestão de sequência (otimização congelada até a simulação), edição de prazo do pedido e do prazo padrão, tempo de resposta das ocorrências pela tela, visão simulada do motoboy, cancelar rota em preparação, cancelar pedido e devolver à fila um pedido que voltou. O endereço do pedido ainda é texto livre, sem geocodificação; sem coordenadas, o mapa do cliente mostra só o entregador.
