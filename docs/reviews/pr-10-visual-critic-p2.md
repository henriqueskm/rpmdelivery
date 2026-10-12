# Primeira revisão independente — PR #10

Nota de registro do Builder: relatório integral abaixo, referente ao HEAD `b9b22560599e91a7d67e1e09b3d2d119d40cef3a`. As capturas citadas são as [evidências imutáveis daquele commit](https://github.com/henriqueskm/rpmdelivery/tree/b9b22560599e91a7d67e1e09b3d2d119d40cef3a/docs/screenshots/p2-final); as capturas da branch foram posteriormente atualizadas após a correção do endereço. Invocação nativa confirmada pelos metadados: sessão filha `01a12d7a-6831-7e91-9c8c-b33d5acef843`, role `rpmdelivery_visual_critic`, sandbox `read-only`, approval `never`.

---

A revisão das capturas sustenta a resolução visual dos dois P2 anteriores. Há **um P2 adicional comprovado: falta o endereço na conferência da montagem**. A cobertura interativa ficou pendente por bloqueio do navegador; este relatório não aprova a PR.

Sou o agente nativo `rpmdelivery_visual_critic`, conforme `.codex/agents/rpmdelivery-visual-critic.toml`. Sessão de revisão independente: `/root/pr10_independent_visual_review`, iniciada sem o histórico de implementação do Builder. Não recebi um UUID adicional de sessão.

Contexto conferido:

- PR #10, `henriqueskm/rpmdelivery`.
- Branch `feat/restaurant-operations-dashboard`.
- HEAD local confirmado: `b9b22560599e91a7d67e1e09b3d2d119d40cef3a`; árvore limpa antes e depois da revisão.
- URL fornecida: `http://127.0.0.1:3006/preview/operacao?scenario=demo`.
- Inspeção visual das 30 capturas de `docs/screenshots/p2-final/`: `busy`, com 20 selecionados, e `worst`, com 6; desktop 1280×800 e 1440×900, mobile 320×844, 375×844 e 390×844.
- Comparação anterior identificada como HEAD `7fe01d6aaeb326e4d2869e226d06d57d451861ae`; capturas atuais identificadas pelo Builder como HEAD exigido. Não foi possível conferir pelo navegador a versão do servidor.
- Sem frame Figma aprovado. Avaliação baseada na interface existente, marca do raio e requisitos operacionais.

**Situação dos P2 anteriores**

| P2 anterior | Resultado observado | Limite da conclusão |
| --- | --- | --- |
| Observações ausentes na montagem | Resolvido nas capturas. Referência e observação aparecem na sequência. O pedido #1048 mostra integralmente a alergia e a orientação até “Não deixar na recepção sem confirmação.” | Leitura dos itens fora da posição inicial depende de rolagem, não executada nesta sessão. |
| Pouca área útil mobile para muitas paradas | Resolvido visualmente pela opção “Conferir” e pelo diálogo ampliado. Em 390px, `busy` passa de 3 para 7 paradas completas na imagem; em `worst`, de 1 para 5. Em 375px, são 7 e 4 paradas completas no ampliado. | Abertura, fechamento, rolagem e manutenção da seleção não foram testados interativamente. |

As capturas `after-worst-320-expanded.jpg` e `after-worst-390-expanded.jpg` mostram a referência e a alergia completas, sem reticências. Em 320px, o modo compacto deixa os controles da primeira parada abaixo do limite visível; o ampliado oferece espaço para revisar esse item e os seguintes. Não recomendo remover observações nem reduzir a fonte para recuperar contagens.

As alturas dos JSON são coerentes com os limites visuais gerais: aproximadamente 523–559px de lista ampliada mobile, contra 242–276px no compacto atual. **Não adotei as contagens brutas como prova exata:** `after-busy-320-expanded.jpg` mostra cinco paradas com conteúdo e controles visíveis, embora o JSON registre quatro; em 1440px, a 11ª parada também parece completa junto ao limite inferior, enquanto o JSON registra dez. Esses desvios não invalidam o ganho de área, mas pedem revisar o critério de `completeStops`. O campo `notes` também não demonstra quantas observações estão efetivamente visíveis.

**[P2] Endereço ausente na conferência antes da atribuição**

A montagem exibe código, cliente, bairro, complemento e observações, mas omite rua e número. No cenário `busy`, várias paradas alternam apenas entre “Centro” e “Vila Mariana”; no `worst`, #1048 mostra bloco/apartamento e orientações de entrada sem mostrar a avenida do destino. Isso dificulta conferir a sequência por localização e detectar um destino errado antes da atribuição.

- **Evidência visual:** `docs/screenshots/p2-final/after-worst-1280-expanded.jpg`, primeira parada; `after-busy-390-expanded.jpg`, paradas 1–7. O endereço não aparece em nenhum desses modos.
- **Evidência estática:** `features/operations/builder-panel.tsx:145` renderiza identificação e `:148` apenas `o.neighborhood`; `:150` e `:155` acrescentam complemento e notas. Não há `o.address` na montagem. A lista inicial também mostra apenas bairro em `features/operations/orders-panel.tsx:135`. O endereço existe na visão do motoboy em `features/operations/dialogs.tsx:193`.
- **Viewports/cenários:** observado nas capturas de ambos os cenários, nos cinco tamanhos.
- **Passos para reproduzir:** selecionar os pedidos de `worst` ou os primeiros 20 de `busy`; abrir Montagem; usar “Conferir”; procurar rua e número de cada parada. Esses são passos derivados das capturas e do componente, não uma interação executada pelo revisor.
- **Recomendação:** disponibilizar rua e número na conferência ampliada, junto do bairro e antes do complemento. Se o compacto precisar permanecer resumido, manter uma indicação clara de acesso ao destino completo.
- **Benefício esperado:** conferir agrupamento e sequência antes de reservar o motoboy, com menos consulta externa e menor chance de atribuição equivocada.

| Antes | Depois recomendado | Benefício |
| --- | --- | --- |
| Conferência mostra bairro e complemento, sem rua/número | Mostrar endereço completo por parada no ampliado, preservando referência e observação integrais | Permitir validar o destino e a ordem antes de atribuir |

Não encontrei outro defeito operacional comprovado nas capturas inspecionadas. O nome longo do motoboy fica cortado no seletor fechado mobile, mas não posso declarar informação inacessível sem abrir o seletor e conferir suas opções.

**Aspectos que resistiram à inspeção**

- Códigos longos e nomes extensos quebram linha dentro do painel; não observei texto escapando horizontalmente nas imagens atuais.
- Referências e observações mantêm hierarquia distinta e leitura integral no caso longo.
- `<b>Sem talheres</b>` aparece como texto literal, coerente com o dado fictício.
- Ações de atribuição e seletor permanecem visíveis nos modos compacto e ampliado.
- Controles mobile de mover/remover e fechar têm regras de 44×44px no CSS, coerentes com as imagens. Isso é verificação estática/visual, sem teste de toque.
- A leitura do modelo preserva atribuição como `PREPARING`, reserva, edição antes do início, início pelo motoboy correspondente, bloqueio após saída e retorno confirmado antes de voltar à fila. Não identifiquei nesta leitura uma alteração dessas regras; não as validei em execução.

**Cobertura pendente**

O `iab` informou indisponibilidade. A abertura no Chrome foi rejeitada pela política de acesso, com motivo informado de permissão recusada pelo usuário. Não tentei contornar o bloqueio.

Portanto, ficaram **não verificados nesta sessão**: foco inicial e retorno do foco, Escape, navegação por teclado, reordenação efetiva, remoção, filtros, seleção entre páginas, opções do seletor, atribuição e edição em execução, rolagem até a última parada, estados `demo`, vazio e pedido único renderizados, formulários/erros/carregamento, console e network. O código contém mecanismos de foco e diálogo nativo, mas sua presença não substitui o teste.

Não houve aparelho físico: teclado virtual, safe areas, gestos e zoom nativo permanecem pendentes. Também não há conclusão de conformidade WCAG completa. Os resultados de verify e testes informados pelo Builder não foram executados nem usados como comprovação visual por este revisor.

Devolvo ao Builder como prioridade **incluir o endereço na conferência antes da atribuição** e completar a cobertura interativa indicada no mesmo HEAD. Os dois P2 anteriores estão resolvidos no material visual observado, sujeitos à confirmação funcional. Nenhum arquivo foi alterado; não houve commit, publicação ou merge. A decisão da PR continua humana.
