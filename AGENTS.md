<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RpmDelivery — instruções do projeto

Antes de alterar código, leia `CONVENTIONS.md`.

## Forma de trabalhar

- Comece pela menor quantidade de contexto necessária: pesquise primeiro e abra apenas os arquivos relevantes.
- Não faça refatorações, upgrades ou mudanças de arquitetura fora do escopo solicitado.
- Para tarefas maiores, separe diagnóstico, implementação e revisão.
- Quando disponível, use a skill `rpmdelivery-senior-dev` para tarefas de implementação, revisão, depuração, banco, segurança, performance ou deploy.
- Nunca altere diretamente a branch `main`; trabalhe em branch específica para a tarefa.
- Considere a tarefa concluída somente após `npm run verify` passar, salvo quando a tarefa não alterar código executável.

## Fontes de verdade

- Código e migrations versionados no GitHub são a fonte de verdade do projeto.
- Para Supabase, confirme o estado remoto e a documentação atual antes de mudanças em schema, Auth, RLS, RPCs ou permissões.
- Para problemas de produção, deploy ou performance, consulte Vercel apenas quando isso for relevante para a tarefa.
- Se o estado remoto divergir do repositório, pare a alteração destrutiva e registre a divergência antes de continuar.
