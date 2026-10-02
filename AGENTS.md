<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Regras específicas do RpmDelivery

## Fluxo e referências

- Siga integralmente `CONVENTIONS.md` e leia os guias locais do Next.js pertinentes antes de escrever código.
- Codex é o Builder principal; ChatGPT atua como arquiteto/revisor.
- Trabalhe em branch/worktree por feature quando aplicável. Confira `git status` antes de alterar arquivos e preserve mudanças prévias do usuário.
- Figma é a referência visual das telas aprovadas. Não invente uma UI diferente do Figma sem justificar o desvio e encaminhá-lo para revisão.
- Siga `docs/development-workflow.md` e use `.codex/skills/rpmdelivery-qa/SKILL.md` para validação no localhost e comparação visual.

## Validação e revisão

- Execute `npm run verify` após alterações e corrija falhas reais de lint, TypeScript e build.
- Execute os testes E2E relevantes às mudanças. Antes de concluir o QA, rode `npm run test:e2e` para os perfis desktop e mobile.
- Teste no navegador integrado do Codex como usuário real e registre as limitações de acesso/emulação quando houver.
- Mudanças de banco, RLS, autenticação, concorrência, pagamentos e tracking exigem revisão cuidadosa: explique comportamento, impacto, riscos e evidências de validação.
- Não faça merge automaticamente. Respeite os limites de commit/push definidos na tarefa.

## Limites de operação

- Não execute migration remota.
- Não execute `supabase db push`.
- Não altere secrets nem exponha credenciais em arquivos, screenshots, logs ou relatórios.
- Não execute comandos destrutivos.
- Não apague dados.
- Não mexa em produção sem autorização explícita do usuário.
