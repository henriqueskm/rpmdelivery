# Sugestão de rotas (montagem automática)

Estudo e decisão de 2026-11-22. Opção escolhida: **desvio pelo tempo nas ruas, com as regras da loja como explicação** (opção C do estudo). As alternativas descartadas:
- só texto de rua e bairro;
- só linha reta;
- resolvedor completo (OR-Tools/VROOM, que exige servidor próprio);
- API de otimização do Mapbox (até 12 pontos, sem explicação).

## O que a loja vê

No painel real, **Sugerir rotas** fica na Montagem e, no celular, na barra do topo. Ela lista as rotas propostas, da mais urgente para a menos urgente. Cada rota mostra:
- o motoboy da vez na fila (ou "Sem motoboy disponível agora");
- entregas, minutos e km estimados;
- o motivo de cada pedido estar ali.

**Usar esta rota na montagem** preenche a Montagem com os pedidos na sequência e o motoboy. A loja confere e atribui como sempre. Nada é salvo pela sugestão. Pedidos sem pino confirmado no mapa ficam de fora, com o número de cada um.

## Regras (`features/route-planning/grouping.ts`)

Valores padrão, decididos pelo dono em 2026-11-22:

| Regra | Valor |
|---|---|
| Entregas por rota | até **8** (pensando em restaurantes com alto volume) |
| Desvio para entrar "no caminho" | até **10 min** |
| Bairros vizinhos | até **2 km** entre as entregas |
| Espera para agrupar | **nenhuma**: sugere com o que existe agora |
| Tempo em cada porta | 3 min |

**Como uma rota é montada:**
1. Ela começa pelo pedido mais urgente que sobrou, que é o pedido base.
2. Depois, um candidato por vez, entra o que tiver o motivo mais forte. A força vai de mesmo endereço (pino a até 40 m, ou mesma rua e número) a mesma rua, mesmo bairro, bairro vizinho e, por último, no caminho.
3. Entre candidatos com o mesmo motivo, ganha o de menor desvio.

**Desvio** é quanto o motoboy roda a mais do que a maior das duas viagens: a rota como está, ou o pedido sozinho. A medida é simétrica de propósito:
- 3 km numa estrada fica no caminho de 7 km na mesma estrada, não importa qual pedido chegou primeiro;
- um pedido na direção oposta custa quase a viagem inteira.

**Quando um pedido não entra:**
- quando o desvio passa do limite. O mesmo endereço sempre entra;
- quando faz outro pedido atrasar em relação ao horário prometido.

**A ordem final** testa todas as sequências possíveis (até 8! = 40.320) e escolhe pela ordem:
1. menos atrasos;
2. menos minutos de atraso;
3. menos minutos rodando;
4. clientes atendidos mais cedo.

**Normalização do texto:** acentos, maiúsculas e abreviações (R., Av., Jd., Vl., Pq.) não separam o mesmo lugar.

## Tempos pelas ruas (F2)

**De onde vêm os tempos:**
- Ao abrir **Sugerir rotas**, o painel manda para `POST /api/routing/legs` (`lib/routing/legs-handler.ts`) a loja e os pedidos com pino, em até 60 pontos, primeiro os mais urgentes.
- O servidor confere o login com o token do usuário.
- Ele lê os trechos que a loja já tem (`read_route_legs`) e pede ao Mapbox Matrix só os que faltam. São blocos de até 24 pontos, origens × destinos (`lib/routing/leg-blocks.ts`), no máximo 25 pedidos por vez.
- Depois guarda os trechos novos (`save_route_legs`).

**O cache:**
- Fica em `private.route_legs`, separado por loja.
- Os pontos são arredondados a 5 casas, cerca de 1 m.
- Um trecho vale por 90 dias, e depois é pedido de novo.
- Como cada trecho só é pago uma vez, os 100 mil elementos grátis por mês do Mapbox cobrem milhares de pedidos.

**Quando falta algum tempo:** se o Mapbox falhar (limite, fora do ar, tempo esgotado), a resposta traz o que se sabe com `partial: true`. Os trechos sem tempo usam a estimativa, e a tela diz se os tempos são das ruas, parciais ou estimados.

**Os limites da loja:**
- Ficam em `restaurants.route_max_stops`, `route_max_detour_minutes` e `route_neighbor_meters`.
- Os padrões são 8 entregas, 10 min e 2 km.
- O dono ou o gerente muda em **Dados da loja → Montagem automática** (`set_route_settings`). Os outros membros só leem.

**O token:** o servidor usa o `MAPBOX_ACCESS_TOKEN`, o token sem restrição de URL. O token do mapa, restrito ao site, não serve aqui.

## Bairros vizinhos e motoboy livre (F3)

**Bairros vizinhos pelo histórico:**
- `get_neighborhood_centers(restaurant)`, da migration `20261129120000`, só para membros da loja, calcula o **centro de cada bairro**. É a média dos pinos dos pedidos da loja nos últimos 180 dias, só os confirmados no mapa.
- O bairro é agrupado sem diferenciar maiúsculas. No painel, as grafias que se normalizam igual, como "Jd." e "Jardim", são somadas pelo número de pedidos.
- Dois bairros são vizinhos quando os **centros** estão a até a distância da loja (2 km por padrão). O motivo aparece como "Bairro vizinho de #X (centros a 1,5 km)".
- Um bairro sem histórico volta a usar a distância entre os dois pedidos.
- Com os centros, dois bairros cujos centros estão longe não são vizinhos, mesmo que estes dois pedidos estejam perto.

**Motoboy livre:**
- Quando o primeiro motoboy da fila está livre e há pedidos esperando com pino, o painel mostra **"Bruno Alves está livre · 4 pedidos esperando com endereço no mapa"**, com **Sugerir rotas** e **Agora não**.
- "Agora não" esconde o aviso para aquele motoboy até chegar mais pedido.
- O aviso não aparece enquanto uma rota está sendo editada. Nunca cria rota sozinho.

## Fases

- **F1:** regras e desvio estimado em linha reta × 1,35, a 25 km/h.
- **F2:** tempos reais pelas ruas, com cache por loja e limites ajustáveis pela loja. A estimativa continua como reserva.
- **F3 (esta):** centros dos bairros aprendidos com o histórico da loja, e o aviso de motoboy livre com pedidos esperando.

## Testes

- `tests/unit/route-suggestions.test.ts` cobre:
  - normalização;
  - cada motivo;
  - limite de 8;
  - atraso;
  - desvio (incluindo o mesmo endereço sem limite);
  - resultado sempre igual.
- `tests/unit/route-legs.test.ts` cobre:
  - os blocos do Mapbox;
  - a rota do servidor: cache, pedir só o que falta, salvar, falha do Mapbox, login inválido e outra loja.
- `tests/sql/delivery-core/route-legs-contracts.sql` cobre:
  - cache por loja, arredondamento, 90 dias e valores inválidos;
  - tabela inacessível diretamente;
  - limites (padrões, dono, operador, faixas).
- `tests/e2e/operations-live.spec.ts` ("sugerir rotas") cobre:
  - a tela, os motivos e os pedidos sem pino;
  - o preenchimento da Montagem e o `create_route` com a sequência e o motoboy;
  - os tempos das ruas separando bairros vizinhos;
  - os limites da loja;
  - a queda para a estimativa.
- `tests/e2e/store-profile.spec.ts` cobre os limites em Dados da loja.
