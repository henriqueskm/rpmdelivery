Relatório integral do subagente nativo `rpmdelivery_visual_critic`, executado em sessão independente, sem histórico do Builder e sem overrides de modelo/esforço:

---

Revisão independente do candidato `0e5fe184d608eb941cb20766035bab697e8d0de1`, branch `codex/delivery-alerts-occurrences`, base `3face6d07082a5e977ab2cce1a23383983a02aa5`, futura PR da Issue #12. Árvore de trabalho limpa no momento da inspeção.

A revisão encontrou três pontos P2. Nenhum P0/P1 foi observado nas evidências disponíveis. Isso não constitui aprovação da PR.

**Método e cobertura:** inspeção visual das 34 capturas versionadas em `docs/screenshots/delivery-occurrences/`, acompanhada de leitura dos componentes e CSS. Dimensões das imagens: 1280×800, 1440×900, 320×844, 375×844 e 390×844. Foram examinados aviso, Central, múltiplas ocorrências, urgência, histórico após prazo, textos longos, rotas, próxima entrega, formulário de falha, retorno, montagem com 1.000 pedidos, vazio e um pedido.

URL informada: `http://127.0.0.1:3010/preview/operacao?scenario=issues-new`. O IAB estava indisponível. O acesso pelo Chrome foi rejeitado pela política do navegador por permissão negada; não houve tentativa de contorno. Portanto, **nenhuma interação foi executada por este revisor**. Os passos abaixo são roteiros para reprodução pelo Builder, não testes interativos meus. Não utilizei `metrics.json` como medição independente.

**[P2] Aba ativa perde legibilidade em estado de hover**

- **Observação:** em `center-375.png` e `center-390.png`, “Pendentes (1)” aparece branco sobre fundo muito claro. Nas capturas 320/1280/1440, a mesma aba aparece com fundo escuro e texto legível.
- **Impacto:** dificulta reconhecer a aba selecionada e ler a quantidade de pendências.
- **Evidência estática:** `features/operations/issues.css:26` define fundo escuro e texto branco para `[aria-selected=true]`; `features/operations/operations.css:879` aplica fundo claro ao hover de qualquer botão habilitado, com maior especificidade. Essa colisão explica o estado observado, embora o hover não tenha sido reproduzido interativamente.
- **Reprodução:** abrir a Central em 375×844 ou 390×844 e posicionar o ponteiro sobre “Pendentes”.
- **Recomendação:** definir explicitamente o hover da aba selecionada ou restringir a regra genérica. Manter contraste legível e seleção reconhecível em todos os estados.

**[P2] Próxima entrega perde o rótulo que a distingue do prazo mais urgente**

- **Observação:** em `courier-next-320.png`, `courier-next-375.png` e `courier-next-390.png`, o cabeçalho mostra “Prazo mais urgente · #1040”, seguido do pedido `#1039`, mas o rótulo “PRÓXIMA ENTREGA” não aparece. Ele está visível nas capturas desktop. Em `courier-failure-390.png`, o início do título do pedido também aparece parcialmente cortado pelo limite superior da área rolável.
- **Impacto:** cria ambiguidade entre o pedido destacado pelo prazo e aquele ao qual se aplicam “Entregue” e “Não consegui entregar”.
- **Responsáveis:** `features/operations/courier-delivery.tsx:15` move o foco para o título; o rótulo está antes dele, na linha 25. A área tem rolagem própria em `features/operations/issues.css:38`.
- **Hipótese a verificar:** o `focus()` automático pode deslocar a área rolável, deixando o rótulo anterior fora de vista. Não confirmei essa causa no navegador.
- **Reprodução:** registrar falha no `#1040`, abrir a próxima entrega `#1039` em 320/375/390×844; depois abrir o formulário de falha com nomes longos.
- **Recomendação:** preservar a identificação “Próxima entrega” junto ao título e controlar o deslocamento ao mover o foco, mantendo o foco acessível. A informação deve continuar visível mesmo quando o prazo mais urgente pertence a outro pedido.

**[P2] Informações essenciais ficam recolhidas abaixo das decisões**

- **Observação estática comprovada:** em `features/operations/issue-card.tsx:27`, as decisões são apresentadas antes de `details`, fechado por padrão na linha 33. Observações do pedido aparecem somente na linha 35; o relato completo, na linha 36. O resumo do relato aparece apenas para motivo `OTHER` e é limitado a 160 caracteres na linha 25. Para outros motivos, um complemento preenchido pelo motoboy fica inteiramente recolhido.
- **Impacto:** a loja pode liberar nova tentativa sem ver instruções de acesso, restrições ou o complemento que explica a falha. A existência de informação adicional também não é indicada no resumo.
- **Evidência visual complementar:** `long-details-390.png` mostra as decisões antes do bloco expandido de destino e relato; `courier-failure-390.png` contém uma observação operacional de alergia e confirmação de entrega. A ocultação na Central é demonstrada pelo código, não por uma captura específica da Central desse mesmo pedido.
- **Reprodução:** usar ocorrência com observação e complemento do motivo; abrir a Central sem expandir “Detalhes e histórico”.
- **Recomendação:** apresentar observações operacionais e o relato integral antes das decisões, com quebra de linhas e rolagem. Manter histórico e metadados secundários no bloco recolhível. Não aumentar densidade truncando essas informações.

| Antes | Depois | Benefício |
|---|---|---|
| Hover clareia o fundo da aba ativa, mantendo texto branco | Estado selecionado mantém contraste no hover | Leitura confiável da seleção e contagem |
| Rótulo da próxima entrega sai da área visível | Identificação permanece junto ao pedido e foco não a oculta | Reduz ambiguidade entre pedido atual e prazo urgente |
| Observações e relato completo ficam após decisões, recolhidos | Informações operacionais aparecem integralmente antes das decisões | Dá contexto para decidir tentativa ou retorno |

**Aspectos que resistiram à inspeção visual e estática:**

- Aviso identifica pedido, rota, motoboy, motivo e prazo, com ações claras; o texto explica que fechar mantém as pendências.
- Central mantém identificação e decisões legíveis em 320 px, com nomes longos quebrando linhas.
- Urgência combina texto de prazo com mudança de cor; não depende somente da cor.
- Múltiplas ocorrências mantêm contagem explícita. O código ordena pendências por prazo de decisão, depois registro.
- Captura de retorno distingue pedido entregue de pedido a devolver, orienta chegada e informa retorno ao final da fila.
- PREPARING apresenta liberação pela loja e início exclusivo pelo motoboy; ON_ROUTE comunica composição e sequência bloqueadas.
- Ações principais da Central e do motoboy têm `min-height:44px` no CSS; campos novos usam 16 px. Isso é evidência estática, não medição de toque.
- Movimento do aviso usa somente `opacity` e `transform`, 160 ms, curva `cubic-bezier(.23,1,.32,1)` e redução de movimento em `issues.css:47`. Nenhum achado de movimento nessa inspeção estática; fluidez e comportamento real da preferência permanecem não verificados.
- Marca do raio e linguagem visual existentes foram preservadas nas capturas. Não houve comparação com Figma, pois não há frame aprovado disponível.

**Cobertura pendente:** foco real, Tab/setas/Escape, retorno de foco após decisões, rolagem até o fim de relatos longos e terceira pendência, decisões retry/return/cancel, fechamento sem resolução, expiração ao vivo, erros de formulário, paginação da Central, console/network, zoom e fontes carregadas. As capturas não comprovam ausência de overflow fora da área fotografada. Não executei testes, builds ou servidores; resultados de validação do Builder devem ser vinculados ao HEAD correspondente.

Aparelho físico, teclado virtual, safe areas, gestos, zoom nativo e qualidade acústica não foram testados. Esta inspeção básica não declara conformidade WCAG completa.

Devolvo ao Builder como prioridades: corrigir contraste da aba ativa, preservar a identificação da próxima entrega e expor o contexto operacional antes das decisões. Nenhum arquivo foi alterado; aprovação e merge continuam humanos.