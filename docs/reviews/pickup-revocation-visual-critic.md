# Visual Critic — revogação de retirada

Rechecagem independente do P2 Lead da PR #13. Relatório salvo pelo Builder; nenhuma correção/arquivo foi escrito pelo Critic. Candidato UI `b47564b76827081cacc0d281b686188202682ebc`; capturas citadas pertencem a [esse commit imutável](https://github.com/henriqueskm/rpmdelivery/tree/b47564b76827081cacc0d281b686188202682ebc/docs/screenshots/pickup-revocation). O commit seguinte adiciona somente este relatório, preservando a UI revisada.

Prova do runtime: coordenador `01a130c4-389f-74b1-9a32-32dd61cbbb6e`, filho `01a130c4-cbd6-74e3-b1ee-763e39167b49`, `agent_role=rpmdelivery_visual_critic`, `/root/pickup_revocation_critic`, sandbox read-only e approval never. Sessão independente, sem histórico do Builder. A inspeção interativa do Builder está em [pickup-revocation-qa.md](../pickup-revocation-qa.md), separada do fallback do Critic para imagens.

Invocação nativa concluída: `collaboration.spawn_agent` com `agent_type="rpmdelivery_visual_critic"` e `fork_turns="none"`, sem histórico do Builder. ID retornado: `/root/pickup_revocation_critic`. Aguardei sua conclusão. O coordenador confirmou via Git o HEAD, a branch, a árvore limpa e a ancestralidade informados.

Relatório integral do Critic:

---

Recomendo **fechar o P2 operacional no escopo do protótipo em memória**: a revogação ganhou uma ação própria, sem exigir edição dos pedidos. **Nenhum novo achado nos cenários inspecionados.** Esta conclusão usa inspeção independente das imagens e do código; o ciclo não pôde ser repetido interativamente nesta sessão.

Revisor: `rpmdelivery_visual_critic`, ID `/root/pickup_revocation_critic`.

Contexto conferido por Git: PR #13, branch `codex/delivery-deadlines-pickup`, HEAD `b47564b76827081cacc0d281b686188202682ebc`, árvore limpa. O HEAD anterior `e73af1e97301cd5bc67452c02f5dd64bd8d1703f` é ancestral do candidato. URL informada: `http://127.0.0.1:3007/preview/operacao?scenario=demo`.

Inspecionei as 17 capturas de `docs/screenshots/pickup-revocation`: desktop 1280×800 e 1440×900; mobile 320×844, 375×844 e 390×844. Cobertura visual: liberada, revogada e motoboy bloqueado nas cinco dimensões; nova liberação e ON_ROUTE em 390×844. Metadados fornecidos identificam cenário demo, DPR 1, fontes carregadas e relógio congelado em 12/10/2026 às 15:00.

O P2 fica resolvido pelas seguintes evidências:

- Nas capturas `*-released.jpg`, “Cancelar liberação” aparece separadamente de “Editar montagem”, junto da mensagem “Pronto para retirada · início exclusivo pelo motoboy”.
- Nas capturas `*-revoked.jpg`, a rota continua “Em preparação”; os pedidos #1042/#1041 mantêm ordem, bairros e prazos, enquanto o estado volta para “Aguardando liberação”. No mobile, o aviso também explica o bloqueio do início e a preservação da reserva.
- Nas capturas `*-driver-blocked.jpg`, ambos os destinos continuam consultáveis e o início aparece visualmente desabilitado. Em `390-driver-released-again.jpg`, o estado volta para “Pronto para retirada”; `390-on-route.jpg` mostra a saída atribuída ao motoboy.
- O ramo em [model.ts](https://github.com/henriqueskm/rpmdelivery/blob/b47564b76827081cacc0d281b686188202682ebc/features/operations/model.ts#L125) aceita revogação somente em PREPARING com liberação vigente e altera exclusivamente `pickupReleasedAt`. O início exige liberação válida e o motoboy atribuído. ON_ROUTE, RETURNING e COMPLETED ficam fora da revogação.
- [routes-panel.tsx](https://github.com/henriqueskm/rpmdelivery/blob/b47564b76827081cacc0d281b686188202682ebc/features/operations/routes-panel.tsx#L106) oferece a ação somente em PREPARING; [use-operations-controller.ts](https://github.com/henriqueskm/rpmdelivery/blob/b47564b76827081cacc0d281b686188202682ebc/features/operations/use-operations-controller.ts#L92) comunica sucesso ou rejeição.

| Antes | Depois observado | Benefício |
| --- | --- | --- |
| Revogação dependia de editar a montagem | Ação própria “Cancelar liberação” | Retira a autorização sem interferir na composição |
| Retirada continuava autorizada | “Aguardando liberação” e início bloqueado | Evita saída antes de nova autorização |
| Necessidade de recuperar a autorização | “Liberar retirada” reaparece na mesma posição | Permite retomar o despacho com sequência e reserva preservadas |

A legibilidade resistiu nas capturas estreitas: rótulos completos, códigos, bairros, prazos e mensagens essenciais permanecem visíveis, sem sobreposição aparente. Os controles de cancelamento ocupam aproximadamente 44 px de altura no mobile e 40 px no desktop, conforme o padrão existente. Os dois destinos cabem integralmente nos diálogos capturados, com a ação inferior visível. Os quatro cartões de rota cabem integralmente nas capturas desktop. Não identifiquei perda visual recorrente de densidade decorrente desta alteração.

Os testes adicionados contêm verificações pertinentes de conservação do estado, bloqueio, nova liberação, foco, reserva e rejeição após a saída. **Li as asserções; não executei os testes.** Os resultados de verify, unitários, E2E, SQL local e audit continuam sendo resultados informados pelo Builder.

Limitações: a tentativa de abrir o navegador integrado retornou `Browser is not available: iab`. Não usei Chrome nem contornei a restrição. Portanto, teclado, foco real, Escape, ARIA, rolagem, área clicável efetiva, console e network não foram verificados independentemente. As imagens não comprovam ausência de overflow horizontal fora do enquadramento. Textos extremos, alto volume, vazio, loading e erros não tiveram cobertura renderizada nesta rechecagem. Não havia frame Figma aprovado nem aparelho físico; teclado virtual, safe areas, gestos e zoom nativo permanecem não testados.

Devolvo ao Builder a recomendação de fechar este P2 demonstrativo, preservando essas limitações no registro. Não há nova correção visual prioritária comprovada. A decisão sobre a PR continua humana; nenhuma aprovação, alteração ou merge foi realizado.
