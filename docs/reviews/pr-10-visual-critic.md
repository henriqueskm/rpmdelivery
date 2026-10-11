# Teste independente do Visual Critic — PR #10

Relatório devolvido pelo custom subagent nativo `rpmdelivery_visual_critic`, sessão filha `01a12d44-ba68-7f80-9812-37a7cf47f8ec`. O coordenador preservou as conclusões e converteu links locais em links permanentes do HEAD revisado. Não houve correções na PR #10.

Revisão independente da PR #10, HEAD `7fe01d6aaeb326e4d2869e226d06d57d451861ae`, confirmado por Git; árvore limpa. URL informada: `http://127.0.0.1:3006/preview/operacao?scenario=demo`.

Inspecionei visualmente as quatro capturas fornecidas do cenário **Pico · 1.000 pedidos**, com **20 selecionados**, DPR 1 e rolagem inicial: desktop 1280×800/1440×900 e mobile 390×844, abas Pedidos e Montagem. Não há frame Figma aprovado.

**[P2] A observação do pedido desaparece na montagem**

- **Observação:** em `after-390-orders.jpg`, o pedido #2000 apresenta “Conferir referência na entrega”. Em `after-390-builder.jpg`, a primeira parada mostra somente código, cliente e bairro. O mesmo desaparecimento ocorre nas capturas desktop.
- **Impacto:** na conferência imediatamente anterior à atribuição, o operador precisa voltar à lista para consultar uma instrução relevante. No mobile, isso exige trocar de aba.
- **Evidência:** regiões da primeira linha das quatro imagens; [builder-panel.tsx](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/features/operations/builder-panel.tsx#L67) renderiza referência, cliente e bairro, sem `o.notes`. A lista renderiza a observação em [orders-panel.tsx](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/features/operations/orders-panel.tsx#L136).
- **Reprodução:** selecionar cenário `busy`, selecionar os 20 pedidos da primeira página e abrir Montagem; comparar #2000 com Pedidos.
- **Recomendação:** apresentar a observação integral nas paradas que a possuem, preservando a leitura do alerta antes de atribuir. Não truncar instruções essenciais.

**[P2] A montagem mobile oferece pouca área para conferir uma rota de 20 paradas**

- **Observação:** em `after-390-builder.jpg`, o painel começa aproximadamente em y=350; a sequência ocupa aproximadamente y=434–669. Somente **três paradas completas** aparecem. Os três controles de 44px, com espaçamentos, ocupam cerca de 138px horizontais; mesmo o nome demonstrativo quebra em duas linhas.
- **Impacto:** revisar e ordenar 20 entregas exige percorrer uma janela pequena, dificultando comparar paradas próximas. Não observei bloqueio da ação.
- **Evidência:** captura 390×844, região central da montagem. Responsáveis: [operations.css](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/features/operations/operations.css#L829), regra que mantém conteúdo e controles na mesma linha; [operations.css](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/features/operations/operations.css#L884), altura mobile do painel; e [operations.css](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/features/operations/operations.css#L944), apresentação vertical do banner demonstrativo.
- **Reprodução:** cenário `busy`, 20 selecionados, viewport 390×844, Montagem, rolagem inicial.
- **Recomendação:** recuperar espaço vertical acima do painel com uma apresentação mais compacta do cabeçalho e dos controles demonstrativos; estudar a distribuição dos controles da parada para ampliar a área de identificação. Preservar alvos de 44px, fontes legíveis e ações de atribuição visíveis. Validar o resultado com os mesmos dados e também textos longos.

| Antes | Depois recomendado | Benefício |
| --- | --- | --- |
| Observação disponível apenas em Pedidos | Observação integral também na parada da montagem | Conferência das instruções no momento da atribuição |
| Três paradas completas no mobile, identificação dividindo espaço com três botões | Mais área útil para sequência e identificação, mantendo controles de 44px | Menos rolagem e melhor comparação entre entregas |

Aspectos que resistiram à inspeção das capturas:

- Código, cliente, bairro e espera permanecem legíveis na lista; o alerta #2000 está integral.
- Seleção tem checkbox, fundo e marca lateral, sem depender somente da cor.
- Atribuição e seletor de motoboy permanecem visíveis nas três dimensões capturadas.
- A interface explicita preparação, reserva e início exclusivo pelo motoboy.
- Desktop 1440×900 mostra oito pedidos completos e sete paradas completas; 1280×800 mostra seis pedidos e quatro paradas completos.
- Não observei sobreposição de ações ou conteúdo escapando horizontalmente nas quatro imagens.
- O código prevê alvos mobile de 44px para botões e filtros; isso não foi medido em DOM.

**Limites:** o navegador integrado retornou `Browser is not available: iab`. Portanto, esta é uma revisão de screenshots e código, sem comprovação interativa de foco, teclado, Escape, filtros, seleção, atribuição, rolagem, console ou network. Não inspecionei 375px/320px, estados vazio/erro/loading/textos longos, demais fluxos operacionais ou aparelho físico. Teclado virtual, safe areas, gestos e zoom nativo permanecem pendentes. Não recebi resultados de testes identificados pelo HEAD; não executei testes nem alterei arquivos.

Devolvo ao Builder os dois P2 para avaliação e uma nova inspeção nos mesmos cenários após ajustes. Não identifiquei P0/P1 nas capturas inspecionadas; a aprovação da PR continua humana.

## Evidências e nota de medição

As quatro capturas renderizadas do HEAD revisado podem ser consultadas no [diretório de evidências da PR #10](https://github.com/henriqueskm/rpmdelivery/tree/7fe01d6aaeb326e4d2869e226d06d57d451861ae/docs/screenshots/density). O revisor não realizou a captura nem uma nova navegação interativa.

A contagem visual de quatro paradas em 1280×800 mencionada entre os aspectos que resistiram diverge da [medição DOM registrada nesse HEAD](https://github.com/henriqueskm/rpmdelivery/blob/7fe01d6aaeb326e4d2869e226d06d57d451861ae/docs/screenshots/density/after-measurements.json): três linhas inteiras, incluindo o limite inferior da linha e controles. Para capacidade quantitativa, use a medição DOM (3), não a estimativa visual (4). Os dois achados P2 não dependem dessa divergência. Isso ilustra por que o relatório independente explicita evidências e limitações e não substitui testes objetivos ou aprovação humana.
