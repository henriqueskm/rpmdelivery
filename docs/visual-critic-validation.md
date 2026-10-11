# Funcionamento do Visual Critic

## Configuração e descoberta

- Escopo: somente projeto, `.codex/agents/rpmdelivery-visual-critic.toml`.
- Identificador nativo: `rpmdelivery_visual_critic`.
- Campos obrigatórios, TOML e os cinco caminhos de skills existentes foram validados com Python `tomllib`.
- Runtime utilizado: binário já instalado no Codex desktop, `0.162.0-alpha.17.2`; nenhuma instalação/atualização global ou override de modelo foi feita. O CLI global `0.132.0` não foi usado para a prova de invocação.
- A nova sessão do runtime recebeu somente um pedido neutro de descoberta e invocou o custom subagent pelo tipo; ler AGENTS.md ou apenas encontrar o nome no prompt não foi tratado como prova.
- Sessão principal de descoberta: `01a12d2a-9a02-75b1-9885-e8c29b1bed76`.
- Filho: `01a12d2a-bfc3-75e0-b178-23bb79b5c437`, caminho `/root/validate_visual_critic`.
- Metadados persistidos do filho confirmaram `agent_role = rpmdelivery_visual_critic`, origem `subagent.thread_spawn`, sandbox `read-only` e aprovação `never`. O filho confirmou identidade independente e existência das cinco skills.
- Uma tentativa inicial com `--ephemeral` falhou ao carregar o contexto do filho (“no rollout found”). A execução normal, sem esse parâmetro e sem ampliar permissões, funcionou. A limitação foi do runtime, não encoberta com um agente genérico.

## Teste independente da PR #10

- PR revisada: [#10](https://github.com/henriqueskm/rpmdelivery/pull/10), HEAD `7fe01d6aaeb326e4d2869e226d06d57d451861ae`.
- Sessão principal nova: `01a12d44-84c8-7230-9c5b-bfdf28a7e222`.
- Filho nativo: `01a12d44-ba68-7f80-9812-37a7cf47f8ec`, `/root/independent_visual_review`.
- Metadados confirmaram novamente o tipo customizado, sandbox `read-only` e aprovação `never`.
- O filho não recebeu histórico de implementação nem conclusões do Builder. Inspecionou quatro screenshots renderizadas do HEAD, cenário de pico com 1.000 pedidos/20 selecionados: 1280×800, 1440×900, 390×844 Pedidos e Montagem; leu componentes para localizar responsáveis.
- Retornou dois P2: observações relevantes ausentes na montagem e pouca área útil da sequência no mobile. Não corrigiu achados nem aprovou a PR.
- [Relatório independente, evidências e nota sobre a contagem visual](reviews/pr-10-visual-critic.md).

## Limitações explícitas

A primeira sessão independente no app atingiu limite de uso e encerrou sem relatório; isso não foi contado como revisão concluída. Na execução nativa concluída, o revisor tentou o navegador integrado, que retornou `Browser is not available: iab`. Portanto, a prova visual é de **screenshots e código**, não de navegação interativa independente.

O revisor não validou ações, teclado/foco/Escape, console/network, 375/320px, estados vazio/loading/erro/textos longos ou hardware físico nessa execução. Essas verificações continuam exigidas quando as ferramentas estiverem disponíveis. Não há frame Figma aprovado. A configuração não é uma garantia universal de isolamento para browser/MCP ou overrides ativos da sessão; consulte [os limites de leitura](visual-critic.md).

## Preservação e validação da configuração

Esta branch é baseada em `origin/main` (`4d43c6e19102d5a46870dc35eceffa9d7789a41c`), não na branch do dashboard. O diff contém somente o agente, AGENTS.md e documentação. As dez skills anteriores não foram alteradas, reinstaladas ou duplicadas. O bloco automático do Next.js foi preservado.

O Builder executou `npm ci`, `npm run verify` (lint, typegen/TypeScript e build aprovados), seis unitários, SQL/PGlite local e audit de produção com zero vulnerabilidades. O Critic não executou esses comandos. Esses resultados validam a branch de configuração baseada na main; não são cobertura visual independente da PR #10.

E2E desktop/mobile: a primeira execução (`--workers=2 --retries=0`) teve 31 aprovados e uma falha no teste preexistente “Escape durante debounce cancela a busca e não deixa loading preso”, desktop, `tests/e2e/onboarding-address.spec.ts:66`: a busca “Rua de teste” disparou antes do Escape. O arquivo não foi alterado nesta branch. A repetição diagnóstica completa com `--workers=1 --retries=0` teve 32 aprovados sem retries. O resultado inicial permanece documentado; uma repetição verde não prova eliminação de flakiness. O CI usa a configuração existente, sem alterações de retries ou testes para esconder o problema.

Nenhum arquivo da PR #10, dependência runtime, autenticação, componente/CSS, banco, migration, Supabase, secret ou produção foi alterado. O HEAD e o estado Git da PR #10 e os hashes dos arquivos locais anteriores do checkout principal foram conferidos antes/depois. Não houve stash, descarte, merge ou auto-merge.
