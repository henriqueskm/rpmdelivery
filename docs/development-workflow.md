# Fluxo de desenvolvimento do RpmDelivery

**Figma → implementação no Codex → teste em localhost → comparação visual → Playwright → PR → revisão**

ChatGPT atua como arquiteto/revisor: ajuda a definir escopo, comportamento, riscos e critérios de aceite. Codex é o Builder principal: implementa, verifica e corrige. Figma é a referência visual das telas aprovadas.

1. **Figma:** identifique os frames aprovados, estados e variações desktop/mobile. Documente lacunas e justifique desvios antes de mudar o design.
2. **Implementação no Codex:** leia `AGENTS.md`, `CONVENTIONS.md` e os guias locais do Next.js; confira o Git e trabalhe em branch/worktree por feature quando aplicável. Use a skill local `.codex/skills/rpmdelivery-qa/SKILL.md` para QA.
3. **Localhost:** execute `npm run dev`, leia a URL `Local` no terminal e abra essa URL no navegador integrado do Codex. Teste o fluxo como usuário real, incluindo cliques, formulários e estados de loading, vazio e erro. Verifique console e network pelas ferramentas disponíveis.
4. **Comparação visual:** compare a implementação com o mesmo frame, estado e viewport do Figma. Confira desktop/mobile e use screenshots quando ajudarem. Corrija problemas e repita o fluxo afetado.
5. **Playwright:** execute `npm run verify` e os E2E relevantes; antes da revisão, rode `npm run test:e2e` para os dois perfis. Registre resultados e limitações.
6. **PR:** quando autorizado a publicar, prepare um PR com problema resolvido, mudanças, evidências visuais úteis, testes e riscos. Execute `git diff --check`. Se a tarefa pedir parar antes de commit/push, entregue o diff local para revisão.
7. **Revisão:** ChatGPT e/ou o responsável revisam o diff e as evidências. Banco, RLS, autenticação, concorrência, pagamentos e tracking exigem atenção especial. Não faça merge automaticamente; alterações em produção exigem autorização explícita.

## Comandos de QA

Instale as dependências com `npm ci` em um checkout com lockfile sincronizado e o Chromium com `npm run test:e2e:install`.

| Comando | Uso |
| --- | --- |
| `npm run verify` | Lint, TypeScript e build |
| `npm run test:e2e` | Todos os E2E em desktop e mobile |
| `npm run test:e2e:desktop` | Chromium desktop |
| `npm run test:e2e:mobile` | Chromium com emulação Pixel 7 |
| `npm run test:e2e -- tests/e2e/home.spec.ts` | Smoke da página inicial |
| `npm run test:e2e:ui` | Interface de depuração do Playwright |
| `npm run test:e2e:report` | Abrir o último relatório HTML |

Os E2E ficam em `tests/e2e/`. A configuração segue os recursos de [servidor local](https://playwright.dev/docs/test-webserver) e [emulação](https://playwright.dev/docs/emulation) do Playwright: compila o app, inicia um servidor próprio em `http://127.0.0.1:3100` e o encerra ao terminar. Uma porta ocupada causa falha; escolha outra com `E2E_PORT` (PowerShell: `$env:E2E_PORT = "3101"`). A URL é sempre local. Em CI Linux, instale dependências do navegador com `npx playwright install --with-deps chromium` quando necessário.

O smoke exige HTTP 200, título e conteúdo principal do RpmDelivery visíveis, sem exceções JavaScript, erros de console ou falhas de rede/HTTP dos recursos locais durante o carregamento. É uma verificação inicial; não cobre fluxos de negócio ainda inexistentes. Mobile usa emulação, não um aparelho físico. Relatórios, traces, vídeos e screenshots de falhas ficam ignorados em `playwright-report/` e `test-results/`.
