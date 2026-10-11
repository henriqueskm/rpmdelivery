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

## Skills de design e movimento

- As skills de terceiros ficam em `.agents/skills/`; consulte `docs/design-agent-skills.md` para fontes e instalação local. Selecione apenas as skills pertinentes à tarefa; não acione todas automaticamente.
- Use `emil-design-eng` para decisões de UI e qualidade visual, `mobile-native` para telas do motoboy e operação mobile, e `break-ui` para testar layouts com dados extremos.
- Use `prototype` quando solicitado para explorar alternativas antes de implementar. Use `find-animation-opportunities` para propor onde o movimento agrega valor, sem aplicar mudanças automaticamente.
- Use `animate` e `transitions-dev` somente quando movimento agregar valor. Use `review-animations`, `improve-animations` e `transitions-polish` para revisar animações existentes.
- Preserve a identidade aprovada com o raio minimalista. As skills não autorizam mudanças de marca, dependências ou escopo, nem importação automática do CSS de referência.
- A skill `.codex/skills/rpmdelivery-qa/SKILL.md` e Playwright continuam obrigatórios nas mudanças visuais, junto de `npm run verify`.

## Validação e revisão

- Mudanças visuais relevantes devem passar por revisão independente do `rpmdelivery_visual_critic` após a implementação do Builder e antes da aprovação da PR; não o acione em PRs exclusivamente de backend ou documentação. Consulte `docs/visual-critic.md` para invocação, evidências e limites de leitura.
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
