# PR #14 — decisão rápida na sugestão de rotas

Revisão Lead de 12/10/2026, base `133b5782d2726c572ca58d32d5d94173d626f70a`. Mesma branch `codex/manual-route-optimization`, sem outra PR. O P2 pede menor carga cognitiva, com recomendação, benefício, risco e ação antes dos detalhes.

| Antes | Depois | Benefício |
| --- | --- | --- |
| Desktop abre duas listas técnicas; mobile exige comparar métricas e detalhes extensos | Uma recomendação curta, três deltas e uma sequência compacta | Identificar a proposta, ganho e desvantagem antes de ler o relatório |
| Zero atrasos pode soar tranquilizador apesar de margem inferior a 1 min | Alerta de prazo muito apertado no topo e na parada correspondente | Distinguir estimativa sem atraso de ausência de risco |
| Hipóteses ocupam o desktop depois de calcular | Hipóteses compactas em todos os tamanhos, com Editar hipóteses | Recuperar espaço sem perder cálculo explícito ou invalidação |
| Listas com nome/endereço/chegada/entrega/limite/retorno por padrão | Código, bairro, entrega/limite resumidos, margem/atraso e posição alterada; comparação completa recolhida | Reduzir repetição, preservando informação completa sob demanda |

## Semântica dos dados e cores

Tudo deriva de `Comparison`, sem valores fixos de demonstração no JSX. Verde para redução real na métrica estimada; cinza para delta exatamente zero; atenção para pequena piora; vermelho para mais atrasos ou piora relevante. As cores vêm acompanhadas de números, setas/ícones e texto; coral da marca permanece no CTA.

A classificação visual de tempo/distância usa atenção quando há aumento pequeno. É relevante (vermelho) ao atingir 5 min/1 km ou 10% de uma base positiva. Esses limites são **somente apresentação**, não pesos do motor. Pequenas diferenças reais aparecem em segundos/metros, mesmo quando os valores arredondados parecem iguais. Sem percurso manual, mostramos comparação indisponível, sem inventar ganho.

Prazo: atraso previsto ou vencido fica vermelho; margem abaixo de 5 min fica em atenção; abaixo de 1 min recebe “prazo muito apertado”. Margens suficientes são neutras, sem garantia de chegada. Se prazos forem impossíveis, a quantidade que continua atrasada e a impossibilidade sob as hipóteses ficam explícitas. Se a quantidade de atrasos não muda, mas o atraso total cai, a recomendação explica essa diferença.

No cenário urgente (saída 15:05, atendimento 2 min): 1 → 0 atrasos, 27 → 27 min, 8,4 → 8,5 km com **+100 m**, e **margem <1 min**. São resultados das fixtures sob essas hipóteses, não previsão real de trânsito.

## Divulgação progressiva e acessibilidade

“Ver comparação detalhada” é um details/summary nativo, fechado por padrão e reversível por teclado, antes da sequência. A entrada permanece visível na posição inicial com oito paradas nas cinco resoluções testadas; não exige percorrer a lista. Mantém as duas ordens com nomes, endereços, chegada, conclusão da entrega, limites, margens, atraso total e retorno. Enter/Space abrem/recolhem mantendo foco no controle. Editar hipóteses mostra os campos e cálculo; mudar dados invalida a proposta. Após calcular, foco vai para a recomendação. Escape/manter devolve à montagem; aplicar continua explícito e guardado.

Não adicionamos animação, dispositivo sniffing, zoom bloqueado ou timers por linha. Usamos a altura dinâmica e o scroll existente. Alvos mobile continuam ≥44px; textos longos quebram, sem eliminar informação. Sem frame Figma aprovado, preservamos o design system e o raio.

## Escopo preservado

Sem alterações no motor `features/route-optimization/`, adaptador/contratos `services/routing/`, reducer operacional, assinatura de invalidação ou hook de cálculo. Mesmos IDs, PREPARING/reserva, release, início exclusivo pelo motoboy e bloqueio ON_ROUTE. Sem Supabase, migrations, banco remoto, dependências, credenciais, tracking, notificações ou produção. Os arquivos locais anteriores do checkout principal continuam fora desta worktree e da PR.

## Validação e evidências

Verify, unitários, SQL/PGlite local, audit de produção e E2E são registrados com a versão final antes do push. Os 6 testes novos de apresentação cobrem deltas, cores, arredondamento, margens críticas, impossibilidade e ordem já ótima. Os E2E adaptados mantêm seleção/aplicação/descarte/invalidação/release/ON_ROUTE e acrescentam decisão progressiva em 320/375/390/1280/1440, teclado e oito paradas.

Capturas [antes](../screenshots/manual-optimization/decision-ux/before/), [primeiro candidato](../screenshots/manual-optimization/decision-ux/after/) e [após correção do Critic](../screenshots/manual-optimization/decision-ux/after-review/) usam mesmos pedidos, relógio 15:00, saída 15:05, atendimento 2 min e posição inicial. Incluem urgente/oito paradas nas cinco larguras, texto longo 320px, prazos impossíveis, coordenadas ausentes e destino sem rota. Observações DOM ficam nos JSON de cada diretório. A contagem de paradas serve para evidência de espaço; não substitui avaliação da facilidade de decidir.

O Visual Critic deve avaliar independentemente carga cognitiva, clareza de benefícios/desvantagens/riscos e acesso aos detalhes, sem editar seus achados. Sem navegador na sessão dele, imagens/código e limitações serão explicitados; testes interativos do Builder não serão atribuídos ao Critic. Emulação não comprova hardware, teclado virtual, safe areas, zoom/gestos nativos ou WCAG completa. Não medimos tempo de decisão com operadores reais.

## Resultados do Builder

- Verify: lint, TypeScript/typegen e build passaram.
- Unitários:44 passaram, incluindo6 de apresentação; testes do algoritmo/Mapbox existentes continuam aprovados.
- SQL install + PGlite: passou exclusivamente local.
- Audit de produção:0 vulnerabilidades. Dependências/lockfile não alterados; alertas dev preexistentes permanecem fora do gate de produção.
- E2E final após correção do P2:84 passaram em3,1min, desktop/mobile,1worker/retries0. Nenhuma falha/flaky/retry nessa rodada. O perfil de CI permanece inalterado.
- git diff --check: passou.

QA integrado: seleção de3 pedidos, recomendação, dois tipos de risco (atraso e margem crítica apesar de zero atrasos), comparação detalhada por Enter/Space, edição de atendimento e invalidação, recálculo, manter sem mudar a montagem e aplicação explícita. Viewports1280×800,1440×900,390×844,375×844 e320×844; sem overflow horizontal, ações≥44px e dentro da tela, campos compactos após cálculo, foco na recomendação. Viewport restaurado.

A primeira captura CDP de fluxo longo ficou truncada; não foi considerada cobertura completa. Repetição curta desde reload→seleção→calcular:21 respostas, zero HTTP≥400/loadingFailed/exceções ou respostas externas, hasMore=false e truncated=false. Console error/warn vazio. Não atribuir essa captura do Builder ao Critic.

Nas14 capturas finais de cenários, zero overflow/pageerror/console error/HTTP inesperado/requisições externas. Contraste calculado a partir das cores CSS renderizadas dos elementos semânticos: mínimo5,83:1; verifica esses elementos, não WCAG integral nem todos os estados de foco/hover.

| Viewport | Urgente antes (manual+sugerida) | Urgente depois (única sequência) | Oito antes | Oito depois |
| --- | --- | --- | --- | --- |
|320×844|0+0|0|0+0|0|
|375×844|0+1|1|0+1|1|
|390×844|0+2|1|0+2|2|
|1280×800|3+3|2|3+3|2|
|1440×900|3+3|3|4+4|4|

Contagem de paradas **completas** na posição inicial, com mesmos dados/hipóteses. As listas antigas duplicavam a leitura; a nova exibe só a proposta e deltas, com detalhe sob demanda. Em320px, o risco e métricas ficam acima da dobra, mas a primeira parada urgente não cabe inteira; rolagem continua necessária. Isso é uma limitação registrada, não uma alegação de que densidade sozinho resolve carga cognitiva.

A primeira revisão nativa independente, candidato `fd1e018`, encontrou P2: acesso aos detalhes depois de todas as paradas. [Relatório integral](optimization-decision-critic-first.md). Sessão filha `01a1324c-f3c1-7681-9f76-82ab09523a03`, papel `rpmdelivery_visual_critic`, sandbox read-only/approval never. O Builder moveu a entrada para antes da sequência e ampliou o E2E de oito paradas para testar descoberta inicial, toque ≥44px, Enter/Space e foco em todas as resoluções. Isso ocupa uma linha antes das paradas, com a contrapartida de menor contagem inicial, explicitada na tabela. A hierarquia decisória e alertas permanecem acima da entrada.

Rechecagem integrada do Builder: oito pedidos em390px; Enter abre as duas listas de oito e Space recolhe, mantendo foco no summary. Entrada visível sem rolagem em320/375/390/1280/1440, altura44px, zero overflow e console error/warn vazio. As14 capturas após o P2 não registraram erros de página/console/HTTP ou chamadas externas. A rechecagem nativa independente será anexada separadamente; não atribuir interações do Builder ao Critic.
