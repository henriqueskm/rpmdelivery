---
name: rpmdelivery-qa
description: Validar mudanças do RpmDelivery no localhost com o navegador integrado do Codex, comparar telas com o Figma e executar E2E desktop e mobile com Playwright.
---

# QA do RpmDelivery

## Preparar o ambiente

- Leia `AGENTS.md`, `CONVENTIONS.md` e `package.json`; confira `git status` e o escopo da mudança. Siga os limites de acesso a dados e produção do projeto.
- Antes de alterar código Next.js, leia o guia relevante em `node_modules/next/dist/docs/`.
- Use `npm ci` quando as dependências ainda não estiverem instaladas e o lockfile estiver sincronizado; não sobrescreva mudanças locais de dependências.
- Confira se já existe um servidor deste projeto. Reutilize-o somente após confirmar a pasta/processo e a aplicação exibida.
- Caso necessário, execute `npm run dev` na raiz em uma sessão persistente. Leia a linha `Local` do terminal e use a URL efetivamente anunciada: a porta pode ser diferente de 3000. Confirme a resposta e a identificação do RpmDelivery na página.
- Não encerre processos de outras tarefas para liberar uma porta. Escolha uma porta livre com `npm run dev -- --port 3001`, por exemplo, e confira novamente a URL no terminal.

## Navegador integrado e interação real

- Use as ferramentas de navegador disponíveis no Codex e leia a documentação retornada antes de operar. Com `cua_repl`, abra uma aba visível por `cua.createBrowserTab("iab", urlLocal, { visible: true })` e guarde a referência à aba.
- Leia o estado/DOM da página antes de decidir a próxima ação. Clique em controles visíveis, preencha formulários com dados fictícios de teste, navegue pelas rotas do fluxo e confirme o resultado exibido após cada etapa relevante.
- Com a API documentada de `cua_repl`, use `tab.playwright.getByRole(...).click()` e `tab.playwright.getByLabel(...).fill(...)`, com rótulos confirmados no snapshot. Depois leia `tab.getAXState()` ou `tab.playwright.domSnapshot()` para verificar o resultado.
- Prefira seletores acessíveis por papel, rótulo e texto. Não invente seletores, não injete estados internos para simular sucesso e não envie formulários que afetem produção ou dados reais.
- Teste sucesso, campos inválidos/obrigatórios, voltar, recarregar e recuperação de falhas quando fizerem parte da mudança. Considere teclado, foco e áreas de toque.
- Valide desktop e mobile: use o controle de viewport/emulação documentado do navegador, se disponível. Confira menus, rolagem, textos, botões e formulários em tela estreita. Se não houver emulação no integrado, registre essa limitação e use o projeto mobile do Playwright; emulação não equivale a testar um aparelho físico.
- Quando disponível, leia a documentação da capability `viewport` do navegador integrado e teste, por exemplo, 1280×720 e 390×844 com `viewport.set({ width, height })`. Restaure o tamanho com `viewport.reset()` ao terminar. Redimensionamento verifica layout; a emulação de toque/dispositivo fica no perfil mobile do Playwright.

## Console, network e estados

- Capture console e network desde a abertura/recarregamento usando as APIs de diagnóstico documentadas do navegador, quando disponíveis. Verifique exceções, hidratação, recursos ausentes, requisições falhas, HTTP 4xx/5xx inesperados e chamadas duplicadas no fluxo.
- No integrado, `tab.dev.logs({ levels: ["error", "warn"], limit: 30 })` consulta os logs. Para network/exceções, leia primeiro a documentação de `await tab.capabilities.get("cdp")`. Se o acesso estiver disponível, habilite `Network`, `Runtime` e `Log`, capture o cursor de `readEvents()`, execute/recarregue o fluxo e leia os eventos a partir dele. Observe `Network.responseReceived`, `Network.loadingFailed`, `Runtime.exceptionThrown` e `Log.entryAdded`; percorra `hasMore` e registre `truncated` quando a captura estiver incompleta. Não altere configurações de acesso automaticamente se a capability estiver bloqueada.
- Relacione cada erro à ação e ao comportamento visível. Registre URL, status e mensagem sem copiar tokens, cookies, secrets ou dados pessoais para relatórios.
- Se o navegador não oferecer console/network, use os eventos `pageerror`, `console`, `response` e `requestfailed` do Playwright e registre a cobertura que faltou no teste manual. Não declare que verificou algo sem evidência.
- Observe loading, estado vazio, erros e recuperação. Use cenários/dados de teste locais e, quando necessário, mocks explícitos e restritos ao teste para respostas lentas ou falhas; identifique o que foi simulado. Não modifique dados remotos para criar esses estados.
- Não use esperas fixas para esconder problemas; aguarde estados observáveis. Não remova uma asserção para fazer o teste passar.

## Comparar com o Figma

- Quando houver design de referência, obtenha a tela/frame aprovado e siga as skills do Figma exigidas pelas ferramentas disponíveis. Compare a mesma rota, estado e viewport.
- Confira espaçamento, tipografia, cores, alinhamento, componentes, responsividade e estados de interação. Figma é a referência visual; justifique desvios necessários e encaminhe decisões de design para revisão.
- Tire screenshots quando ajudarem a comparar antes/depois ou evidenciar um problema. Evite informações sensíveis e salve artefatos em `test-results/` ou no diretório de artefatos da tarefa, sem versioná-los por padrão.
- Se faltar acesso ao frame ou não houver referência, informe essa lacuna e valide a interface existente sem inventar uma tela aprovada.

## Corrigir, repetir e concluir

- Reproduza o problema, identifique a causa e faça a menor correção dentro do escopo. Mudanças em banco, RLS, autenticação, concorrência, pagamentos e tracking precisam de revisão cuidadosa conforme `AGENTS.md`.
- Depois da correção, repita o mesmo fluxo no navegador e os cenários desktop/mobile afetados. Acrescente E2E de regressão quando houver comportamento relevante a proteger.
- Execute `npm run verify` e, ao final, `npm run test:e2e`. Para filtros: `npm run test:e2e -- tests/e2e/home.spec.ts`; para um perfil: `npm run test:e2e:desktop` ou `npm run test:e2e:mobile`.
- Na primeira execução, instale os navegadores com `npm run test:e2e:install`. Em CI Linux, use `npx playwright install --with-deps chromium` quando o ambiente precisar das bibliotecas do sistema.
- O E2E compila o app e inicia um servidor local próprio em `http://127.0.0.1:3100`, encerrado pelo Playwright ao final. Não reutiliza servidor existente para evitar validar outro app/build. Se a porta estiver ocupada, defina `E2E_PORT` com uma porta livre (PowerShell: `$env:E2E_PORT = "3101"`) e execute novamente.
- Consulte `npm run test:e2e:report` e os traces/screenshots em `test-results/` nas falhas. Os artefatos ficam ignorados pelo Git.
- Execute `git diff --check`. Informe fluxos e testes executados, resultados, arquivos alterados e limitações reais. Pare antes de commit/push/merge quando esse for o limite da tarefa; QA não autoriza publicação, alterações remotas ou exclusão de dados.
