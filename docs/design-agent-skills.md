# Skills de design e movimento

As 10 skills abaixo são instaladas **somente no projeto**, em `.agents/skills/<nome>/`, para Codex. São instruções e referências; não são dependências runtime. A skill existente `.codex/skills/rpmdelivery-qa/` permanece intacta.

| Skill | Quando usar |
| --- | --- |
| `emil-design-eng` | Decisões de UI e qualidade visual |
| `mobile-native` | Telas do motoboy e operação mobile |
| `break-ui` | Layouts com dados extremos, vazios e textos longos |
| `prototype` | Explorar alternativas quando solicitado, antes de implementar |
| `find-animation-opportunities` | Propor onde movimento ajuda, sem implementar automaticamente |
| `animate` | Implementar animação que tenha propósito claro |
| `transitions-dev` | Aplicar uma transição adequada quando movimento agregar valor |
| `review-animations` | Revisar uma animação ou diff existente |
| `improve-animations` | Auditar animações e preparar planos de melhoria |
| `transitions-polish` | Ajustar duração, distância e easing de movimento existente |

Selecione apenas as skills pertinentes à tarefa. Elas complementam `AGENTS.md`, `CONVENTIONS.md` e as telas aprovadas do Figma; não autorizam alterar a marca do raio minimalista nem ampliar o escopo. Não importar `_root.css`, instalar bibliotecas de animação ou executar ferramentas externas automaticamente. Exemplos CSS/JS das referências são material de consulta, não arquivos carregados pelo app.

Mudanças visuais continuam exigindo `rpmdelivery-qa`, navegação real em localhost, comparação com o Figma quando disponível, `npm run verify` e Playwright desktop/mobile conforme [development-workflow.md](development-workflow.md).

## Fontes e inspeção

- [Emil Kowalski](https://github.com/emilkowalski/skills), commit inspecionado `2d228630ba1446365f614a108cb8252f1feda202`: oito skills selecionadas e referências Markdown. A licença MIT é preservada em `.agents/skills/LICENSE-emil.txt`.
- [Transitions.dev](https://github.com/Jakubantalik/transitions.dev), commit inspecionado `2773886681b6bb8effe0d7b5c66306430d18e000`: `transitions-dev` e `transitions-polish`, referências Markdown, CSS de exemplo e `LICENSE.txt` em cada diretório. A licença permite uso no projeto; não reempacotar a coleção como biblioteca concorrente.

Os diretórios selecionados foram inspecionados antes da instalação: não contêm scripts executáveis ou hooks de instalação. Não foram executados CLI, build ou ferramentas Refine do Transitions.dev. `skills-lock.json` registra as fontes, caminhos e hashes gerados pelo instalador.

Adaptações locais de compatibilidade: remoção de linhas em branco excedentes no final de 32 referências Markdown do Transitions.dev para passar `git diff --check`; e redução da descrição YAML de `transitions-dev` para 430 caracteres, dentro do limite de 1.024 do Codex. A descrição original completa foi preservada no corpo dessa skill. As demais instruções, licenças e CSS de referência permanecem iguais às fontes inspecionadas; os hashes do lockfile representam a fonte do instalador, antes dessas adaptações documentadas.

A descoberta foi validada pelo próprio `codex-cli 0.132.0`, com `skills/list` e `forceReload: true` no worktree: 10 skills habilitadas em escopo `repo`, zero erros de leitura e `rpmdelivery-qa` ainda disponível. O CLI `skills list --agent codex --json` também lista as 10 em escopo `project`.

## Instalação e descoberta

Execute na raiz do projeto. O escopo padrão do CLI é local; **não use `--global` ou `-g`**. `--copy` mantém cópias portáveis versionadas, sem symlinks.

```sh
npx skills@latest add emilkowalski/skills --list
npx skills@latest add emilkowalski/skills --skill emil-design-eng animate review-animations improve-animations find-animation-opportunities mobile-native break-ui prototype --agent codex --copy --yes
npx skills@latest add Jakubantalik/transitions.dev --skill transitions-dev transitions-polish --agent codex --copy --yes
npx skills@latest list --agent codex --json
```

As skills são descobertas pelo Codex a partir do worktree que contém `.agents/skills/`. Abra uma nova sessão/turno nesse checkout após a instalação; a sessão de outro checkout não recebe essas skills por instalação global. Atualizações futuras devem ser explícitas, com nova inspeção das fontes e revisão do diff, sem reinstalar indiscriminadamente sobre mudanças locais.
