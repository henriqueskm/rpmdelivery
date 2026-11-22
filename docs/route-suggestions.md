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

## Fases

- **F1 (esta):** tempos **estimados** pela linha reta × 1,35, a 25 km/h, sem custo nem API. Por isso a tela avisa que é estimativa.
- **F2:** tempos reais pelas ruas (Mapbox Matrix, 100 mil elementos por mês grátis, até 25 pontos por consulta). Cada trecho calculado fica guardado no banco. A loja ajusta os limites.
- **F3:** bairros vizinhos aprendidos com as entregas já feitas, e a sugestão aparece sozinha quando um motoboy chega na fila.

## Testes

- `tests/unit/route-suggestions.test.ts` cobre:
  - normalização;
  - cada motivo;
  - limite de 8;
  - atraso;
  - desvio (incluindo o mesmo endereço sem limite);
  - resultado sempre igual.
- `tests/e2e/operations-live.spec.ts` ("sugerir rotas") cobre a tela, os motivos, os pedidos sem pino, o preenchimento da Montagem e o `create_route` com a sequência e o motoboy.
