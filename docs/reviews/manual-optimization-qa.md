# Otimização manual assistida — QA do Builder

Base: main após PR #13, `a392e6163cc88a28967ca593d46d4a56da9665b5`. Branch `codex/manual-route-optimization`. URL local: http://127.0.0.1:3008/preview/operacao?scenario=opt-urgent.

## Verificação executada

- npm ci: passou, sem alterações no package.json/lockfile.
- npm run verify: lint, typegen/TypeScript e build passaram (Next.js 16.3.8).
- npm run test:unit: 38 passaram; 12 do domínio de otimização e 6 do adaptador Matrix, além dos existentes.
- npm run test:sql:install e npm run test:sql: passaram, somente PGlite local.
- npm audit --omit=dev: zero vulnerabilidades. Audit completo mantém cinco alertas high exclusivos de desenvolvimento já existentes; nenhuma dependência, override ou gate foi alterado.
- npm run test:e2e: 80 passaram, desktop-chromium/mobile-chromium, sem flaky/retry na execução completa final local. Dezesseis execuções cobrem os oito casos novos.
- git diff --check: passou.

Durante o desenvolvimento, o E2E identificou que o diálogo dentro do painel ocultável desaparecia ao redimensionar desktop→mobile. O Builder moveu o diálogo para a raiz da operação; preservou a asserção e repetiu a suíte completa. O relógio do teste foi ajustado para aguardar o primeiro carregamento lazy antes de pausar timers; nenhuma mudança de retries/configuração global.

## Navegador integrado

QA sobre build final de produção local, com dados fictícios: seleção de três pedidos, comparação sem mudança da montagem, alteração de atendimento e invalidação imediata, recálculo, aplicação explícita, ordem/observações preservadas e descarte. Viewports 1280×800, 390×844, 375×844 e 320×844; diálogo sobrevive ao redimensionamento. Sem overflow horizontal; botões do rodapé ≥44px e visíveis.

CDP Network/Runtime/Log habilitados antes de recarregar e executar esse fluxo: 21 respostas, zero HTTP ≥400, loadingFailed, exceções ou respostas externas. Captura sem hasMore/truncated. Logs error/warn vazios. Este resultado se limita ao fluxo capturado, não comprova hardware mobile nem todo estado do produto.

## Evidências reproduzíveis

[Screenshots](../screenshots/manual-optimization/) e [observações DOM](../screenshots/manual-optimization/observations.json) capturados com Chromium, timezone America/Sao_Paulo, relógio em 12/10/2026 15:00 e saída 15:05, atendimento 2min. Não representam trajetos reais.

| Cenário / selecionados | Manual | Sugerida | Atrasos previstos manual → sugerida |
| --- | --- | --- | --- |
| Urgente / 1048,1047,1046 | 27min · 8,4km | 27min · 8,5km; 1047,1048,1046 | 1 → 0 |
| Curta / dois | 14min · 3,6km | Mantém a ordem | 0 → 0 |
| Próximos / três | 13min · 2,8km | 13min · 2,7km | 0 → 0 |
| Prazos próximos / três | 27min · 8,4km; atraso total18min | 27min · 8,4km; atraso total12min | 2 → 1, impossibilidade explícita |
| Impossíveis / três | atraso total51min | atraso total44min | 3 → 3, impossibilidade explícita |
| Pico / oito | 80min · 25,3km | 53min · 14,4km | 3 → 0 |

Há capturas adicionais de destino sem rota, serviço indisponível, coordenadas ausentes, textos longos em320px e seleção20 sem truncamento (restrição8). Nas14 capturas de cenários: zero overflow, pageerror ou requisições externas/mutações. A captura mostra posição inicial; não implica que toda sequência mobile seja visível simultaneamente.

## Segurança e limites

Nenhuma chamada real de Matrix, cobrança, credencial real ou endpoint novo. O adaptador server-only é isolado; a montagem usa exclusivamente fixtures. Nenhum arquivo de auth, Supabase, migration, dependência, marca ou produção foi alterado. Os seis arquivos protegidos do checkout principal permanecem com os hashes SHA256 originais e o mesmo git status.

Sem frame Figma aprovado, usamos o design system atual. Emulação não valida aparelho físico, teclado virtual, gestos, safe areas ou conformidade WCAG completa. Testes Matrix com fetch injetado não comprovam acesso/licenciamento do provedor real. A revisão independente e suas limitações serão registradas separadamente pelo Builder.
