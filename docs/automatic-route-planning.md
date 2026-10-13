# Montagem automática — protótipo demonstrativo

Base: main após squash da PR #14, `5abda69412ce4b0224d61a33898622cb2a81f00d`. Branch `codex/automatic-route-planning`. Esta feature sugere grupos; confirmar é uma decisão explícita do restaurante. Não cria operações reais.

## Auditoria e arquitetura

O otimizador da PR #14 recebe matriz dirigida, calcula chegada/conclusão/retorno e prioriza quantidade de atrasos, atraso total, viagem e distância. Continua exato até oito paradas. Seu algoritmo e os contratos/adaptador Mapbox não mudaram.

- `features/route-planning/`: domínio TypeScript puro de seleção, agrupamento, avaliação e limites.
- `automatic-input.ts`: converte somente o estado demonstrativo e seleciona matriz de fixtures.
- `automatic-assignment.ts`: snapshot completo e validação pura de confirmação, sem importar fixtures ou adaptadores.
- `planning-worker.ts`: executa o domínio sem React, fetch, token, armazenamento ou mutação operacional.
- `use-automatic-proposal.ts`: Worker sob demanda, cancelamento, invalidação e watchdog.
- `automatic-dialog/routes/pending`: conferência progressiva, ajustes e decisão explícita.
- `operationsReducer`: novo comando atômico; reusa a atribuição existente e preserva as regras de retirada.

A validação compartilhada de matriz aceita um máximo explícito para o lote. O padrão continua nove pontos para uma rota/adaptador existentes; somente o planejador usa até25. Não ampliamos o adaptador real nem criamos endpoint.

## Heurística determinística

1. Considere apenas WAITING. Ordene candidatos por prazo e ID; analise até24. Todos os demais continuam enumerados como pendentes, sem omissão.
2. Motoboys elegíveis: vínculo ativo, AVAILABLE e nenhuma rota ativa. Sugestão FIFO, empate por ID, até seis motoboys. Reservados/PREPARING, ON_ROUTE, RETURNING e turno pendente ficam fora.
3. No lote, valide coordenadas/matriz e trajetos. Priorize sementes pela margem otimista até a conclusão do atendimento, considerando origem→destino.
4. Acrescente localmente o melhor entre até quatro candidatos compatíveis por custos dirigidos de inserção. Reuse a otimização exata da PR #14 somente dentro desse grupo. Considere retorno, atendimento, limite de duração e capacidade.
5. Se nenhum trajeto individual funcionar, tente até quatro pares dirigidos como semente. Isso permite ciclos através de duas paradas; não é uma busca global por todos os ciclos possíveis.
6. Revisite uma vez cada grupo com vaga após formar as rotas. A mesma inserção local avalia agora todas as rotas e pendentes, aproveitando vagas quando o score geral permite. Preserve motoboy/FIFO e pare no mesmo orçamento de busca. Capacidade padrão quatro, ajustável1–8; duração máxima padrão60min, incluindo retorno e atendimento, ajustável1–120min.

O score compara quantidade de atrasos previstos e risco dos pendentes, atraso em segundos, pendências próximas do prazo, cobertura, viagem e distância. Não há economia inventada nem comparação com uma solução manual que usa outras premissas.

Pendentes fazem parte da avaliação geral. Para os que têm deslocamento no lote, usamos um **limite otimista** de conclusão direta: saída estimada enquanto há motoboy não usado; caso contrário, o primeiro retorno estimado das propostas. Esse retorno não confirma disponibilidade: o motoboy precisa retornar e confirmar. Esse limite não é uma rota, ETA ou garantia para o pendente. Quem não tem matriz/coordenada continua sem estimativa, com prazo vencido/próximo contabilizado separadamente.

Seleção de24, sementes, inserções e orçamento são heurísticos. Não buscamos nem anunciamos ótimo global. Um percurso não encontrado pelo lote/candidatos pode existir fora dessa busca. Pedidos sem vaga viável ficam aguardando com motivo. Prazos impossíveis não produzem uma promessa tranquilizadora.

## Limites de desempenho

| Limite | Valor |
| --- | --- |
| Pedidos no lote |24|
| Motoboys nas propostas |6|
| Entregas por rota |1–8, padrão4|
| Chamadas ao otimizador exato |80|
| Permutações somadas |160.000|
| Tempo do Worker |5 segundos|
| Entrada total admitida pelo domínio |10.000 pedidos /1.000 registros de motoboys|

O domínio usa orçamento determinístico de operações; não depende de relógio ou aleatoriedade para escolher a resposta. A UI termina um Worker que excede5s e informa falha, sem aceitar resposta parcial tardia. Orçamento de busca pode devolver uma proposta válida limitada, explicitamente sinalizada. Relógio/timers do browser não garantem tempo físico exato em uma aba suspensa.

Matriz fictícia é preparada somente após solicitar o cálculo, para origem e coordenadas válidas do lote. O grafo simulado existente é reutilizado; coordenadas não viram distâncias geodésicas ou tempos fabricados. Não há fetch. A busca exata fica fora da thread de interação. Pendentes são exibidos em páginas de20; os1.000 pedidos não viram1.000 linhas de modal.

## Conferência e confirmação

Cálculo não muda pedidos, motoboys ou rotas. As propostas mostram contagens, motoboy recomendado, prazos, riscos, duração/distância e motivo resumido. Pendências e entrada para seus motivos precedem os cards. Números têm texto/ícones e cores semânticas; cores não substituem explicação.

O operador pode conferir endereços, referências, observações e estimativas completas; ajustar uma sequência, retirar pedidos e adicionar um pendente com coordenadas do mesmo lote. Para substituir, retire e adicione. Ajustes são avaliados nas mesmas hipóteses antes de permitir confirmação; se não forem viáveis, a proposta anterior permanece e o erro é explícito. Dados/critério/horário relevante diferente invalida a resposta antiga.

Uma confirmação individual cria apenas aquela rota. Em lote, a seleção é explícita. Não confirmados continuam WAITING; a confirmação informa quantos continuam aguardando. Não se aplica qualquer proposta antes da ação humana.

A seleção manual não atribuída permanece. A montagem automática fica desabilitada enquanto uma rota existente está em edição, para não descartar esse trabalho. Cancelar devolve foco ao acionador; confirmar direciona foco à área Rotas para conferir PREPARING.

O comando `batch-assign` valida **todas** as atribuições antes de aplicar:

- snapshot completo do estado atual, composição, prazos, origem, fila, vínculos e rotas;
- parâmetros atuais iguais aos calculados, capacidade e saída ainda futura;
- IDs únicos de pedidos/motoboys e grupos presentes na proposta revisada;
- pedidos ainda WAITING, coordenadas confirmadas, nenhum conflito com rota ativa;
- motoboys ainda elegíveis, sem reserva concorrente.

Depois, reaproveita `assign` com estado imutável. Se qualquer atribuição falhar, retorna integralmente o estado original. Não existe aplicação parcial silenciosa. Rotas começam PREPARING, `pickupReleasedAt=null`, com motoboy reservado. A loja libera todos os pedidos por rota; só o próprio motoboy inicia após recolher. ON_ROUTE, retorno, fila, tracking e notificações existentes não foram ampliados.

Snapshot e parâmetros são uma proteção do protótipo em memória, **não uma autorização de backend nem assinatura confiável contra cliente malicioso**.

## Simulado e integração futura

Tudo no preview usa fixtures, coordenadas fictícias e matriz simulada. Novos cenários mostram ausência/escassez de motoboys; cenários anteriores cobrem próximos/distantes, urgência, impossibilidade, ausência de coordenadas/percurso, pico, textos longos, vazio e um pedido. Cadastro fictício continua sem geocodificar.

Para dados reais, uma etapa própria precisará:

1. Autenticar no servidor, verificar membership/papel e isolamento do restaurante; resolver IDs, status, prazos originais e origem confirmada no servidor.
2. Obter coordenadas persistidas e matriz autorizada, com perfil, freshness, cache, orçamento e quota por tenant/usuário. O adaptador atual ainda admite nove pontos; automatização do lote real exigirá estratégia própria de obtenção/partição da matriz e orçamento. Matriz densa25×25 possui625 células; não há consumo cobrável neste protótipo.
3. Versionar os dados e comparar a revisão usada no cálculo. Confirmar em uma transação com locks/revalidação de pedidos e motoboys, restrições de unicidade e idempotência. Um conflito em qualquer grupo deve fazer rollback integral.
4. Manter liberação separada, invalidá-la quando a composição mudar e validar início pelo motoboy no backend. Tracking/notificações somente na transição autorizada, com mecanismos próprios.
5. Tratar classificação futura de prioridades como etapa separada e auditável antes da entrada do planejador. O domínio não importa nem depende de OpenAI Decisions ou qualquer provedor de IA.

Sem Supabase remoto, migrations, RLS, secrets, deploy ou produção. Sem Central de Ocorrências/Issue #12, aplicativo real do motoboy ou novas notificações. Modo manual assistido permanece disponível.

## QA

Unitários verificam determinismo, FIFO, capacidade, assimetria/ciclo, coordenadas/percurso, prazos impossíveis/urgência, pendências, limites e confirmação com rollback/invalidação. E2E verificam dados fictícios, decisão explícita, ajustes, lote/individual, liberação/início, loading/cancelamento/timeout/recuperação e reflow320/375/390/1280/1440.

Resultados, screenshots e revisão nativa independente do Visual Critic serão anexados à PR com HEAD identificado. Sem frame Figma aprovado, usamos o design system e o raio atual. Emulação não substitui hardware, teclado virtual, safe areas ou auditoria WCAG completa.
