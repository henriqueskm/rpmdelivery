# Revisão independente final — PR #10

Nota de registro do Builder: relatório integral abaixo, com links normalizados para o commit revisado. Invocação nativa comprovada por metadados: coordenador `01a12d83-5d34-7a62-9885-2f392df1d069`; sessão filha nova `01a12d83-b0ff-7280-be8d-938956eead88`; role `rpmdelivery_visual_critic`; sandbox `read-only`; approval `never`. Sem histórico da implementação. A configuração importada da main permaneceu intacta. A revisão não alterou arquivos; este documento foi salvo pelo Builder após a sessão terminar.

As lacunas interativas do Critic são distinguidas do QA do Builder: E2E desktop/mobile e navegador integrado do Builder verificaram observações/endereço, seleção, reordenação, abertura, foco/Escape/retorno e atribuição PREPARING. A inspeção do Builder e seus testes não são apresentados como inspeção independente do Critic. Figma aprovado e hardware físico não estavam disponíveis.

---

Revisei a PR #10, branch `feat/restaurant-operations-dashboard`, HEAD **`a2713fd37be370231696a6ab5ea581f76703d901`**, confirmado pelo Git, com árvore limpa. **Nenhum achado nos cenários inspecionados.** Os três P2 anteriores têm evidência visual de solução, dentro da cobertura descrita abaixo. Isso não constitui aprovação da PR.

Identidade desta sessão: nome canônico `/root/visual_critic_followup`; `agent_type: rpmdelivery_visual_critic`, invocação nativa. ID adicional não disponível nesta sessão. A revisão ocorreu sem histórico de implementação do Builder e somente em leitura.

A URL fornecida foi `http://127.0.0.1:3006/preview/operacao?scenario=demo`. Inspecionei as **20 capturas atuais** de `busy` e `worst`, nos modos compacto e ampliado, em **1280×800, 1440×900, 320×844, 375×844 e 390×844**. Também examinei três capturas anteriores para comparação, os dois arquivos de métricas e os componentes pertinentes. A associação das capturas aos HEADs e as condições de fontes, DPR e seleção foram fornecidas pelo Builder; não recapturei esses estados.

| P2 anterior | Resultado observado | Situação |
| --- | --- | --- |
| Observações ausentes | Observações e referências aparecem completas, com quebra de linha. Em `worst`, o aviso de alergia conserva inclusive a instrução final “Não deixar na recepção sem confirmação”. | Resolvido nas capturas; itens fora da área inicial não foram conferidos por rolagem interativa. |
| Pouca área útil mobile | “Conferir” oferece uma lista substancialmente maior e conserva seletor, explicação da reserva e ação de atribuição dentro da tela. | Mitigado pela conferência ampliada. O compacto continua exigindo rolagem para textos longos. |
| Endereço ausente na conferência | Rua, número e complemento aparecem na conferência. O primeiro pedido de `worst` mostra avenida, número 1284, condomínio e referência de acesso. | Resolvido nas capturas ampliadas. |

Evidências representativas: [worst ampliado em 320px](https://github.com/henriqueskm/rpmdelivery/blob/a2713fd37be370231696a6ab5ea581f76703d901/docs/screenshots/p2-final/after-worst-320-expanded.jpg), [worst ampliado em 1440px](https://github.com/henriqueskm/rpmdelivery/blob/a2713fd37be370231696a6ab5ea581f76703d901/docs/screenshots/p2-final/after-worst-1440-expanded.jpg) e [busy ampliado em 390px](https://github.com/henriqueskm/rpmdelivery/blob/a2713fd37be370231696a6ab5ea581f76703d901/docs/screenshots/p2-final/after-busy-390-expanded.jpg).

Recalculei as paradas completas usando `rowBounds.top ≥ listTop` e `rowBounds.bottom ≤ listBottom`, incluindo a linha inteira. **Todos os valores atuais de `completeStops` conferem com os limites fornecidos.** Não contei conteúdo legível com borda ou padding fora da lista como parada completa.

| Viewport | Área da lista: compacto → ampliado | Paradas completas `busy` | Paradas completas `worst` |
| --- | --- | --- | --- |
| 1280×800 | 283 → 516px | 3 → 6 | 1 → 5 |
| 1440×900 | 401 → 616px | 7 → 8 | 4 → 6 |
| 320×844 | 242 → 523px | 2 → 4 | 0 → 2 |
| 375×844 | 258 → 541px | 3 → 5 | 1 → 3 |
| 390×844 | 276 → 559px | 3 → 6 | 1 → 3 |

Em `worst/320`, o compacto mostra a observação integral da primeira parada, mas seus controles ultrapassam a área inicial da lista; por isso são **zero paradas inteiramente completas**. A conferência apresenta duas completas. Essa diferença não indica desaparecimento da observação. Da mesma forma, `visibleNotes < totalNotes` descreve a posição inicial de rolagem, não prova omissão de dados.

| Antes | Depois observado / recomendação de manutenção | Benefício |
| --- | --- | --- |
| Montagem sem observações | Manter observações e referências integrais, sem clamp | Preserva instruções decisivas para entrega e embalagem |
| Lista mobile restrita ao painel | Manter “Conferir” e o rodapé visível | Amplia a conferência sem reduzir fontes ou esconder informações |
| Conferência sem destino detalhado | Manter endereço junto de cada parada | Permite avaliar a sequência pelos destinos reais |

A implementação responsável está em [builder-panel.tsx](https://github.com/henriqueskm/rpmdelivery/blob/a2713fd37be370231696a6ab5ea581f76703d901/features/operations/builder-panel.tsx#L150), com referências e observações logo após o endereço; o layout da conferência está em [operations.css](https://github.com/henriqueskm/rpmdelivery/blob/a2713fd37be370231696a6ab5ea581f76703d901/features/operations/operations.css#L510).

Nas capturas atuais, nomes extensos, código longo, caracteres chineses e árabes e conteúdo literal `<b>…</b>` resistiram ao reflow sem overflow horizontal aparente. As ações principais permanecem visíveis. A marca do raio e a hierarquia atual foram preservadas. O texto mantém PREPARING/reserva e início exclusivo pelo motoboy.

Os controles mobile aparentam 44px nas imagens, e o CSS estabelece mínimos de 44×44px tanto no breakpoint mobile quanto em `pointer: coarse`. No desktop com ponteiro fino, os controles de sequência usam 32px; não interpreto isso isoladamente como falha de toque, pois existe override específico para ponteiro coarse. A área efetiva de toque não foi medida interativamente.

**Cobertura pendente:** `demo`, `empty` e `one` não foram inspecionados renderizados nesta sessão. Também não foram verificados teclado, Escape, retorno de foco, reordenação, remoção, filtros, atribuição, rolagem até o último item, console/network, loading, erros ou os fluxos ON_ROUTE/RETURNING/retorno confirmado. O código contém mecanismos de diálogo e foco, mas isso não equivale a testá-los. Sem aparelho físico, teclado virtual, safe areas, gestos e zoom nativo permanecem pendentes. Não houve frame Figma aprovado nem avaliação completa de conformidade WCAG. Os testes relatados pelo Builder não foram executados ou usados como prova visual independente.

Devolvo ao Builder como prioridade a **validação interativa dessas lacunas no mesmo HEAD**, especialmente conferência e rolagem em `worst/320`, fechamento por Escape e retorno de foco. Não há correção visual adicional comprovada para solicitar nesta cobertura; a decisão da PR continua humana.

O navegador integrado retornou “Browser is not available: iab”. A tentativa posterior de abrir a demo no Chrome foi rejeitada pela política de segurança porque o usuário negou acesso à URL. Não fiz contorno nem novas tentativas; a revisão ficou limitada às capturas, métricas e fontes.