Revisão independente do candidato **fd1e018387e822a1647ad2261deee5762bda3f1b**, relacionado à [PR #14](https://github.com/henriqueskm/rpmdelivery/pull/14). **Identifiquei um P2 de descoberta da comparação completa.** A apresentação inicial reduz significativamente a leitura necessária para entender o benefício e a contrapartida, mas ainda dificulta encontrar as informações completas em telas menores e sequências extensas.

Identidade da sessão: **`/root/visual_critic_pr14`**, `agent_type: rpmdelivery_visual_critic`. Contexto recebido sem histórico de implementação do Builder. HEAD conferido por Git; árvore de trabalho limpa. Base informada: `133b5782d2726c572ca58d32d5d94173d626f70a`. O candidato local ainda não corresponde ao HEAD remoto informado.

URL disponibilizada: `http://127.0.0.1:3008/preview/operacao?scenario=opt-urgent`. O navegador integrado retornou **“Browser is not available: iab”**. Portanto, esta revisão combina inspeção independente das screenshots fornecidas com leitura focal do código; **não é uma validação interativa**.

Li `AGENTS.md`, `CONVENTIONS.md`, `docs/development-workflow.md`, `docs/visual-critic.md` e as skills `emil-design-eng`, `rpmdelivery-qa`, `mobile-native` e `break-ui`/`CATALOG.md`, aplicando exclusivamente suas orientações de inspeção. Não alterei arquivos ou dados, executei testes, iniciei servidores ou acessei serviços externos.

**Cobertura visual efetiva**

Screenshots identificadas pelo Builder como pertencentes ao candidato, no diretório `docs/screenshots/manual-optimization/decision-ux/`:

| Cenário | Capturas inspecionadas |
| --- | --- |
| Urgente, antes/depois | 1280×800 e 390×844 |
| Urgente, depois | 1440×900, 375×844 e 320×844 |
| Oito paradas, depois | 1280×800 e 390×844 |
| Prazos impossíveis, depois | 390×844 |
| Texto longo/prazo vencido, depois | 320×844 |
| Coordenadas ausentes, depois | 390×844 |
| Comparação detalhada aberta | 1280×800 e 390×844 |

Não usei os JSON de medições nem as conclusões do Builder como evidência independente. Não há frame Figma aprovado; não avaliei fidelidade ao Figma.

**[P2] A comparação completa fica descoberta apenas depois de percorrer toda a sequência**

**Observação comprovada:** na captura `after/urgent-1440.png`, “Ver comparação detalhada” aparece depois das três paradas. Em `after/urgent-1280.png`, `after/urgent-390.png`, `after/urgent-375.png` e `after/urgent-320.png`, esse controle já está fora da área inicial visível. Em `after/eight-1280.png` e `after/eight-390.png`, a área inicial apresenta somente três paradas completas; o código coloca o controle depois de todas as oito.

O topo oferece “Editar hipóteses”, mas nenhuma referência à comparação completa. Nomes dos clientes, endereços, chegadas e retorno estimado estão nesse conteúdo secundário. As capturas `after/urgent-1280-details.png` e `after/urgent-390-details.png` comprovam que essas informações foram preservadas.

**Impacto operacional:** consultar uma identidade completa, a chegada ou o retorno exige percorrer a sequência antes de encontrar a entrada para os detalhes. Isso introduz fricção recorrente na conferência da proposta, especialmente com oito pedidos. O achado é de descoberta e acesso; não há evidência de conteúdo tecnicamente inacessível. A magnitude do efeito sobre tempo de decisão exige observação interativa com operadores.

**Reprodução proposta ao Builder:** abrir a demo urgente, calcular a sugestão e observar a posição inicial em 390×844 ou 1280×800. Procurar a comparação manual completa ou o retorno estimado. Repetir com oito paradas. O controle fica depois da lista, dentro da rolagem interna. Esses passos foram reconstruídos pelas capturas e pelo código, não executados nesta sessão.

**Responsáveis identificados:**

- [optimization-decision.tsx](C:/Users/PICHAU/.codex/worktrees/manual-route-optimization/rpmdelivery/features/operations/optimization-decision.tsx:37): bloco `<details>` colocado depois da sequência.
- [optimization-dialog.tsx](C:/Users/PICHAU/.codex/worktrees/manual-route-optimization/rpmdelivery/features/operations/optimization-dialog.tsx:54): contêiner de rolagem interna.
- [optimization.css](C:/Users/PICHAU/.codex/worktrees/manual-route-optimization/rpmdelivery/features/operations/optimization.css:13): definição da rolagem.

**Recomendação:** disponibilizar uma entrada visível para “Comparação detalhada” perto do resumo das hipóteses ou antes da sequência. Ela pode abrir o conteúdo existente e levar foco/rolagem até ele. Preservar os detalhes completos e o resumo compacto; não reduzir fontes ou esconder alertas.

**Benefício esperado:** o operador sabe desde o início onde conferir informações completas, sem precisar explorar toda a lista.

| Antes observado | Depois recomendado | Benefício |
| --- | --- | --- |
| Entrada para detalhes localizada após todas as paradas; fora da área inicial na maioria das capturas | Entrada visível antes da lista, abrindo e direcionando foco para os detalhes existentes | Facilita conferência de clientes, endereços, chegada e retorno sem aumentar a carga inicial |

**Aspectos que resistiram à inspeção**

- **Decisão inicial mais clara:** o urgente apresenta recomendação, `1 → 0` atrasos, `27 → 27 min`, `8,4 → 8,5 km` e `+100 m`. O custo adicional está explícito, em vez de exigir subtração mental entre relatórios.
- **Zero atrasos não esconde fragilidade:** a margem inferior a um minuto aparece em um alerta destacado e também na parada afetada. A interface informa que uma saída posterior pode provocar atraso.
- **Semântica consistente nas capturas:** ganhos numéricos aparecem em verde; igualdade em neutro; pequena desvantagem e margens apertadas em atenção; atrasos persistentes em vermelho. Texto e símbolos complementam a cor.
- **Prazos impossíveis:** a recomendação comunica redução de sete minutos de atraso total, enquanto o alerta informa que três entregas continuam atrasadas. Não transmite sucesso integral.
- **Mudanças de posição legíveis:** referências, bairros e indicadores `2 → 1`, `1 → 2` ou `4 → 1` permitem localizar alterações sem comparar duas listas completas.
- **Densidade útil no urgente mobile:** em 390×844, o depois mostra três identidades e horários de entrega/limite na área inicial; o antes mostrava uma parada completa e parte da seguinte. Isso acompanha a melhoria de hierarquia, não substitui sua avaliação.
- **320px:** textos longos, unidades e alertas quebram linhas sem sobreposição ou corte lateral visível. A área inicial contém apenas a primeira parada no urgente, mas conserva os fatores decisivos e as duas ações.
- **Ações preservadas visualmente:** “Manter ordem atual” e o CTA coral “Aplicar sequência” permanecem visíveis no rodapé das capturas inspecionadas.
- **Erro de coordenadas ausentes:** informa o impedimento, preserva a montagem manual e apresenta aplicação desabilitada.
- **Detalhes completos preservados:** as capturas abertas mostram nomes, endereços, chegada, entrega, limites, margens e retorno. No desktop há comparação lado a lado; no mobile, empilhamento.

A leitura estática também encontrou rótulos dos campos, nome acessível para fechamento, `aria-expanded` em edição, foco programático no título da recomendação, região de comparação focável e estilos de foco. Esses elementos **não comprovam funcionamento do teclado ou foco no navegador**.

**Limites e cobertura pendente**

Não verifiquei independentemente aplicação/manutenção da ordem, edição e recálculo, invalidação da proposta, Tab/Shift+Tab, Escape, restauração de foco, abertura dos detalhes, rolagem real, console, network ou DOM renderizado. Não houve overrides de viewport para restaurar.

Loading, vazio, seleção múltipla, limites de seleção, rota sem percurso e demais estados não presentes nas capturas inspecionadas ficam pendentes. A lista externa com mil pedidos visível ao fundo não comprova desempenho ou navegação desse volume.

Não medi contraste calculado nem alvos de toque pelo DOM. Não testei aparelho físico, teclado virtual, safe areas, gestos ou zoom nativo. Esta inspeção não estabelece conformidade WCAG completa.

Os resultados de verify, unitários e E2E são relatos do Builder, não testes executados por este revisor. A simulação não valida Mapbox real, trânsito ou garantia de chegada. Também não validei os fluxos PREPARING, ON_ROUTE, RETURNING ou retorno confirmado.

**Devolução ao Builder:** priorizar a descoberta da comparação completa e verificar interativamente foco, teclado e acesso aos detalhes nos mesmos viewports. A carga inicial de leitura melhorou nas imagens inspecionadas; a facilidade de decisão em uso real permanece parcialmente não verificada. Não corrigi o achado e não aprovei automaticamente a PR; a decisão continua humana.