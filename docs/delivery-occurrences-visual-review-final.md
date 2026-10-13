Rechecagem independente do HEAD `97c8cddae34c45c27c9d20cd6b990e1adc609629`, branch `codex/delivery-alerts-occurrences`, futura PR da Issue #12. Árvore de trabalho limpa nas verificações inicial e final.

**Nenhum achado novo nos cenários inspecionados.** Os três P2 anteriores apresentam correções sustentadas pelas imagens e pelo código, com os limites abaixo. Isso não constitui aprovação automática da PR.

URL informada: `http://127.0.0.1:3010/preview/operacao?scenario=issues-new`. A tentativa de abrir o navegador integrado retornou **“Browser is not available: iab”**. Não troquei para Chrome nem contornei o bloqueio. Nenhuma interação foi executada.

Li as regras locais e as skills pertinentes. Examinei 17 capturas atuais e as sete capturas preservadas em `before-review`, além dos componentes, CSS e código dos testes. Confirmei diretamente pelos cabeçalhos PNG as dimensões atuais: desktop 1280×800 e 1440×900; mobile 320×844, 375×844 e 390×844. Não usei `metrics.json` como medição independente nem resultados declarados pelo Builder como prova de qualidade visual.

**Situação dos P2 anteriores**

| P2 anterior | Evidência independente atual | Situação |
| --- | --- | --- |
| Aba ativa perde contraste no hover | `center-375.png` e `center-390.png` agora mostram “Pendentes (1)” branco sobre fundo escuro; as demais larguras também mantêm seleção legível. `features/operations/issues.css:45` define explicitamente o hover selecionado com especificidade superior à regra genérica de `operations.css:879`. | Corrigido nas capturas e na regra CSS. Hover interativo não verificado. |
| Próxima entrega perde identificação no mobile | `courier-next-{320,375,390}.png` mostram “PRÓXIMA ENTREGA · 2 NA SEQUÊNCIA ORIGINAL” junto de `#1039`, separado do prazo urgente de `#1040`. `courier-failure-390.png` preserva rótulo e nome completo do pedido com o formulário aberto. | Corrigido nas capturas. `courier-delivery.tsx:24` separa o cabeçalho da área rolável; linha 15 usa `preventScroll`. Comportamento real do foco permanece pendente. |
| Contexto operacional fica recolhido depois das decisões | Capturas da Central mostram o relato antes de “Tentar novamente”. Em `issue-card.tsx:26`, referência, observação e descrição integral precedem o bloco de decisões, sem condição restrita ao motivo OTHER. `issues.css:44` preserva quebras de linha. | Corrigido na estrutura do código; relato antes das ações confirmado visualmente. A captura longa está rolada e não comprova sozinha todo o contexto inicial. |

As comparações anteriores e atuais não têm posição de rolagem idêntica em todos os casos. Portanto, não extraí delas conclusões sobre ganho de densidade.

| Antes | Depois observado | Benefício |
| --- | --- | --- |
| Seleção clara com texto branco ilegível | Seleção escura legível e hover específico | Facilita reconhecer aba e quantidade pendente |
| Pedido atual sem identificação visível | Rótulo e pedido juntos, fora da rolagem interna do conteúdo | Distingue próxima parada do pedido com prazo mais urgente |
| Relato e observações depois das decisões, recolhidos | Contexto integral antes das ações | Sustenta a decisão de tentativa ou retorno |

**Reabertura da Central após visitar Histórico**

A correção está presente em `features/operations/issue-center.tsx:18`: `onClose` restaura a visão `pending`, limpa o erro e, por `switchView` na linha 17, reinicia a paginação. A abertura em `operations.tsx:115` usa `showModal()`.

O código do E2E contém o roteiro solicitado: decidir ocorrência, visitar Histórico, fechar com Escape, simular nova ocorrência, abrir pelo aviso e conferir Pendentes selecionada. **Li esse teste; não o executei nem confirmei seu resultado nesta sessão.**

Assim, a reabertura está sustentada estaticamente, mas permanece sem comprovação interativa independente. O roteiro a repetir é: Central → decidir → Histórico → fechar → nova ocorrência → “Decidir na Central” → conferir seleção, ocorrência exibida e foco.

**Aspectos que resistiram à inspeção**

- Em 320 px, a Central mantém identificação, prazo, motivo, relato e ambas as decisões legíveis, sem sobreposição visível.
- Prazo crítico combina “Decidir em 1 min” com tratamento vermelho em `critical-390.png`; urgência não depende somente de cor.
- `multiple-center-390.png` mantém contagem explícita de três pendências e separação dos cartões. A captura mostra um cartão completo e parte do segundo; não comprova acesso à terceira ocorrência.
- O formulário com nome, endereço e observação longos mantém a identificação do pedido e as ações inferiores visíveis.
- O retorno distingue pedido entregue de pedido a devolver e explica confirmação da chegada e retorno ao final da fila.
- A captura de rotas comunica composição e sequência bloqueadas em ON_ROUTE. O código preserva liberação pela loja e início exclusivo pelo motoboy em PREPARING.
- Rótulos acessíveis, associação do diálogo ao título, abas com `aria-selected`, painel nomeado e navegação por setas estão presentes no código. Isso não equivale a testar teclado ou leitor de tela.
- CSS das ações pertinentes estabelece altura mínima de 44 px; campos novos usam 16 px. Não houve medição interativa dos alvos.
- O aviso mantém movimento curto de 160 ms, apenas `opacity` e `transform`, com tratamento de redução de movimento. Nenhum problema de movimento foi identificado estaticamente; fluidez não foi observada.
- Marca do raio e linguagem visual existentes permanecem nas imagens. Não há frame Figma aprovado para comparar.

Na captura `routes-390.png`, parte do prazo da segunda parada aparece no limite inferior da lista interna. O CSS confirma `max-height:144px` e `overflow-y:auto` em `operations.css:740`. Isso demonstra um recorte de área rolável, **não comprova informação inacessível**; não classifico como defeito sem testar a rolagem.

**Limitações e devolução ao Builder**

Ficam pendentes: hover real; Tab/setas/Escape; foco inicial e retorno de foco; reabertura após Histórico; rolagem completa de textos e múltiplas pendências; decisões retry/return/cancel; expiração ao vivo; erros e recuperação; paginação; loading/vazio; console/network; som; zoom e ausência de overflow além das áreas fotografadas.

Não executei testes, builds ou servidores, nem alterei arquivos ou dados. Os resultados de QA do Builder precisam estar vinculados ao HEAD efetivamente testado. Aparelho físico, teclado virtual, safe areas, gestos e zoom nativo não foram verificados; não declaro conformidade WCAG completa.

Devolvo como prioridade ao Builder **confirmar interativamente a reabertura em Pendentes e o foco/rolagem após as correções**, nos viewports solicitados. Não há novo P0/P1/P2/P3 comprovado nesta rechecagem por imagens e código. Aprovação e merge continuam humanos.
