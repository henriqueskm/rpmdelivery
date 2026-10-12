# Revisão independente — prazos e retirada

Relatório original do Critic nativo, salvo pelo Builder sem mudar suas conclusões. Revisou o candidato `27e9b0876bd0811cdb086f5b02dc88cd76badd4c`, antes do refinamento mobile posterior. Todas as imagens citadas nesta seção pertencem a [esse commit imutável](https://github.com/henriqueskm/rpmdelivery/tree/27e9b0876bd0811cdb086f5b02dc88cd76badd4c/docs/screenshots/deadlines-pickup), não às capturas atualizadas depois.

Descoberta confirmada pelo registro do runtime: coordenador `01a13098-cc1d-7571-8a43-1599a5267012`, filho `01a13099-8d50-73c0-8ea0-ae7dd3080453`, `agent_role=rpmdelivery_visual_critic`, `agent_path=/root/visual_review`, sandbox read-only e approval never. O agente não escreveu arquivos nem corrigiu achados. O Builder fez QA interativo em outra sessão; o Critic declarou fallback para imagens.

Revisão independente concluída com **um achado P2 de densidade mobile**. Não observei P0/P1 nas capturas analisadas. A inspeção interativa ficou indisponível; esta conclusão não aprova a PR.

**Identidade e contexto.** Agente `/root/visual_review`, invocado com o tipo nativo `rpmdelivery_visual_critic`. Recebi as instruções desse papel e li `.codex/agents/rpmdelivery-visual-critic.toml`, que declara o mesmo nome, `sandbox_mode = "read-only"` e `approval_policy = "never"`. Posso comprovar o papel recebido e a configuração lida; não inspecionei o mecanismo interno de descoberta do runtime.

Conferi diretamente `git rev-parse HEAD`: `27e9b0876bd0811cdb086f5b02dc88cd76badd4c`. `git status --short` não retornou alterações. Branch informada pelo coordenador: `codex/delivery-deadlines-pickup`; PR ainda não aberta. Escopo: prazos prometidos e liberação conjunta de retirada no protótipo operacional.

Li `AGENTS.md`, `CONVENTIONS.md`, `docs/development-workflow.md` e as skills emil-design-eng, mobile-native, break-ui/CATALOG e rpmdelivery-qa. Apliquei somente suas etapas de leitura e inspeção. Não há frame Figma aprovado disponível; considerei a identidade atual com o raio.

**Evidência e cobertura.** Tentei abrir `http://127.0.0.1:3007/preview/operacao?scenario=demo` no navegador integrado. A ferramenta retornou **“Browser is not available: iab”**. Não tentei Chrome, navegador externo ou contorno.

Analisei por `view_image` as capturas existentes em `docs/screenshots/deadlines-pickup`, sem criar arquivos:

- Antes/depois de pedidos e montagem em 320×844, 375×844 e 390×844.
- Antes/depois desktop em 1280×800 e 1440×900.
- Motoboy aguardando em desktop e nas três larguras mobile; pronto para retirada nas três larguras mobile; ON_ROUTE em 390px.
- Textos longos em pedidos em 1280/320/375/390px e motoboy em 320/390px.
- Conferência, vazio, um pedido, novo pedido e prazo padrão em 390px; editor de prazo em 320/390px.

A identificação das capturas como antes de `origin/main`/PR #10 e depois do HEAD candidato, DPR 1 e relógio congelado em 12/10/2026 às 15:00, foi **fornecida pelo coordenador**. Conferi o HEAD do checkout; não há metadado visual nas imagens que prove isoladamente seu commit de origem.

`measurements.json` foi lido como **medição DOM fornecida**, não como medição independente. O cenário `demo` foi lido nas fixtures, mas não teve resultado renderizado inspecionado: as capturas de alto volume mostram `busy`.

**[P2] A coluna da ação “Prazo” reduz a área de leitura e a densidade em mobile.**

Em `after-375-orders.jpg` e `after-390-orders.jpg`, a lista mostra quatro pedidos completos antes do rodapé, enquanto as respectivas imagens `before-*` mostram cinco, com o mesmo cenário de 1.000 pedidos, 20 selecionados e posição inicial. A medição fornecida confirma **5 → 4 pedidos completos em uma área de 287,42px**, perda de 20% na quantidade simultaneamente visível. O acréscimo do prazo é útil, mas o custo aumenta a rolagem durante seleção e conferência repetitivas.

O código confirma que a ação reserva uma coluna de 44px atravessando as três linhas do pedido. Observações e barra ficam restritas à coluna central mesmo abaixo da identidade. Em `after-320-worst-orders.jpg`, isso é particularmente visível na observação de alergia e instruções de entrega: há espaço ao lado da nota ocupado pela coluna da ação.

- **Evidência:** `before-375-orders.jpg` / `after-375-orders.jpg`, `before-390-orders.jpg` / `after-390-orders.jpg`, `after-320-worst-orders.jpg`; `measurements.json`, entradas `orders`.
- **Reprodução para o Builder:** abrir `?scenario=busy`, usar 375×844 ou 390×844, selecionar os 20 pedidos visíveis e manter a lista no início. Comparar com a referência anterior nas mesmas condições. Para observar o estreitamento da nota, usar `?scenario=worst` em 320×844.
- **Responsável identificado:** `features/operations/operations-deadlines.css:16` define as colunas; linha 30 faz a ação atravessar três linhas; linhas 33 e 34 restringem observação e prazo à coluna 2.
- **Recomendação:** manter “Prazo” com alvo de pelo menos 44px, mas reposicionar sua reserva junto da identidade e permitir que as linhas seguintes aproveitem a largura disponível. Recomparar as contagens sem reduzir fontes, truncar alertas ou ocultar observações.
- **Benefício esperado:** menos quebras de linha e maior área útil para informações essenciais. A recuperação exata de cinco linhas exige validação renderizada após o ajuste; não está comprovada antecipadamente.

| Antes | Depois recomendado | Benefício |
| --- | --- | --- |
| Ação “Prazo” reserva 44px ao longo da identidade, observação e barra | Reserva da ação concentrada junto da identidade; linhas seguintes aproveitam a largura disponível | Reduz quebras e rolagem, preservando alvo de toque e conteúdo integral |

**Aspectos que resistiram à inspeção das imagens.**

Os prazos aparecem abaixo das informações dos pedidos. A barra, o texto de tempo e o limite ficam associados visualmente; o estado não depende somente da cor. As capturas mostram verde para tempo folgado, laranja com “Próximo · 8m” e vermelho com “Vencido”. O vencimento do dia anterior traz `Até 11/10, 18:36`; no mobile, o atraso ocupa uma linha anterior, sem esconder o limite.

Nas capturas de textos longos, nome, bairro, referência extensa, complemento e instruções de alergia permanecem legíveis com quebra de linha. A visão do motoboy em 390px mostra a nota extensa integralmente e o prazo correspondente. Não observei ações sobrepostas nem conteúdo escapando horizontalmente nas regiões capturadas.

Em desktop, a comparação e a medição fornecida mantêm seis pedidos completos em 1280×800 e oito em 1440×900. A montagem mantém ações de atribuição acessíveis; a conferência em 390px amplia a área de leitura para a composição de 20 paradas, embora apenas as primeiras estejam visíveis na captura.

As imagens do motoboy distinguem “Aguardando liberação” de “Pronto para retirada”, mantendo “Em preparação” nos dois estados. O botão de início aparece desabilitado no primeiro e ativo no segundo. Em ON_ROUTE, aparece a mensagem de composição e sequência bloqueadas. O aviso de simulação, ausência de autenticação real, tracking e notificações é visível.

Vazio e um pedido têm apresentação coerente. Os editores separam horário original e prazo prometido; o prazo padrão explica que vale somente para novos pedidos.

**Comportamentos confirmados apenas por leitura do código.**

O reducer em memória mantém PREPARING/reserva após atribuição, libera o conjunto completo sem iniciar a rota e exige o motoboy atribuído para o início. Alteração do conjunto invalida a liberação; reordenação do mesmo conjunto a preserva. Edição de composição exige PREPARING. Retorno confirmado recoloca o motoboy no final da fila.

`deadlines.ts` calcula o limite a partir do horário original mais o prazo, usa verde acima de 10 minutos, laranja entre mais de 5 e 10 minutos e vermelho em até 5 minutos ou vencido. O relógio é compartilhado por `useOperationsClock`. Não há reordenação automática por urgência na leitura realizada.

Esses pontos **não equivalem a fluxos executados** nem comprovam autorização ou segurança de backend futuro.

**Limitações e cobertura pendente.**

Não executei interação, teclado, Escape, retorno de foco, seleção/filtros, paginação, validação de formulário ou rolagem até a vigésima parada. Não capturei console, network ou erros de runtime. Não houve teste de atualização temporal ou da transição visual em exatamente 10/5 minutos. Loading, erros e recuperação não foram observados renderizados.

Os alvos “Prazo” e prazo padrão têm mínimo de 44px declarado no CSS; isso não constitui medição independente de todos os controles. A inspeção de contraste foi visual, sem cálculo instrumental ou declaração de conformidade WCAG.

Não foram fornecidos resultados de verify, unitários ou E2E associados ao HEAD; permanecem não verificados. Não executei testes, build, instalação ou qualquer comando de escrita. Não acessei dados reais, Supabase ou produção.

Sem aparelho físico, teclado virtual, safe areas, gestos, zoom nativo e comportamento com barras do navegador permanecem não testados. Não alterei viewport de navegador disponível, portanto não houve override a restaurar.

Devolvo ao Builder como prioridade o **P2 de distribuição da coluna “Prazo” no mobile** e a validação interativa pendente do fluxo de liberação/início, edição e retorno. Nenhuma correção, aprovação, publicação ou merge foi realizado.
