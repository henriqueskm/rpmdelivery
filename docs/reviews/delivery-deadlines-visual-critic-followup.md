# Rechecagem independente — P2 mobile

Relatório nativo salvo pelo Builder. Candidato UI `eaf3d3c17658c13bb7a837a92cc6a2669b1bf601`; imagens pertencem a [esse commit](https://github.com/henriqueskm/rpmdelivery/tree/eaf3d3c17658c13bb7a837a92cc6a2669b1bf601/docs/screenshots/deadlines-pickup). Coordenador `01a130a4-29d2-7fc0-a5d4-31777af96e64`, filho `01a130a4-c154-7740-90b6-cadbac16a47f`, papel nativo `rpmdelivery_visual_critic`, sessão independente `/root/closing_visual_review`, read-only/approval never. O Critic não escreveu nem corrigiu arquivos.

Relatório integral do agente nativo **`rpmdelivery_visual_critic`**, ID **`/root/closing_visual_review`**:

---

Revisor independente: `/root/closing_visual_review` — `rpmdelivery_visual_critic`, invocação nativa, somente leitura.

PR #13, branch `codex/delivery-deadlines-pickup`, HEAD confirmado: `eaf3d3c17658c13bb7a837a92cc6a2669b1bf601`. URL fornecida: `http://127.0.0.1:3007/preview/operacao?scenario=busy`.

**Recomendo encerrar o P2 anterior nos cenários mobile capturados. Nenhum novo achado nos cenários inspecionados.** Essa conclusão se limita à evidência visual disponível e não aprova automaticamente a PR.

Li as orientações do projeto e as skills `emil-design-eng`, `mobile-native`, `break-ui`/catálogo e `rpmdelivery-qa`, aplicando somente inspeção. Não alterei arquivos nem executei testes, builds, servidores ou operações externas. O Git já apresentava modificação em `docs/reviews/delivery-deadlines-visual-critic.md`; esse relatório não foi usado como evidência da correção.

**Evidências e decisão sobre o P2**

Inspecionei as cinco capturas atuais solicitadas: pedidos em 320×844, 375×844 e 390×844; textos longos em 320×844 e 390×844. Comparei também `before-375-orders.jpg` e `before-390-orders.jpg`.

| Aspecto | Observação independente |
| --- | --- |
| Densidade em 375×844 | Cinco pedidos completos, #2000–#2004. O seguinte aparece parcialmente e não entra na contagem. A captura antes também mostra cinco completos. |
| Densidade em 390×844 | Cinco pedidos completos, #2000–#2004, preservando a contagem da captura antes. |
| Densidade em 320×844 | Quatro pedidos completos, #2000–#2003. #2004 fica parcialmente cortado pela área de paginação. |
| Observações | A observação do primeiro pedido permanece legível, abaixo da identificação, sem a coluna de Prazo estreitar toda sua largura. |
| Prazo | Barra e horário aparecem juntos na linha inferior. O atraso de outro dia ocupa uma linha anterior nos exemplos extremos, mantendo a data explícita. |
| Textos longos | Nome, bairro, identificador longo e alerta alimentar quebram linhas; nas partes capturadas, não atravessam a ação Prazo nem saem lateralmente do painel. |

As métricas fornecidas registram área útil da lista de **287,42 px em 375/390** e **271,42 px em 320**, com cinco, cinco e quatro linhas completas respectivamente. As contagens foram conferidas nas imagens; as alturas são métricas fornecidas, não medições DOM independentes desta sessão.

O responsável identificado é [operations-deadlines.css](https://github.com/henriqueskm/rpmdelivery/blob/eaf3d3c17658c13bb7a837a92cc6a2669b1bf601/features/operations/operations-deadlines.css#L66): no mobile, a ação ocupa somente a primeira linha do grid e observação/prazo abrangem `grid-column: 2 / -1`. O controle mantém `min-width` e `min-height` de 44 px no CSS. O componente está em [orders-panel.tsx](https://github.com/henriqueskm/rpmdelivery/blob/eaf3d3c17658c13bb7a837a92cc6a2669b1bf601/features/operations/orders-panel.tsx#L144), com rótulo acessível específico do pedido.

| Antes | Depois observado | Benefício |
| --- | --- | --- |
| P2 anterior relatava reserva da coluna de Prazo também junto às observações/barra e quatro pedidos completos em 375/390. | Reserva junto à identificação; observações/barra usam a largura restante; cinco pedidos completos em ambos. | Recupera leitura simultânea da fila sem esconder observações ou reduzir fontes. |
| Ação precisava preservar área de toque durante a compactação. | Mínimo de 44×44 px mantido no CSS. | Preserva o dimensionamento previsto do controle; a área efetivamente clicável ainda exige conferência interativa. |

Reprodução para o Builder: abrir a demo, escolher **Pico · 1.000 pedidos**, selecionar os vinte visíveis e manter a lista no início em 320/375/390×844. Depois escolher **Textos longos** e conferir identificação, alerta, ação Prazo e data do primeiro pedido, sem rolar.

**Aspectos que resistiram à inspeção**

A fila preserva cinco pedidos completos nas duas larguras que motivaram o P2. As observações capturadas permanecem integrais e legíveis. Estados verde, próximo e vencido incluem texto além da cor. O identificador longo quebra linhas e o conteúdo literal de teste aparece como texto. Não observei sobreposição de conteúdo nem transbordamento lateral nas cinco capturas atuais.

**Limitações e devolução ao Builder**

O navegador integrado retornou `Browser is not available: iab`. Portanto, não executei interação independente, teclado/foco, Escape, edição, seleção, rolagem, console ou network. A ausência de overflow visual nas imagens não comprova ausência de overflow DOM ou de conflito entre áreas clicáveis.

Desktop 1280×800/1440×900 não foi reinspecionado visualmente nesta rodada; consultei apenas suas métricas. Vazio, carregamento, erros, editor e fluxos do motoboy ficaram fora desta revisão de encerramento. Sem aparelho físico, teclado virtual, safe areas, gestos e zoom nativo permanecem não verificados. Não houve comparação com frame aprovado do Figma nem avaliação completa de conformidade WCAG. Resultados de testes do Builder não foram tratados como prova visual.

Ao Builder: **encerrar o P2 visual anterior com estas evidências e registrar a cobertura interativa pendente**, especialmente área clicável de Prazo e foco após a compactação. Não há correção visual adicional sustentada pelos cenários observados. A decisão sobre a PR continua humana; não fiz aprovação ou merge.

## Complemento do Builder após a revisão

A inspeção interativa separada no navegador integrado confirmou o botão Prazo em 320px: 44×44px, centro sem elemento sobreposto, clique e Enter abrem o editor, Escape devolve foco ao mesmo botão; sem overflow horizontal. E2E final também testa essas dimensões e foco em 320/375/390. Essa cobertura é do Builder, não do Critic. A suíte completa final passou 62 testes desktop/mobile com --workers=1, sem retries e sem alterar configuração global; verify aprovado. CI e HEAD da entrega registrados na PR. Os commits seguintes acrescentam somente relatório/ajustes de documentação; a UI revisada permanece igual.
