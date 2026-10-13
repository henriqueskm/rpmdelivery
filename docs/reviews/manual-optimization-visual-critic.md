# Visual Critic — primeira revisão independente

Candidato inspecionado: c00a41c2dee9e61298e86294f391a548ec9312cb. Coordenador 01a131db-f87d-7112-9213-5696ffe155c8; sessão nativa 01a131dc-41d8-7060-abeb-5786c863a964, role rpmdelivery_visual_critic, path /root/manual_optimization_visual_critic. Proveniência conferida nos metadados do rollout: sandbox read-only, approval never. Não herdou a implementação do Builder.

As imagens citadas abaixo estão no [candidato imutável](https://github.com/henriqueskm/rpmdelivery/tree/c00a41c2dee9e61298e86294f391a548ec9312cb/docs/screenshots/manual-optimization). Relatório retornado em texto pelo agente; salvo pelo Builder. A indisponibilidade do navegador na sessão do Critic limita a revisão a imagens/código, conforme detalhado.

---
Revisão independente concluída na sessão `/root/manual_optimization_visual_critic`, custom agent `rpmdelivery_visual_critic`. Identifiquei **um achado P2 de comparação mobile**. Não observei bloqueios P0/P1 nas capturas inspecionadas.

Contexto: branch `codex/manual-route-optimization`, HEAD conferido por Git `c00a41c2dee9e61298e86294f391a548ec9312cb`; nenhuma PR aberta. URL fornecida: `http://127.0.0.1:3008/preview/operacao?scenario=opt-urgent`. Git status sem alterações. Li as instruções do projeto e as skills `emil-design-eng`, `mobile-native`, `break-ui`/CATALOG e `rpmdelivery-qa`, aplicando somente inspeção.

O navegador integrado retornou **“Browser is not available: iab”**. Portanto, esta revisão combina inspeção visual das screenshots fornecidas com leitura dos componentes. Não executei interação nem testes. As métricas de `observations.json` são evidências fornecidas pelo Builder, identificadas como tais; as conclusões abaixo derivam também das imagens observadas.

**[P2] A comparação mobile apresenta a ordem manual e esconde inteiramente a sugestão na primeira tela**

Nas capturas `urgent-390.png` e `urgent-375.png`, a ação ativa “Aplicar sequência (demo)” permanece visível, enquanto nem o título, nem as métricas, nem qualquer parada da ordem sugerida aparecem. A tela exibe a ordem manual antes da proposta que o operador está prestes a aplicar. Isso exige rolagem e memorização dos valores para comparar e aumenta a chance de uma confirmação sem examinar a sequência proposta.

Em 390×844, o bloco superior de título, aviso e controles ocupa aproximadamente 325px; o veredito começa em y≈340. A ordem manual começa em y≈394, e o conteúdo rolável termina em y≈739. Em 375×844, a situação é equivalente. As métricas fornecidas registram duas paradas manuais completas e zero sugeridas nesses dois viewports. Em `long-320.png`, 320×844, nem a primeira parada manual cabe inteira; zero paradas completas de cada ordem são registradas. As ações continuam dentro da tela, com alturas fornecidas de aproximadamente 59px e 79px respectivamente.

Reprodução para o Builder: abrir `opt-urgent`, selecionar os três pedidos, abrir “Sugerir sequência”, calcular mantendo saída 15:05 e atendimento 2min, observar a posição inicial da comparação em 390×844 e 375×844. Repetir com `worst` em 320×844. Esses passos descrevem os estados capturados; não foram executados por mim.

Responsáveis identificáveis: `features/operations/optimization-dialog.tsx:59` renderiza toda a ordem manual antes da sugerida; `features/operations/optimization.css:24` empilha as duas seções; `features/operations/optimization.css:5` mantém os controles superiores fora da área rolável.

Recomendação: exibir um resumo comparativo compacto de ambas as ordens antes das listas completas no mobile, incluindo atrasos previstos, atraso total, duração e distância; oferecer acesso explícito aos detalhes de cada ordem e tornar a lista sugerida imediatamente encontrável. Preservar nomes, endereços, limites e alertas completos nos detalhes. Não reduzir fontes nem truncar informação decisiva para acomodar contagens.

| Antes | Depois recomendado | Benefício |
| --- | --- | --- |
| Lista manual inteira precede qualquer informação da ordem sugerida no mobile | Resumo de ambas as ordens visível antes das listas, com acesso explícito à sugestão e aos detalhes | Comparar o resultado antes de aplicar, com menos rolagem e esforço de memória |
| Controles de cálculo ocupam grande parte da altura durante a avaliação | Após calcular, oferecer organização compacta das hipóteses com ação clara para editá-las | Recuperar área útil para a decisão, mantendo saída e atendimento consultáveis |

Aspectos que resistiram à inspeção visual:

- Em 1280×800 e 1440×900, o cenário urgente mostra as três paradas completas de ambas as ordens e as ações. O benefício aparece nos valores: um atraso de 2min passa a zero, com distância de 8,4km para 8,5km.
- A demonstração está explicitamente identificada na página, no diálogo e nas ações. O aviso distingue matriz simulada, ausência de trânsito e ausência de garantia de prazo.
- `impossible-1280.png` e `tight-1440.png` apresentam aviso de inviabilidade e atrasos por parada. A UI não sugere que a otimização resolveu todos os prazos.
- `short-1440.png` informa que a ordem manual já é a melhor; a aplicação aparece desabilitada.
- `near-1440.png` permite ver a redução pequena de distância e as mudanças de margem individual.
- `peak-eight-1280.png` mantém resumos e ações visíveis enquanto as listas maiores excedem a área útil. A captura mostra três paradas completas por coluna.
- `peak-limit-390.png`, `missing-390.png`, `no-route-390.png` e `unavailable-390.png` mostram explicações legíveis e aplicação desabilitada. O limite de oito não comunica descarte automático de pedidos.
- As imagens mobile inspecionadas não mostram overflow horizontal ou sobreposição das ações. Os textos longos quebram dentro da largura.
- A montagem capturada mostra “Em preparação”, observações dos pedidos e a mensagem “Loja libera a retirada; só ele inicia”, preservando a distinção operacional na apresentação.

Cobertura pendente: seleção, aplicação/descarte, invalidação após mudar atendimento, foco/Tab/Escape, rolagem até a sugestão e recuperação dos erros **não foram testados interativamente**. O código contém invalidação e bloqueio fora de `PREPARING`, mas isso não comprova o fluxo renderizado. Console e network não foram verificados; os arrays vazios do JSON fornecido não equivalem a captura independente. Não houve teste de loading, vazio, zoom 200%, dispositivo físico, teclado virtual, safe areas ou gestos. Não há frame Figma aprovado, portanto não declaro fidelidade ao Figma nem conformidade WCAG completa.

Devolvo ao Builder como prioridade o **P2 de comparação mobile** e a validação interativa pendente. Não alterei arquivos nem aprovei a PR; a decisão continua humana.
