# Montagem automática — evidências do Builder

Base main: `5abda69412ce4b0224d61a33898622cb2a81f00d`. Branch: `codex/automatic-route-planning`. Todos os cenários são fictícios, sem conexão operacional com banco, Mapbox ou outras APIs externas.

## Revisão independente e correções

O candidato inicial `3ba4194bae198971789feeda41c54e7f2d6d819d` foi revisado pelo custom subagent nativo `rpmdelivery_visual_critic`. Coordenador `01a13327-e02d-7653-8cb0-52aee3f80bfb`, filho `01a13328-8619-73d3-bc0d-825658c31f6a`, caminho `/root/independent_visual_critic`, sandbox `read-only`, aprovação `never`. Identidade e políticas foram conferidas nos metadados locais da sessão, sem publicar conteúdo privado de histórico. O agente não editou arquivos.

O [relatório original](automatic-planning-critic-first.md) permanece integral. Encontrou quatro P2 e um P3, sem P0/P1. O Builder implementou as correções:

| Antes | Depois | Benefício |
| --- | --- | --- |
| Contagens pareciam descrever atribuições efetivadas | Resumo hipotético; seleção e pendentes efetivos junto à confirmação | Conferir o alcance da decisão |
| Pico mobile sem motoboy visível inicialmente | Riscos compactos, detalhes progressivos e primeiro seletor visível | Começar a decisão sem explorar avisos repetidos |
| Abrir detalhes deixava a primeira entrega incompleta | Rolagem local posiciona início da conferência; rota/motoboy permanecem identificados | Conferir instruções completas |
| Ausência de motoboys sem causa agregada | Causa explícita e orientação para aguardar disponibilidade | Entender o impedimento sem abrir pedidos |
| Explicação genérica do agrupamento | Bairros e pedido de prazo prioritário nos cards fechados | Reconhecer destinos antes de abrir detalhes |
| Singular e zero com apresentação inadequada | Singular/plural e zero neutro | Contagens legíveis, sem falso sinal favorável |

Também preservamos motivos intrínsecos de pendência após editar outras propostas e mantemos visível o risco dos pedidos fora das rotas, inclusive o limite otimista de trajeto direto. Não há garantia de chegada nem alegação de ótimo global.

## Capturas e inspeção

Capturas iniciais: [candidate](../screenshots/automatic-planning/candidate/observations.json). Capturas corrigidas: [after-review](../screenshots/automatic-planning/after-review/observations.json). Mesmo relógio 12/10 às 15h, saída 15h05, atendimento 2min, capacidade 4 e duração máxima 60min; fontes prontas. Cenários urgente e pico nos cinco viewports, além de impossíveis, textos longos, vazio/um pedido, destinos próximos, coordenadas/percurso ausentes e ausência/escassez de motoboys. Detalhes, pendências e seleção parcial têm capturas próprias. Os PNGs representam o preview, não dados reais.

A segunda sessão nativa (`/root/automatic_planning_visual_recheck`, filho `01a134d1-670c-78d1-9d8d-896e6cc5f9c4`, coordenador `01a134d0-e730-7a01-ab61-bfce13ea86eb`) confirmou três P2 resolvidos, mas apontou que as capturas de conferência não demonstravam o estado estabilizado após `onToggle`. O [relatório integral](automatic-planning-critic-recheck.md) é preservado. Seus dois P3 de linguagem também foram corrigidos: concordância e atraso explícito na estimativa otimista.

O Builder investigou: o reposicionamento já funcionava na interface e na geometria dos E2E, mas o script capturava imediatamente após clicar, antes do evento de expansão. A captura agora aguarda a condição observável de uma entrega integral dentro da área de conferência, sem espera fixa nem injeção de sucesso. As evidências estabilizadas ficam em [final-review](../screenshots/automatic-planning/final-review/observations.json), com imagens de detalhes 390/1280; teste de geometria cobre os cinco viewports. Botões individuais identificam o número da rota e seu nome acessível inclui o motoboy, mesmo quando o cabeçalho ficou acima da rolagem. O motor e as regras de atribuição permaneceram inalterados nessa etapa.

A revisão final independente confirmou o candidato `ede65f58c6a1bd7883d1b3cdf4ae1213ee5688e3`, árvore limpa. Coordenador `01a134e0-9f09-7a11-b6ce-f99b93d27ebe`, filho `01a134e1-1ff1-73a2-9a94-5af829498742`, role nativa `rpmdelivery_visual_critic`, caminho `/root/automatic_planning_visual_recheck`, sandbox read-only/aprovação never. Efetivamente analisou 20 imagens finais e três anteriores. Encerrou os três achados remanescentes nas capturas e registrou **nenhum achado nos cenários inspecionados**. O [relatório integral](automatic-planning-critic-final.md) preserva limites de acesso interativo e não constitui aprovação automática. O commit posterior a esse candidato adiciona somente documentação/relatório, sem mudanças em produto ou testes.

O Builder utilizou o navegador integrado em 320×844, 375×844, 390×844, 1280×800 e 1440×900. Verificou cálculo sem atribuição, seleção parcial, cancelamento/Escape e foco, conferência de instruções, atribuição individual, PREPARING, início bloqueado antes da liberação e início exclusivo do motoboy simulado após a loja liberar. O cálculo no pico mostra lote 24/1000 e todos os pedidos restantes, sem remoção silenciosa.

Cards inteiramente contidos na área de rolagem, antes → depois, sem rolar e com os mesmos dados/hipóteses:

| Viewport | Urgente | Pico |
| --- | --- | --- |
| 320×844 | 0 → 0 | 0 → 0 |
| 375×844 | 0 → 1 | 0 → 0 |
| 390×844 | 0 → 1 | 0 → 0 |
| 1280×800 | 2 → 2 | 0 → 0 |
| 1440×900 | 2 → 2 | 0 → 2 |

No pico mobile, um card completo ainda exige rolagem, mas seu cabeçalho/motoboy e seletor já aparecem na posição inicial; a melhoria não é apresentada como card integral. Alertas de pedidos vencidos, próximos do prazo e limite otimista permanecem explícitos. A conferência de um pedido completo após abrir detalhes é verificada por geometria no E2E em 320px, além da inspeção integrada em 390px.

Na inspeção integrada das propostas corrigidas, o primeiro seletor de motoboy esteve inteiramente visível nos cinco tamanhos; o primeiro pedido completo coube após abrir a conferência mobile. Rodapé: botões 52,78px no mobile e 44px no desktop, dentro do viewport. Nenhum overflow horizontal. Captura CDP do fluxo de cálculo/cenário: sem eventos de exceção/falha de rede, sem paginação pendente ou truncamento; requisições HTTP observadas somente para assets localhost. Console sem erros/warnings. Eventos CDP de respostas do Worker podem ocorrer em alvo filho; a captura de responses feita nos E2E/capturas complementa essa limitação.

## Validação

- `npm ci`: concluído, lockfile e dependências inalterados.
- `npm run verify`: lint, typecheck e build aprovados.
- Unitários: 57 aprovados, zero falhas/skips. Cobrem domínio, assimetria/ciclos, limites, FIFO, riscos globais, individual/lote, conflitos, obsolescência e rollback integral.
- SQL/PGlite: instalação local e suíte aprovadas. Nenhum banco remoto acessado.
- `npm audit --omit=dev`: zero vulnerabilidades. Os cinco alertas altos de desenvolvimento preexistentes na main permanecem separados; nenhuma atualização/override/force foi usada para ocultá-los.
- Playwright no candidato final `ede65f5`: 108 aprovados na suíte completa (`npm run test:e2e -- --workers=1 --retries=0`), 4,0min; 24 aprovados na suíte focal, 1,3min. Zero falhas, flaky ou retries. Inclui preservação de seleção manual e das regras de retirada/início, invalidade/rollback, geometrias nos cinco viewports e timeout/cancelamento/recuperação.
- `git diff --check` e `git diff --cached --check`: aprovados; CI/HEAD da entrega identificados na PR.

Cenário unitário de 1.000 pedidos com capacidade 8: 24 analisados, 51 chamadas exatas, 144.632 permutações, abaixo dos limites 80/160.000. Uma execução observou 199,9ms no domínio; é uma medição local, não garantia de latência. Worker sob demanda possui watchdog de 5s. A interface permanece utilizável quando o Worker não responde; cancelamento, timeout e recuperação foram testados com fixture explícita.

## Limitações

Sem frame Figma aprovado; usamos o design system e o raio atual. O Critic inicial não acessou IAB; analisou efetivamente as 22 imagens e código, sem testes interativos independentes. Isso é distinto do QA interativo do Builder. Emulação não cobre hardware, teclado virtual, safe areas, gestos ou zoom nativo. Nenhuma auditoria WCAG completa ou teste de operador real foi alegado. A decisão da PR continua humana.

Integração real requer autenticação/tenant no servidor, coordenadas confirmadas persistidas, matriz autorizada com freshness/cache/quota, revisão dos dados, transação/locks/idempotência e validação da liberação/início no backend. Documentação em [automatic-route-planning](../automatic-route-planning.md). Nenhuma migration, Supabase remoto, tracking, notificação real, produção ou Issue #12 foi implementada.
