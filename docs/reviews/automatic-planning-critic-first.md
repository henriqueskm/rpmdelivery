Revisão independente concluída em leitura. Identidade: custom subagent nativo `rpmdelivery_visual_critic`, sessão `/root/independent_visual_critic`, sem histórico de implementação do Builder. Nenhum arquivo foi alterado.

Contexto: branch `codex/automatic-route-planning`, PR ainda não aberta, HEAD confirmado `3ba4194bae198971789feeda41c54e7f2d6d819d`; base `5abda69412ce4b0224d61a33898622cb2a81f00d`. URL fornecida: `http://127.0.0.1:3009/preview/operacao?scenario=opt-urgent`. Sem frame Figma aprovado.

O IAB retornou **“Browser is not available: iab”**. A revisão visual usa as 22 capturas fornecidas, efetivamente abertas com `view_image`, e leitura dos componentes. Dimensões confirmadas pelos cabeçalhos PNG: desktop 1280×800 e 1440×900; mobile 390×844, 375×844 e 320×844. Cenários: urgência, pico, prazo impossível, texto longo, coordenadas ausentes, percurso ausente, vazio, um pedido, ausência/escassez de motoboys e proximidade; também capturas com detalhes de rota e pendências abertos.

Não identifiquei P0 ou P1 nas evidências disponíveis. Há fricções P2 de compreensão e conferência.

**[P2] “Continuam aguardando” não distingue proposta de decisão selecionada**

Em `urgent-390.png` e `urgent-1280.png`, o resumo mostra **6 entregas agrupadas / 0 continuam aguardando**, enquanto nenhuma rota está selecionada e o rodapé mostra **Confirmar 0 rotas**. O número descreve o resultado hipotético de confirmar todas as propostas, mas o rótulo soa como situação atual. Para quem está aprendendo o sistema, isso pode sugerir que os pedidos já saíram da fila ou que não haverá pendências ao confirmar somente uma rota.

Evidência estática verificável: `automatic-routes.tsx:25–26` usa `plan.assignedCount` e `plan.pending.length` independentemente da seleção. `automatic-dialog.tsx:27–29` calcula as pendências da seleção separadamente, exibindo-as no contexto inferior somente quando existe seleção.

Reprodução a conferir pelo Builder: gerar propostas em `opt-urgent`, sem selecionar; comparar resumo e rodapé; selecionar somente a rota de duas entregas e conferir os dois resumos.

Responsáveis: [automatic-routes.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-routes.tsx:23) e [automatic-dialog.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-dialog.tsx:61).

Recomendação: identificar o resumo como **“Se confirmar todas as propostas”** e usar **“entregas nas propostas / fora das propostas”**; manter próximo da confirmação um resumo da seleção efetiva, incluindo entregas e pedidos que permanecerão aguardando. Benefício: conferir o alcance da decisão sem interpretar duas contagens com significados diferentes.

**[P2] No pico mobile, nenhuma rota ou motoboy aparece antes da rolagem**

Em `busy-390.png` e `busy-375.png`, a primeira tela mostra métricas, limites e alertas, mas nenhum nome de motoboy ou cabeçalho de rota. Em `busy-320.png`, nem o acionador de pendências está inteiramente visível. O rodapé permanece presente com **Confirmar 0 rotas**, embora os controles de seleção estejam fora da primeira tela.

Na captura 390×844, os cards começam aproximadamente em y=708, depois do limite visível do corpo em y=680. Em `urgent-390-details.png`, abrir “Conferir e ajustar pedidos” deixa somente o início do primeiro pedido visível; nenhum pedido completo cabe antes do rodapé. Isso aumenta o trabalho de exploração necessário para conferir a proposta, especialmente durante despacho repetitivo. **Não é evidência de que a rolagem esteja quebrada.**

Reprodução a conferir: gerar o cenário de pico nos três tamanhos mobile, manter a posição inicial; depois abrir detalhes no cenário urgente sem alterar a posição.

Responsáveis: [automatic-routes.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-routes.tsx:20), [automatic-pending.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-pending.tsx:16) e [optimization.css](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/optimization.css:13).

Recomendação: reorganizar o resumo mobile para apresentar cedo uma lista compacta das rotas, com motoboy, quantidade e risco; preservar o alerta agregado de pendências, colocando a explicação detalhada junto à expansão correspondente. Consolidar mensagens repetidas e tornar perceptível a continuação rolável. Não reduzir fontes nem ocultar alertas essenciais. Benefício: reconhecer rapidamente quem levaria cada grupo e onde iniciar a conferência.

**[P2] Motivo de nenhuma rota fica oculto no estado sem motoboys**

`no-couriers-390.png` mostra **Nenhuma rota sugerida / 0 rotas / 6 aguardando**, mas a tela aberta não informa diretamente **“Sem motoboy disponível”**. O operador recebe um alerta sobre prazos e precisa abrir “Ver 6 pedidos pendentes e motivos” para descobrir a causa operacional.

O código confirma que o motivo existe em `pendingLabels.couriers`, mas é apresentado individualmente dentro dos detalhes. A mensagem principal permanece genérica. Isso deixa o próximo passo incerto: alterar critérios, recalcular ou aguardar disponibilidade.

Reprodução a conferir: gerar propostas no cenário de ausência de motoboys e observar o resultado antes de expandir pendências.

Responsáveis: [automatic-routes.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-routes.tsx:21) e [automatic-pending.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-pending.tsx:22).

Recomendação: mostrar junto de “Nenhuma rota sugerida” uma causa agregada comprovada, por exemplo **“Nenhum motoboy elegível disponível; os 6 pedidos permanecem aguardando”**. Para causas mistas, enumerar suas contagens sem prometer solução por recálculo. Benefício: orientar a operação sem exigir investigação pedido por pedido.

**[P2] Explicação do agrupamento é genérica e não permite conferir sua lógica rapidamente**

Nos cards desktop de `urgent-1280.png` e `urgent-1440.png`, as duas rotas recebem a mesma frase **“Agrupado por prazos e deslocamento”**. O resumo identifica apenas o pedido de menor prazo, quantidade, duração e distância. Não mostra os bairros do grupo nem uma razão específica que diferencie as duas propostas.

A frase informa os critérios gerais, mas não ajuda um operador a reconhecer o agrupamento concreto. A composição precisa ser descoberta pela expansão de cada card, cujo conteúdo também ultrapassa a área inicial nas capturas com detalhes.

Reprodução a conferir: gerar `opt-urgent` em desktop e comparar os cards fechados.

Responsável: [automatic-routes.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-routes.tsx:45).

Recomendação: acrescentar uma síntese verificável dos bairros e do pedido prioritário de cada grupo. Só apresentar uma justificativa específica de compatibilidade/deslocamento quando houver evidência correspondente no resultado do planejador; não transformar heurística em promessa de melhor rota. Benefício: reconhecer e questionar a proposta antes de abrir todos os pedidos.

**[P3] Singular aparece com rótulos plurais**

`one-390.png` mostra **“1 rotas sugeridas”** e **“1 entregas agrupadas”**. `missing-390.png` e `no-route-390.png` mostram **“1 continuam aguardando”** e **“Ver 1 pedidos pendentes e motivos”**. É acabamento de baixo impacto; as quantidades continuam compreensíveis.

Reprodução a conferir: gerar os cenários de um pedido e de uma pendência em 390×844.

Responsáveis: [automatic-routes.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-routes.tsx:24) e [automatic-pending.tsx](C:/Users/PICHAU/.codex/worktrees/automatic-route-planning/rpmdelivery/features/operations/automatic-pending.tsx:22).

Recomendação: aplicar singular/plural aos rótulos e à confirmação. Benefício: linguagem consistente com a decisão apresentada.

| Antes | Depois recomendado | Benefício |
| --- | --- | --- |
| “0 continuam aguardando”, sem seleção | Resumo explicitamente hipotético; pendências da seleção junto à confirmação | Evita interpretar proposta como atribuição |
| Nenhum card visível no pico mobile | Resumo compacto das rotas cedo, com alertas essenciais preservados | Facilita reconhecer motoboys, grupos e riscos |
| “Nenhuma rota sugerida”, causa recolhida | Causa agregada comprovada junto ao título | Indica o próximo passo operacional |
| Justificativa idêntica em todos os cards | Bairros e prioridade concretos; justificativa específica somente se sustentada | Permite conferir o agrupamento |
| “1 rotas / 1 pedidos” | Concordância singular/plural | Melhora o acabamento da linguagem |

Aspectos que resistiram à inspeção:

- Totais de rotas, entregas e pendências têm boa hierarquia visual e permanecem legíveis nos cinco tamanhos.
- Risco apertado usa âmbar; atraso usa vermelho; ambos vêm acompanhados de texto. As cores não são o único meio de comunicação.
- Prazo impossível não é apresentado como sucesso: `impossible-390.png` anuncia seis entregas com atraso previsto.
- O nome longo do motoboy quebra em linhas em `long-320.png`, sem ultrapassar o card.
- Cancelamento e confirmação permanecem visíveis e separados nas capturas.
- A preparação, liberação pela loja e início pelo motoboy estão explicitados no rodapé.
- Não observei overflow horizontal nas imagens. Isso não comprova sua ausência durante interação ou zoom.
- A leitura estática mostra detalhes de endereço, observação, prazo e risco por pedido; ajustes solicitam nova avaliação e as confirmações ficam desabilitadas enquanto a proposta não está pronta. O funcionamento não foi testado nesta sessão.

Limitações: nenhuma interação independente, DOM, teclado, foco, Escape, rolagem, seleção, confirmação, ajustes, carregamento, timeout, invalidação ou recuperação foi executada. Console e network não foram capturados. As capturas de detalhes não cobrem os pedidos completos nem a paginação das pendências; textos longos de endereço/observação permanecem pendentes de inspeção renderizada. Nenhum override de viewport foi aplicado. Hardware, teclado virtual, safe areas, gestos e zoom nativo não foram testados; não há conclusão de conformidade WCAG completa.

Os resultados de verify, unitários, SQL/PGlite, audit e 108 E2E são **relatos do Builder**, não testes desta revisão. As imagens foram fornecidas como evidência do candidato; confirmei o HEAD do checkout, mas não atesto independentemente a proveniência de execução de cada captura.

Devolvo ao Builder, prioritariamente, a distinção entre proposta e seleção, a primeira tela mobile e a causa explícita dos estados sem rota. Não corrigi os achados, não publiquei relatório em disco e não aprovo nem faço merge da PR.