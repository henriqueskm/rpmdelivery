# RpmDelivery — Arquitetura Inicial

## 1. Visão do Produto

O RpmDelivery é um sistema de gerenciamento de entregas para restaurantes, lanchonetes, pizzarias e operações similares que trabalham com motoboys próprios.

A primeira versão do produto deve controlar:

* pedidos;
* motoboys;
* fila de disponibilidade;
* rotas;
* múltiplas entregas por rota;
* retorno do motoboy ao estabelecimento;
* localização do motoboy em tempo real;
* acompanhamento da entrega pelo cliente;
* notificações;
* envio automático do link de rastreamento por WhatsApp e/ou SMS;
* histórico operacional.

O sistema deve ser mobile-first e simples de operar durante períodos de alto movimento.

---

# 2. Interfaces Principais

O sistema terá três experiências principais.

## Restaurante

Responsável por:

* cadastrar pedidos;
* visualizar motoboys;
* visualizar disponibilidade;
* atribuir entregas;
* montar rotas;
* acompanhar motoboys em rota;
* acompanhar motoboys retornando;
* visualizar pedidos aguardando;
* acompanhar entregas concluídas;
* consultar histórico.

## Motoboy

Responsável por:

* informar disponibilidade;
* receber rota;
* visualizar entregas da rota;
* iniciar rota;
* visualizar próxima parada;
* marcar entrega como concluída;
* compartilhar localização enquanto estiver em rota ou retornando;
* finalizar retorno ao estabelecimento quando necessário.

## Cliente

Não precisa criar conta.

Recebe um link seguro de acompanhamento da entrega.

Nesse link poderá:

* acompanhar o status;
* visualizar um mini mapa;
* acompanhar a posição do motoboy;
* saber quantas entregas existem antes da sua;
* saber quando o motoboy está realizando outra entrega;
* receber aviso quando sua entrega for a próxima;
* visualizar previsão aproximada de chegada;
* ativar notificações da entrega.

---

# 3. Entidades Principais

## Restaurant

Representa o estabelecimento.

Campos iniciais:

* id
* name
* phone
* address
* latitude
* longitude
* minimum_delivery_fee
* price_per_km
* created_at
* updated_at

---

## User

Representa a identidade autenticada do usuário.

Os dados básicos do usuário ficam em Profile.

A relação com estabelecimentos é feita por restaurant_members.

Papéis administrativos do restaurante:

- OWNER
- MANAGER
- OPERATOR

---

## Courier

Representa o motoboy como uma identidade própria dentro do RpmDelivery.

O motoboy pode possuir conta mesmo sem estar vinculado a nenhum estabelecimento.

Campos iniciais:

- id
- user_id
- name
- phone
- photo_url
- motorcycle_model
- motorcycle_plate
- motorcycle_color
- last_latitude
- last_longitude
- location_updated_at
- created_at
- updated_at

O Courier representa a identidade do motoboy.

O estado operacional não pertence ao Courier.

Disponibilidade, rota e retorno pertencem ao CourierShift atual.

O motoboy não pertence diretamente a um único restaurante.

O vínculo entre motoboy e estabelecimento é representado por `restaurant_couriers`.

## RestaurantCourier

Representa o vínculo entre um motoboy e um estabelecimento.

Isso permite que o motoboy tenha uma identidade própria no RpmDelivery e, futuramente, possa trabalhar com mais de um estabelecimento.

Campos iniciais:

* id
* restaurant_id
* courier_id
* status
* is_primary
* external_sharing_enabled
* requested_at
* approved_at
* approved_by
* suspended_at
* created_at
* updated_at

Status:

* PENDING
* ACTIVE
* SUSPENDED
* REJECTED

## CourierInvite

Permite que um estabelecimento convide motoboys para sua operação.

Campos iniciais:

* id
* restaurant_id
* token
* code
* active
* expires_at
* max_uses
* used_count
* created_by
* created_at

O token deve ser imprevisível.

O mesmo convite pode gerar:

* link;
* QR Code;
* código digitável.

---

# Visão Futura — Shared Courier Network

Futuramente, estabelecimentos poderão disponibilizar motoboys ociosos para realizar entregas de outros estabelecimentos participantes do RpmDelivery.

Essa funcionalidade não faz parte do MVP inicial, mas a arquitetura deve permitir sua implementação futura.

## Princípios

Um motoboy só poderá receber uma entrega externa quando:

* possuir vínculo ACTIVE com sua loja principal;
* a loja de origem permitir compartilhamento;
* o próprio motoboy tiver optado por participar;
* estiver AVAILABLE;
* não existir restrição operacional da loja de origem.

A loja não poderá obrigar o motoboy a aceitar uma entrega externa.

Cada entrega externa deverá ser apresentada como uma oferta.

O motoboy poderá:

* aceitar;
* recusar;
* deixar a oferta expirar.

## Oferta de entrega externa

Entidade futura:

`external_delivery_offers`

Campos conceituais:

* id
* requesting_restaurant_id
* source_restaurant_id
* courier_id
* delivery_id
* offered_fee
* courier_payout
* source_restaurant_payout
* platform_fee
* status
* offered_at
* accepted_at
* rejected_at
* expires_at

Status:

* PENDING
* ACCEPTED
* REJECTED
* EXPIRED
* CANCELLED

## Prioridade

Pedidos do próprio estabelecimento poderão ter prioridade sobre ofertas externas ainda não aceitas.

Depois que o motoboy aceitar uma entrega externa, essa entrega deve ser respeitada como compromisso ativo.

## Benefício financeiro

A arquitetura deve permitir separar futuramente:

* valor pago pelo cliente;
* valor recebido pelo motoboy;
* valor recebido pela loja que disponibilizou o motoboy;
* taxa da plataforma RpmDelivery.

As regras financeiras serão definidas posteriormente.


### Fluxo de vínculo

O restaurante gera um convite.

O convite pode ser apresentado como:

* link;
* QR Code;
* código curto.

Exemplo:

`RPM-7K29`

O motoboy:

1. cria sua conta;
2. completa seu perfil;
3. adiciona foto;
4. informa dados da moto;
5. utiliza o convite;
6. solicita vínculo com a loja.

O vínculo começa como:

`PENDING`

O restaurante precisa aprovar.

Após aprovação:

`PENDING → ACTIVE`

Somente motoboys com vínculo ACTIVE podem ficar disponíveis para aquele restaurante e receber suas rotas.

O motoboy pode ter conta no RpmDelivery sem vínculo ativo com nenhuma loja.



# 4. Fila de Motoboys

O restaurante trabalha com uma fila de disponibilidade.

Cada motoboy disponível possui:

`available_since`

Exemplo:

João — disponível desde 19:10
Carlos — disponível desde 19:17
Pedro — disponível desde 19:22

O próximo sugerido pelo sistema é João.

Quando João recebe uma rota:

A rota fica em PREPARING. João fica reservado e sai da fila de sugestões,
mesmo que o turno permaneça AVAILABLE. "Reservado" é um estado visual derivado
da rota ativa, não um novo valor do enum de turno.

Somente quando João toca em "Iniciar rota" no aplicativo do motoboy, com
validação no backend: PREPARING → ON_ROUTE e AVAILABLE → ON_ROUTE.
A atribuição pela loja não inicia tracking, notificações ou entregas.
A composição e a sequência podem mudar em PREPARING e ficam bloqueadas em ON_ROUTE.

A evolução demonstrativa exige liberação de retirada pela loja, única para todos os pedidos da rota, antes do início pelo próprio motoboy. Essa liberação mantém PREPARING; mudar o conjunto de pedidos a invalida, apenas reordenar não. Prazos prometidos partem do horário original do pedido e não representam ETA. Consulte [campos e contrato futuro](delivery-deadlines-pickup.md); nenhuma transição operacional real foi integrada nesta etapa.

Quando conclui a última entrega:

ON_ROUTE → RETURNING

Quando chega ao estabelecimento:

Após confirmação manual do retorno pelo motoboy: RETURNING → AVAILABLE.

Nesse momento:

`available_since = horário atual`

O motoboy entra no final da fila.

A sugestão automática não deve impedir que o restaurante escolha outro motoboy manualmente.

---

# 5. Order

Representa o pedido comercial.

Campos iniciais:

* id
* restaurant_id
* customer_name
* customer_phone
* delivery_address
* neighborhood
* reference
* notes
* status
* created_at
* updated_at

Status:

* OPEN
* DELIVERING
* DELIVERED
* CANCELLED

O pedido não deve concentrar toda a lógica logística.

A logística pertence principalmente a Delivery e Route.

---

# 6. Delivery

Representa a operação logística associada ao pedido.

Campos iniciais:

* id
* restaurant_id
* order_id
* status
* distance_km
* delivery_fee
* tracking_token
* assigned_at
* started_at
* delivered_at
* cancelled_at
* created_at
* updated_at

Status:

- WAITING
- ASSIGNED
- ON_ROUTE
- NEXT
- ATTEMPT_FAILED
- RETURN_TO_STORE
- DELIVERED
- CANCELLED

### Significado de NEXT

NEXT significa que aquela entrega será a próxima parada do motoboy.

Quando uma entrega muda para NEXT:

* a tela pública do cliente deve atualizar;
* deve ser criada uma notificação;
* push notification deve ser disparada se autorizada;
* opcionalmente WhatsApp ou SMS podem ser enviados de acordo com a configuração do restaurante.

---

# 7. Route

Representa uma saída física do motoboy do estabelecimento.

Uma rota pode conter uma ou várias entregas.

Campos iniciais:

- id
- restaurant_id
- courier_id
- courier_shift_id
- status
- started_at
- completed_at
- returning_at
- arrived_at
- created_at

Status:

* PREPARING
* ON_ROUTE
* RETURNING
* COMPLETED
* CANCELLED

Fluxo:

PREPARING
→ ON_ROUTE
→ RETURNING
→ COMPLETED

---

# 8. RouteDelivery

Relaciona uma entrega com uma rota.

Campos:

* id
* route_id
* delivery_id
* sequence
* created_at

O campo `sequence` define a ordem planejada das entregas.

Exemplo:

Rota #42

1. Pedido 101
2. Pedido 103
3. Pedido 107
4. Pedido 109

A ordem pode ser ajustada pelo restaurante somente enquanto a Route estiver PREPARING.

Após Route = ON_ROUTE:

- não é permitido adicionar novas entregas;
- não é permitido reordenar manualmente as entregas;
- uma entrega com falha pode ser pulada temporariamente sem alterar sua sequence original.

---

# 9. Fluxo da Rota

Exemplo:

Pedido 101
Pedido 103
Pedido 107

Todos atribuídos ao mesmo motoboy.

Fluxo:

Motoboy inicia rota

→ CourierShift = ON_ROUTE
→ Route = ON_ROUTE
→ entregas = ON_ROUTE

Pedido 101 é a próxima parada:

→ Delivery 101 = NEXT

Quando Pedido 101 é concluído:

→ Delivery 101 = DELIVERED
→ Delivery 103 = NEXT

Quando Pedido 103 é concluído:

→ Delivery 103 = DELIVERED
→ Delivery 107 = NEXT

Quando Pedido 107 é concluído:

→ Delivery 107 = DELIVERED

Não existem mais entregas pendentes.

Então:

→ Route = RETURNING
→ CourierShift = RETURNING

Quando o motoboy chega ao estabelecimento:

→ Route = COMPLETED
→ CourierShift = AVAILABLE
→ CourierShift.available_since = horário atual

---

# Regras de rota e falha de entrega

Uma Route representa uma saída física do motoboy do estabelecimento.

O mesmo CourierShift pode possuir várias Routes ao longo do turno.

Exemplo:

CourierShift do João

- Route 1
- Route 2
- Route 3

Cada nova saída do estabelecimento cria uma nova Route.

## Criação da rota

A rota é criada enquanto o motoboy ainda está no estabelecimento.

Estado inicial:

PREPARING

Enquanto estiver PREPARING:

- a loja pode adicionar entregas;
- a loja pode remover entregas;
- a loja pode alterar a ordem das entregas.

Quando o motoboy inicia a saída:

Route = ON_ROUTE

A partir desse momento:

- não é permitido adicionar novas entregas à rota;
- não é permitido reordenar manualmente a rota;
- as entregas existentes permanecem associadas àquela rota.

## Ordem das entregas

Cada entrega possui uma posição na rota por meio de:

route_deliveries.sequence

A ordem planejada não deve ser alterada depois que a rota estiver ON_ROUTE.

Entretanto, uma entrega com problema pode ser temporariamente pulada sem alterar a sequência original.

## Falha de tentativa de entrega

Além da ação:

"Entregue"

o motoboy deve possuir a opção:

"Não consegui entregar"

Ao selecionar essa opção:

- a entrega passa para ATTEMPT_FAILED;
- o motivo da falha deve ser informado;
- a loja é notificada imediatamente;
- a entrega deixa de bloquear a próxima parada;
- o motoboy segue automaticamente para a próxima entrega da rota.

Motivos iniciais:

- CUSTOMER_NOT_FOUND
- CUSTOMER_NOT_RESPONDING
- ADDRESS_PROBLEM
- OTHER

## Decisão da loja

Quando uma entrega entra em ATTEMPT_FAILED, a loja pode decidir:

- tentar novamente;
- retornar o pedido ao estabelecimento.

Se escolher "Tentar novamente":

- a entrega volta para ON_ROUTE;
- poderá se tornar NEXT novamente depois das demais entregas.

Se escolher "Retornar ao estabelecimento":

- a entrega passa para RETURN_TO_STORE.

## Tempo de resposta da loja

Uma falha de entrega nunca deve deixar o motoboy parado esperando a decisão da loja.

O restaurante poderá configurar um tempo máximo de resposta para falhas de entrega.

Exemplo:

delivery_issue_timeout_minutes = 10

Se a loja não responder dentro desse período:

ATTEMPT_FAILED → RETURN_TO_STORE

Além disso, independentemente do timeout, quando o motoboy concluir todas as demais entregas da rota e não houver resposta da loja, qualquer ATTEMPT_FAILED restante deve ser automaticamente convertido em:

RETURN_TO_STORE

Assim, o motoboy nunca fica bloqueado no final da rota aguardando uma decisão.

## Retorno automático

A rota deve entrar automaticamente em RETURNING quando não existir nenhuma entrega que ainda precise ser realizada.

São considerados estados finalizados para a rota:

- DELIVERED
- CANCELLED
- RETURN_TO_STORE

Quando todas as entregas estiverem em um desses estados:

Route = RETURNING

CourierShift = RETURNING

O motoboy então retorna ao estabelecimento.

## Cancelamento durante a rota

A loja pode cancelar uma entrega enquanto a Route estiver ON_ROUTE.

Nesse caso:

Delivery = CANCELLED

O aplicativo do motoboy deve ser atualizado imediatamente.

A entrega cancelada deve continuar visível na lista, porém com apresentação semelhante a:

~~Pedido 123~~

Pedido cancelado

A rota deve pular essa entrega automaticamente.

Se a entrega cancelada era NEXT, a próxima entrega válida da rota deve assumir NEXT.

# Fluxo de Turno do Motoboy

O motoboy pode possuir vínculo ACTIVE com mais de um estabelecimento, mas só pode trabalhar em um estabelecimento por vez.

## Início do turno

Fluxo:

Motoboy chega ao estabelecimento

→ seleciona o estabelecimento

→ toca em "Iniciar turno"

→ CourierShift = PENDING

→ restaurante recebe solicitação

→ restaurante aprova

→ CourierShift = AVAILABLE

→ started_at = horário atual

→ available_since = horário atual

→ motoboy entra na fila de disponíveis daquele estabelecimento

Se a loja recusar:

→ CourierShift = REJECTED

O motoboy não entra na operação.

## Durante o turno

Estados:

AVAILABLE

→ ON_ROUTE

→ RETURNING

→ AVAILABLE

O motoboy só pode receber rotas do estabelecimento associado ao turno atual.

## Encerramento do turno

O motoboy pode solicitar encerramento do turno quando estiver AVAILABLE.

Antes de encerrar, o sistema deve verificar:

- não existe rota ativa
- o motoboy não está ON_ROUTE
- o motoboy não está RETURNING

Se todas as condições forem satisfeitas:

→ CourierShift = ENDED

→ ended_at = horário atual

O restaurante também pode encerrar administrativamente um turno sem rota ativa.

## Troca de estabelecimento

Não é permitido trocar de estabelecimento com turno ativo.

Não é permitido iniciar turno em outro estabelecimento enquanto existir CourierShift não encerrado.

Para trabalhar em outro estabelecimento:

1. concluir todas as entregas;
2. retornar ao estabelecimento atual;
3. ficar AVAILABLE;
4. encerrar o turno atual;
5. solicitar um novo turno no outro estabelecimento;
6. aguardar aprovação da nova loja.

Nunca permitir:

ON_ROUTE → troca de loja

RETURNING → troca de loja

PENDING em duas lojas simultaneamente

# 10. Localização do Motoboy

A localização é enviada enquanto o motoboy estiver:

* ON_ROUTE
* RETURNING

Não é necessário rastreamento contínuo enquanto estiver:

* AVAILABLE
* OFFLINE

O telefone do motoboy enviará:

* latitude
* longitude
* accuracy
* recorded_at

O sistema deve evitar atualizações excessivas.

A frequência inicial pode ficar aproximadamente entre 10 e 15 segundos enquanto houver movimento.

Essa configuração poderá ser otimizada posteriormente.

---

# 11. CourierLocation

Histórico temporário de localização.

Campos:

* id
* courier_id
* route_id
* latitude
* longitude
* accuracy
* recorded_at

Além disso, Courier poderá manter:

* last_latitude
* last_longitude
* location_updated_at

para consultas rápidas.

O histórico completo não deve ser armazenado indefinidamente.

Deve existir posteriormente uma política de retenção.

---

# 12. Retorno ao Estabelecimento

Depois da última entrega, o motoboy não fica disponível imediatamente.

Fluxo:

última entrega concluída
→ Courier = RETURNING
→ Route = RETURNING

A localização continua sendo transmitida.

Quando o motoboy chega ao estabelecimento:

→ Courier = AVAILABLE
→ Route = COMPLETED

## Geofence

O sistema poderá detectar automaticamente a chegada usando um raio em torno do estabelecimento.

Exemplo inicial:

50 a 100 metros

Se o motoboy entrar nesse raio:

RETURNING → AVAILABLE

Deve existir também um botão manual de fallback:

"Já cheguei ao estabelecimento"

para casos de falha de GPS.

---

# 13. Rastreamento Público do Cliente

Cada Delivery deve possuir um token público seguro.

Exemplo:

`/acompanhar/<tracking_token>`

Esse token não deve ser previsível.

O cliente não precisa de login.

A página deve mostrar somente informações daquela entrega.

---

# 14. Privacidade do Rastreamento

O cliente pode visualizar:

* posição do motoboy;
* status da própria entrega;
* quantidade de entregas anteriores;
* previsão aproximada;
* indicação de que o motoboy está realizando outra entrega.

O cliente NÃO pode visualizar:

* nome de outros clientes;
* telefone de outros clientes;
* endereço de outros clientes;
* destino exato das outras paradas;
* conteúdo de outros pedidos.

Exemplo permitido:

"O entregador está realizando outra entrega."

"2 entregas antes da sua."

Exemplo proibido:

"Entregando para Maria na Rua X, número 123."

---

# 15. Tela Pública do Cliente

Estado inicial da rota:

RpmDelivery

Seu pedido está a caminho.

[ MINI MAPA ]

O entregador está realizando outra entrega.

2 entregas antes da sua.

Status:

* Saiu do estabelecimento
* Em rota
* Você é o próximo
* Entregue

Botão:

"Ativar notificações"

---

# 16. Cliente Como Próxima Entrega

Quando a entrega passa para NEXT:

A interface deve mudar imediatamente.

Exemplo:

"Você é o próximo!"

"O entregador está indo agora para o seu endereço."

O mapa poderá destacar:

motoboy → cliente

Também poderá ser exibida previsão aproximada de chegada.

Nesse momento deve ser criado o evento:

NEXT_DELIVERY_CHANGED

---

# 17. Notificações Push

Ao abrir o link de rastreamento, o cliente poderá tocar:

"Ativar notificações"

Somente depois dessa interação deverá ser solicitada autorização do navegador.

Se autorizado, uma push subscription será associada à entrega.

Possíveis notificações:

* pedido saiu para entrega;
* você é o próximo;
* entregador está próximo;
* entrega concluída.

A primeira versão pode começar apenas com:

* NEXT_DELIVERY
* DELIVERED

---

# 18. Envio Automático do Link

Quando o motoboy inicia a rota:

ROUTE_STARTED

O sistema deve gerar ou recuperar o tracking link de cada entrega.

Exemplo:

`https://dominio.com/acompanhar/<token>`

O sistema deverá disparar automaticamente a comunicação ao cliente.

Canais possíveis:

* WhatsApp
* SMS

---

# 19. Estratégia de Comunicação

Configuração por restaurante:

* WhatsApp
* SMS
* WhatsApp com fallback para SMS
* ambos

Estratégia recomendada:

WhatsApp primeiro.

Se houver falha ou indisponibilidade configurada:

SMS como fallback.

O sistema deve evitar enviar mensagens duplicadas desnecessariamente.

---

# 20. DeliveryNotification

Registrar cada comunicação enviada.

Campos:

* id
* restaurant_id
* delivery_id
* channel
* type
* destination
* provider
* provider_message_id
* status
* error_message
* sent_at
* delivered_at
* read_at
* created_at

Canais:

* WHATSAPP
* SMS
* PUSH

Tipos:

* TRACKING_LINK
* NEXT_DELIVERY
* DELIVERY_COMPLETED
* DELIVERY_CANCELLED

Status possíveis:

* PENDING
* SENT
* DELIVERED
* READ
* FAILED

---

# 21. Eventos de Domínio

A lógica de negócio deve gerar eventos claros.

Eventos iniciais:

* ORDER_CREATED
* DELIVERY_CREATED
* DELIVERY_ASSIGNED
* ROUTE_STARTED
* NEXT_DELIVERY_CHANGED
* DELIVERY_COMPLETED
* ROUTE_DELIVERIES_COMPLETED
* COURIER_RETURNING
* COURIER_ARRIVED
* ROUTE_COMPLETED

Esses eventos não devem ficar espalhados diretamente pelos componentes React.

---

# 22. Serviços

A lógica de negócio deve ser separada da interface.

Estrutura conceitual:

Route Service
→ cria e controla rotas

Delivery Service
→ controla entregas

Courier Service
→ controla estado e disponibilidade dos motoboys

Tracking Service
→ controla página pública e rastreamento

Location Service
→ recebe e processa localização

Notification Service
→ decide quais notificações devem ser enviadas

Messaging Provider
→ integração com WhatsApp/SMS

Push Provider
→ envio de push notifications

---

# 23. Integrações Externas

O núcleo do RpmDelivery não deve depender diretamente de um fornecedor específico.

Exemplo:

Notification Service

→ Messaging Provider Interface

→ Twilio / outro provedor

Isso deve permitir trocar o fornecedor sem alterar regras centrais do sistema.

---

# 24. Cálculo da Taxa de Entrega

Regra inicial:

taxa calculada = distância da loja até o cliente × preço por km

O retorno ao estabelecimento não entra no cálculo.

Se:

taxa calculada < taxa mínima

usar:

taxa mínima

A distância deve representar o trajeto da loja até cada cliente individualmente.

Cada pedido é calculado separadamente, mesmo quando vários pedidos estiverem na mesma rota.

---

# 25. Arquitetura Inicial de Dados

Entidades principais:

profiles

restaurants

restaurant_members

couriers

restaurant_couriers

courier_invites

orders

deliveries

routes

route_deliveries

courier_locations

delivery_notifications

push_subscriptions

Relacionamento conceitual:

User
 └── Profile
      ├── RestaurantMember → Restaurant
      └── Courier
            └── RestaurantCourier → Restaurant

Restaurant
 ├── Orders
 │    └── Delivery
 │
 ├── Routes
 │    └── RouteDeliveries
 │         └── Delivery
 │
 └── CourierInvites

Courier
→ CourierLocations

Delivery
→ DeliveryNotifications

Delivery
→ PushSubscriptions

---

# 26. Realtime

Atualizações importantes devem poder aparecer em tempo real para:

## Restaurante

* posição do motoboy;
* mudança de status;
* entrega concluída;
* retorno à loja.

## Cliente

* posição do motoboy;
* quantidade de entregas anteriores;
* mudança para NEXT;
* entrega concluída.

---

# 27. MVP Inicial

O MVP deve incluir:

* autenticação do restaurante;
* cadastro de motoboys;
* disponibilidade de motoboys;
* fila por ordem de disponibilidade;
* cadastro de pedidos;
* criação de entregas;
* criação de rotas;
* múltiplos pedidos por rota;
* ordem das entregas;
* saída do motoboy;
* localização em tempo real;
* conclusão individual das entregas;
* status RETURNING;
* retorno à loja;
* página pública de rastreamento;
* mini mapa do cliente;
* contador de entregas anteriores;
* status "Você é o próximo";
* push notification;
* envio automático do tracking link;
* WhatsApp e/ou SMS;
* histórico básico.

---

# 28. Fora do MVP Inicial

Não implementar agora:

* marketplace de motoboys;
* motoboys avulsos externos;
* disputa de entrega por proximidade;
* pagamento online;
* carteira digital;
* otimização avançada automática de rotas;
* inteligência artificial para despacho;
* integração direta com pedidos de WhatsApp;
* aplicativo nativo;
* sistema completo de avaliação de motoboys.

A arquitetura não deve impedir a implementação futura desses recursos.

---

# 29. Princípios Técnicos

O RpmDelivery deve seguir:

* mobile-first;
* TypeScript estrito;
* código simples e legível;
* componentes pequenos;
* regras de negócio fora da camada visual;
* arquivos pequenos e organizados por responsabilidade;
* segurança por padrão;
* separação entre domínio e integrações;
* operações críticas transacionais;
* validação de estados no backend;
* nenhuma chave de API no frontend;
* nenhuma regra crítica confiada apenas ao cliente.

---

# 30. Stack Inicial

Frontend e aplicação web:

* Next.js
* TypeScript
* App Router
* Tailwind CSS

Backend e banco:

* Supabase
* PostgreSQL

Recursos esperados:

* Supabase Auth
* PostgreSQL
* Row Level Security
* Supabase Realtime

Serviços externos serão escolhidos posteriormente para:

* mapas;
* cálculo de rotas;
* WhatsApp;
* SMS;
* push notifications.

Nenhuma integração externa deve ser acoplada diretamente ao domínio principal.

---

# 31. Regra Principal de Arquitetura

O fluxo proposto de convites e vínculos reais, isolado da operação demonstrativa,
está em [RPM-ONBOARD-001](courier-invitations.md). Comandos autenticados e
autorizados por loja vivem em RPCs; a interface não escreve diretamente nos
vínculos nem usa identificadores de ator fornecidos pelo cliente.

Antes de implementar uma nova funcionalidade, verificar:

1. qual entidade é responsável;
2. qual estado muda;
3. qual evento é gerado;
4. quais usuários precisam ser atualizados;
5. quais notificações são necessárias;
6. se existe impacto de privacidade;
7. se existe risco de concorrência;
8. se a mudança afeta o tracking público.

A implementação deve respeitar este documento enquanto ele representar as decisões atuais do produto.
