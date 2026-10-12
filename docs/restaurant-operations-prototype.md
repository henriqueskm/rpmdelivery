# Central operacional — protótipo

O dashboard protegido agora mostra uma central de despacho com dados fictícios.
O carregamento da sessão, a resolução do restaurante e o logout continuam usando
o fluxo existente. Nenhuma ação operacional consulta ou escreve no Supabase.
O estado da demonstração é descartado ao recarregar ou trocar o restaurante.

## Experimentar

Execute `npm ci` e `npm run dev -- --port 3006`. Abra a URL `Local` anunciada
pelo Next.js e acrescente `/preview/operacao`.
Esse preview público contém exclusivamente fixtures; não consulta sessão,
restaurante ou dados reais e tem metadata `noindex`.
O seletor de cenários existe apenas nessa rota de protótipo.
`?scenario=worst`, `empty`, `one` e `busy` preservam a escolha ao recarregar,
mas não preservam cadastros, seleções ou rotas criadas.

1. Cadastre um pedido com nome, WhatsApp fictício, endereço e bairro.
   Referência, complemento e observações são opcionais.
2. Selecione um ou vários pedidos e abra Montagem no celular.
3. Ajuste a sequência com os botões de subir/descer e escolha um motoboy disponível.
4. Atribua a rota: ela permanece **PREPARING**, o motoboy fica reservado e sai
   das sugestões de disponibilidade. Os pedidos ainda não estão em entrega.
5. Edite a montagem enquanto PREPARING. Remover um pedido devolve-o ao despacho;
   o motoboy reservado continua vinculado à mesma rota.
6. Abra **Visão do motoboy (demo)**. Somente nessa visão separada há
   **Iniciar rota — simulação**. Depois de ON_ROUTE, a composição e a sequência
   ficam bloqueadas.
7. Simule as entregas: o motoboy fica RETURNING. Confirme o retorno nessa visão
   para devolvê-lo ao final da fila. Uma ocorrência pendente impede a conclusão.

Todos os botões de cadastro, atribuição e ciclo da rota indicam demonstração.
Não existe etapa "Em preparo", "Pronto" ou "Marcar como pronto" para pedidos.
O rótulo "Em preparação" pertence à rota PREPARING, não ao preparo de alimentos.
"Reservado" deriva da rota ativa; não cria um novo enum no banco.

## Estrutura visual e referências

Em desktop (a partir de 1100px), pedidos, montagem e motoboys aparecem juntos.
Rotas e ocorrências ficam abaixo; a ocorrência recebe prioridade visual.
Listas têm rolagem própria e pedidos são paginados em grupos de 20. Selecionar
visíveis afeta apenas a página atual, mantendo o total de selecionados explícito.
Busca por referência, cliente/bairro e filtro de observações atendem ao balcão.
No celular, quatro abas mantêm as mesmas interações sem rolagem horizontal.

Esta feature prioriza desktop conforme a instrução específica da tarefa,
preservando a adaptação mobile requerida por CONVENTIONS.md. A paleta, fonte,
marca com raio e componentes de autenticação existentes foram preservados.
Não há mapas, gráficos financeiros ou animações de operação.

Ainda não há um frame Figma aprovado para esta central, conforme confirmado pelo usuário. A comparação
pixel a pixel permanece pendente; o layout proposto segue o briefing operacional
e o design system atual e deve ser aprovado visualmente antes do backend.

Skills usadas seletivamente: `emil-design-eng`, `mobile-native`, `break-ui`,
`rpmdelivery-qa` e revisão de componentes com `react-best-practices`.
Não foi necessário acionar prototype ou skills de motion.

## Dados extremos e acessibilidade

| Campo | Fonte no protótipo | Limite/tratamento |
| --- | --- | --- |
| Cliente / motoboy / restaurante | Formulário, fixtures / workspace existente | Cliente 120; demais sem limite visual, quebra de linha |
| Referência do pedido | Formulário / fixtures | Opcional, 40; geração local se ausente; quebra de identificador longo |
| WhatsApp | Formulário / fixtures | 24 caracteres; celular brasileiro com DDD; nunca há envio ou link de contato |
| Endereço / complemento | Formulário / fixtures | 240 cada; complemento opcional; apresentados integralmente na visão do motoboy |
| Bairro | Formulário / fixtures | 120; quebra de linha |
| Observações / ocorrência | Formulário / fixtures | Observação 500, opcional; ocorrência sem limite visual; texto literal escapado pelo React |
| E-mail da conta | Workspace existente | Sem limite visual; quebra de linha; oculto no cabeçalho mobile |
| Contagens, fila, tempo, sequência | Estado local / fixtures | Números tabulares, pluralização, lista paginada; tempo demonstrativo fixo, sem cronômetro real |
| Status / ações | Enums e texto fixo | Nome + cor; botões indisponíveis desabilitados; reserva derivada de PREPARING |
| Listas | Fixtures / estado local | Vazio, um item, exemplo, textos longos e 1.000 pedidos |

Os limites do formulário são limites deste protótipo, não novas regras de banco.
Nomes compostos, CJK/árabe, observações longas e marcação HTML literal têm fixtures.
Casos vazios oferecem instruções e desabilitam atribuição. Ocorrências não têm
um botão que aparente resolver uma decisão real da loja.
Abas suportam setas, Home/End e foco visível. Dialog nativo contém o foco,
fecha com Escape e devolve o foco ao acionador. Campos mobile têm fonte 16px
e ações de toque têm pelo menos 44px de altura. Hover só atua em ponteiros precisos.

## Backend posterior

O reducer local demonstra regras, **não implementa autorização ou concorrência**.
O backend deverá validar identidade do próprio motoboy ao iniciar/confirmar retorno,
restaurante, vínculo ACTIVE, turno aprovado, disponibilidade e rota ativa exclusiva.
A atribuição será transacional, criando PREPARING sem tracking ou notificações.
Composição e sequência precisarão de bloqueio transacional após ON_ROUTE.
Ocorrências, reentrega/retorno de pedido e encerramento de turno exigirão fluxos reais.

Não foram implementados CRUD/RPC, migrations/RLS, aplicativo do motoboy,
GPS, notificações, WhatsApp/SMS ou integrações externas. O preview público deve
continuar restrito a dados fictícios; nunca reutilizar dados autenticados nele.

## Validação

`npm run verify`, `npm run test:unit`, SQL/PGlite, `npm audit --omit=dev`,
Playwright desktop/mobile e `git diff --check` fazem parte da entrega.
Os E2E conferem ausência de chamadas operacionais, reserva, início manual separado,
bloqueio após saída, retorno/fila, ocorrências, pesquisa/paginação e reflow em
320, 375, 390, 640, 1280, 1440 e 2560px. O teste de auth original permanece.
Emulação e redimensionamento não equivalem a teste em aparelho físico.

No navegador integrado, cadastro, múltipla seleção, montagem, reserva, início
pela visão separada e confirmação de retorno foram percorridos com dados fictícios.
A captura de console/rede não apresentou exceções, erros, requisições falhas
ou HTTP 4xx/5xx inesperados. Screenshots de desktop e mobile acompanham a PR
em `docs/screenshots/operations-desktop.jpg` e `operations-mobile.jpg`.

| Caso observado no QA | Tratamento verificado |
| --- | --- |
| Foco perdido ao trocar o botão de estado do motoboy | Botão preservado entre PREPARING/ON_ROUTE/RETURNING; ao concluir, foco no fechamento |
| Mudança automática de área no celular | Foco acompanha a aba Montagem/Rotas; cadastro começa no primeiro campo |
| Troca do dataset no preview | Cenário na URL; foco restaurado no seletor após reiniciar a demonstração |
| Montagem vazia em desktop compacto | Conteúdo ajustado ao painel sem rolagem interna desnecessária |
| Nomes, referências e observações extensas | Quebra de linha e texto integral; sem rolagem horizontal nos tamanhos testados |
| 1.000 pedidos / filtro sem resultado | Paginação de 20, seleção explícita de visíveis e estado vazio acionável |

Reflow a 640px foi testado adicionalmente; zoom nativo de 200%, teclado virtual
e aparelhos físicos não foram validados. Não há tema escuro nem interface RTL
no design system atual; nomes CJK/árabes são exibidos com direção automática.

O audit completo mantém a exceção preexistente de cinco alertas altos na cadeia
dev de `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` →
`micromatch` → `braces`. Nenhuma dependência foi alterada; o gate continua sendo
`npm audit --omit=dev` com zero vulnerabilidades de produção.
