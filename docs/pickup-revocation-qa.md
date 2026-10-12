# Revogação de retirada — PR #13

Resolve o P2 operacional da revisão Lead do HEAD `e73af1e97301cd5bc67452c02f5dd64bd8d1703f`, preservado como ancestral. A mesma branch/worktree foi continuada, sem reset, rebase ou force-push.

## Regra demonstrativa

Enquanto PREPARING e liberada, a rota oferece **Cancelar liberação** no lugar de **Liberar retirada**. O comando `revoke-release` limpa somente `pickupReleasedAt`; mantém pedidos, ordem, courier reservado, promessas e horários. A visão do motoboy volta a Aguardando liberação e o reducer rejeita início até nova liberação. Nova liberação registra seu próprio horário. ON_ROUTE, RETURNING, COMPLETED, rota ausente ou já não liberada rejeitam revogação sem alterar estado.

Nenhum campo de banco, RPC, persistência, tracking, notificação, dependência, autenticação, CSS, marca ou produção mudou. Central de Ocorrências/Issue #12 permanece fora desta correção. O contrato futuro de revogação autorizada e corrida com início está documentado em [delivery-deadlines-pickup.md](delivery-deadlines-pickup.md); não foi implementado remotamente.

## Validação do Builder

- Verify: lint, TypeScript e build aprovados.
- Unitários: 20 aprovados, com ciclo liberar/revogar/liberar novamente/iniciar, conservação exata dos demais campos e rejeição de revogação depois da saída.
- SQL/PGlite: aprovado, exclusivamente runtime local já instalado.
- Audit de produção: zero vulnerabilidades. Exceção dev anterior permanece documentada; sem alterações de dependências.
- E2E final: 64 aprovados com `npm run test:e2e -- --workers=1`, sem retries; configuração CI/retries inalterada.
- Teste novo executa ciclo, reserva, ordem, limites, foco e bloqueios em 1280×800, 1440×900, 320×844, 375×844 e 390×844 nos dois perfis. A altura do botão segue o design system: 40px desktop e pelo menos 44px mobile.
- Navegador integrado: ciclo de liberação, revogação e nova liberação/início conferido em desktop1280 e mobile390. Console sem erros/warnings; durante as ações locais, CDP não registrou requisições de mutação, falhas ou exceções, sem eventos truncados/paginação pendente. Depois de ON_ROUTE, Cancelar liberação ausente.
- Git diff check aprovado. Alterações anteriores do checkout principal preservadas e verificadas separadamente.

Uma asserção inicial do teste novo exigia44px também no desktop; foi corrigida para os tamanhos existentes por viewport, sem modificar CSS ou reduzir a exigência mobile. O fluxo passou na execução completa final.

## Evidências

17 capturas novas em [screenshots/pickup-revocation](screenshots/pickup-revocation), produzidas por Playwright contra localhost3007, fixtures demo, DPR1, fuso America/Sao_Paulo e relógio congelado em 12/10/2026 15:00. Sem injeção de estado; liberação/cancelamento/nova liberação/início realizados pelos controles. Capturas de viewport após rolar a rota para a área visível; a janela pode mostrar só parte do cabeçalho, mas não há recorte posterior ou edição da imagem.

- Desktop1280: [liberada](screenshots/pickup-revocation/1280-released.jpg), [revogada](screenshots/pickup-revocation/1280-revoked.jpg), [início bloqueado](screenshots/pickup-revocation/1280-driver-blocked.jpg).
- Mobile390: [liberada](screenshots/pickup-revocation/390-released.jpg), [revogada](screenshots/pickup-revocation/390-revoked.jpg), [início bloqueado](screenshots/pickup-revocation/390-driver-blocked.jpg), [nova liberação](screenshots/pickup-revocation/390-driver-released-again.jpg), [ON_ROUTE](screenshots/pickup-revocation/390-on-route.jpg).
- Mesmos estados liberada/revogada/bloqueada registrados em 1440, 320 e 375.

Sem frame Figma aprovado para esta evolução. Emulação não comprova aparelho físico, teclado virtual/safe areas/gestos ou conformidade WCAG completa. O relatório independente do Critic registra suas próprias limitações, sem atribuir a ele a inspeção interativa feita pelo Builder.
