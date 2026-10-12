# Otimização manual assistida — MVP demonstrativo

Base: main `a392e6163cc88a28967ca593d46d4a56da9665b5`, squash merge da PR #13. Branch própria `codex/manual-route-optimization`. A montagem continua em memória; esta PR não cria operações reais nem grupos automáticos.

## Auditoria e fronteiras

- Operações: `model.ts` valida PREPARING/reserva, liberação/revogação, início exclusivo do motoboy e bloqueio após ON_ROUTE. Reordenação do mesmo conjunto preserva a liberação; editar o conjunto a invalida. Essas regras permanecem no reducer.
- Geocoding: `services/geocoding/mapbox-provider.ts` já usa MAPBOX_ACCESS_TOKEN server-only; `isResolvedAddress` valida confirmação/limites/metadados. Matrix usa o mesmo nome de variável e reaproveita os tipos/validação de coordenadas do novo domínio de routing; não duplica a busca de endereço.
- Coordenadas: restaurante tem latitude/longitude e proveniência na migration já existente. `findRestaurant` expõe somente id/nome/endereço/telefone. Os pedidos da montagem não vêm de CRUD persistido e não têm coordenadas confirmadas reais disponíveis.
- Auth: `useWorkspace` verifica getUser e membership ativo; consultas reais dependem de RLS. O handler de geocoding autentica o token, mas não fornece autorização operacional por restaurante, IDs persistidos nem orçamento de Matrix.
- Portanto, **não existe endpoint Matrix nesta PR**. O preview público usa somente fixtures locais. Não reaproveitamos o handler de geocoding como endpoint de consumo de Matrix. Auth, RLS, serviços de restaurante e migrations não foram alterados.

## Domínio puro

`features/route-optimization/` separa tipos, validação e algoritmo dos componentes e do adaptador. Entrada: origem confirmada, IDs/coordenadas confirmadas das entregas, limite prometido derivado do horário original, saída estimada, atendimento por parada e matriz dirigida de segundos/metros vinculada aos mesmos IDs/coordenadas.

Até **8 paradas**, sem truncamento: busca exaustiva das permutações, máximo **40.320** sequências. Não usa IA generativa, geocoding implícito, distância euclidiana ou fallback de velocidade para estimar uma viagem real.

A pontuação é lexicográfica:

1. Menor quantidade de entregas previstas após o prazo.
2. Menor atraso total em segundos.
3. Menor tempo de viagem, incluindo retorno à loja.
4. Menor distância desse percurso.

Em empate completo com a ordem manual, ela é preservada. Demais empates seguem a enumeração lexicográfica dos IDs. A mesma entrada produz a mesma saída, sem mutar dados.

Cada chegada acumula tempos dirigidos da matriz e atendimentos anteriores. Conclusão da entrega = chegada + atendimento. **Atraso usa a conclusão**, evitando dizer que uma chegada antes do limite resolve uma entrega cujo atendimento termina depois. A duração total inclui todos os atendimentos e retorno à origem; os dois planos usam as mesmas hipóteses. Pontos coincidentes mantêm IDs e atendimento por pedido.

Arestas nulas tornam aquele trajeto indisponível; outro percurso pode funcionar. Sem ciclo completo, a proposta falha explicitamente, sem omitir destinos. Se nenhuma permutação atender todos os prazos, informamos impossibilidade **sob a matriz/saída/atendimento usados**, não uma certeza sobre trânsito futuro.

Validações: conjunto único exato, origem distinta em ID, coordenadas finitas dentro dos limites, confirmação/proveniência, matriz quadrada compatível, diagonal/coincidência zero, nulos coerentes, células negativas/não finitas/esparsas rejeitadas e limites numéricos. Atendimento explícito 0–1.800 segundos; UI configura 0–30 minutos inteiros. Fase apenas DRAFT/PREPARING.

## Adaptador Mapbox isolado

`services/routing/mapbox-matrix.ts` importa server-only, lê MAPBOX_ACCESS_TOKEN somente ao solicitar uma matriz e utiliza fetch nativo. Consulta o perfil driving com duration/distance; nunca retorna token, URL ou corpo de erro ao consumidor.

Conforme a [documentação oficial Matrix](https://docs.mapbox.com/api/navigation/matrix/), custos são dirigidos e podem ser assimétricos, em segundos/metros. A aplicação limita a **9 pontos / 81 elementos N×N por chamada**, embora o provedor aceite mais no perfil escolhido. Cache não chama o provedor novamente.

- Timeout de 8s, sinal do chamador combinado, cancelamento e rejeição de sucesso tardio.
- Sem retry automático; rate limit respeita Retry-After numérico, limitado a 300s, ou espera60s.
- Uma chamada em voo por instância e intervalo mínimo1s entre novos pedidos. Cache30s, máximo16 entradas, cópias defensivas. Usar o singleton, não criar uma instância por request.
- Resposta limitada a256KiB; código Ok, dimensões, waypoints e valores validados. NoRoute e falhas de conexão explícitos; pares nulos mantidos, sem fallback_speed.
- Recusa coordenadas de fixture. Os testes injetam fetch/token falsos; **nenhuma chamada cobrável ou token real foi utilizado**.

Proteções são locais ao processo, não uma quota distribuída. Antes de conectar dados reais: endpoint autenticado com autorização/membership/papel da loja, isolamento por restaurante, IDs resolvidos no servidor, coordenadas confirmadas persistidas dos pedidos, versões/estado PREPARING, quotas duráveis por ator/restaurante, deduplicação distribuída, orçamento e observabilidade sem secrets. Validar licenciamento/cache e perfil de carro para operação de motoboy. Não enfraquecer essas precondições para ligar o preview à API.

## Interface e invalidação

Selecione pedidos → Sugerir sequência → configure saída/atendimento → Calcular sugestão → compare manual/sugerida → Aplicar ou Descartar. Aplicar altera somente a sequência da montagem, que continua exigindo atribuição/salvamento existente. Não inicia rota, tracking, liberação ou notificação.

A prévia e o motor carregam sob demanda; não calculam nem criam timers para quem usa só a montagem manual. O diálogo fica fora dos painéis ocultáveis, como os demais diálogos da operação, para resistir à troca desktop/mobile.

A proposta guarda uma assinatura dos pedidos selecionados, sua ordem/conteúdo/prazos/coordenadas, origem, rota/fase e parâmetros. Mudar esses dados invalida a proposta imediatamente; uma resposta antiga não se aplica à nova montagem. Fechar descarta e cancela o timer demonstrativo. Saída estimada ultrapassada exige recálculo. Alterar somente liberação não altera tempos/ordem; o estado vigente é preservado no salvamento do reducer.

Datas de outro dia aparecem explicitamente. Margens são arredondadas para baixo e atraso para cima, evitando margem otimista. Não se anuncia garantia de cumprimento; as estimativas são condicionadas à saída/atendimento/matriz.

No mobile, após calcular, as hipóteses ficam resumidas com ação Editar hipóteses. Um resumo de **ambas** as ordens apresenta duração/distância/atrasos antes das listas. Detalhes alternáveis abrem na sugerida; nomes, endereços e limites permanecem integrais. Desktop mantém comparação em duas colunas e controles disponíveis. O rodapé mantém toque ≥44px, sem hover com contraste insuficiente.

## O que usa mocks

Preview e dashboard demonstrativo usam coordenadas de fixture e um pequeno grafo dirigido, escrito como dados de teste, sem relação garantida com as ruas ilustradas. Floyd–Warshall apenas prepara a matriz **simulada** desse grafo; não calcula uma viagem real a partir das coordenadas. O motor principal recebe a matriz pronta.

Cenários: rota curta, destinos próximos, urgente distante, prazos próximos/impossíveis, destino sem rota, serviço indisponível e coordenadas ausentes; textos longos/pico reutilizam cenários existentes. O cadastro manual fictício não inventa coordenadas: sua sugestão fica indisponível. Acima de oito, a seleção inteira continua visível/manual.

Nenhuma integração real está conectada à montagem; o adaptador está pronto para validação futura autorizada. OpenAI Decisions, grupos automáticos, Issue #12, aplicativo real do motoboy, tracking/notificações, banco remoto e produção ficam fora.

## Qualidade

Unitários cobrem determinismo, conjunto/limites, assimetria, retorno, atendimento/atraso, desconexão, entradas inválidas, assinatura obsoleta e manutenção de liberação. Adaptador testado com fetch injetado, sem rede real. E2E incluem comparar/aplicar/descartar, invalidação, erros, pico, textos longos e preservação de PREPARING/liberação.

QA integrado, screenshots/comparações e revisão independente do Visual Critic são registrados na PR. Sem frame Figma aprovado; emulação não substitui hardware/teclado virtual/safe areas, nem auditoria WCAG. SQL é exclusivamente PGlite local; audit de produção é gate. Alertas dev preexistentes permanecem documentados, sem overrides ou mudança de dependências/CI.
