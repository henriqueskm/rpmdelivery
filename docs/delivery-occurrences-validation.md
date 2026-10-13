# Validação da Central de ocorrências

Versão revisada inicialmente: `0e5fe184d608eb941cb20766035bab697e8d0de1`, baseada na main `3face6d07082a5e977ab2cce1a23383983a02aa5`. Os resultados abaixo incluem a correção e rechecagem dos P2. A versão final de produto é identificada no relatório independente final e na PR. Escopo e integração futura: [delivery-occurrences-prototype.md](delivery-occurrences-prototype.md).

## Verificações do Builder

- `npm ci`: passou, sem mudança no lockfile. A instalação relatou cinco alertas de desenvolvimento preexistentes; dependências não foram alteradas.
- `npm run verify`: lint, typecheck e build Next.js 16.3.8 aprovados.
- `npm run test:unit`: 71 testes aprovados, incluindo transições, ator incorreto, idempotência, retries, timeout/decisão na mesma fronteira, sequência, fila, arredondamento da contagem e limite local de 1.000 pedidos.
- `npm run test:sql:install` e `npm run test:sql`: aprovados. Somente PGlite local, incluindo migrations existentes, preservação legada, RPC, grants e RLS; nenhuma aplicação remota.
- `npm audit --omit=dev`: zero vulnerabilidades.
- `npm run test:e2e -- --workers=2`: 132 aprovados, nos projetos desktop-chromium e mobile-chromium; zero retries locais (configuração existente preservada).
- `git diff --check` e `git diff --cached --check`: aprovados.

As falhas intermediárias foram corrigidas antes dessa execução final: imports usados pelo runner Node, expectativas antigas de conclusão em lote/número de sequência, fixture de pico que encerrava a última rota e área útil da montagem mobile. Os testes de densidade foram preservados. Não foram adicionados retries ou removidas proteções.

## Inspeção no navegador integrado

Servidor de produção local da worktree em `http://127.0.0.1:3010`, sem encerrar servidores de outras tarefas. Desktop 1280×800/1440×900 e mobile por redimensionamento em 390×844. Fluxo real de cliques com dados fictícios: registrar falha de endereço, consultar a Central, liberar nova tentativa, executar a parada seguinte e reencontrar o pedido original. Também foram verificadas ativação explícita do Web Audio, silenciamento e navegação para rotas com foco e cabeçalho persistente.

Logs error/warn vazios; captura CDP sem exceções Runtime, Network.loadingFailed ou HTTP ≥400, sem truncamento. O Playwright complementa a emulação mobile e cobre 320/375/390/1280/1440, foco/teclado, observações longas, vazio, um pedido, pico, timeout, decisões e som instrumentado. Contar osciladores comprova execução/deduplicação, não volume ou conforto acústico em um aparelho físico.

Não há frame Figma aprovado para esta tela. Foram usados o design system atual e o raio minimalista. Nenhuma edição no Figma foi realizada.

## Capturas e densidade

Capturas PNG reais estão em [screenshots/delivery-occurrences](screenshots/delivery-occurrences/). Data de relógio fixa e fictícia: 12/10/2026, 15h em America/Sao_Paulo; `reduced-motion` ativado na captura. [metrics.json](screenshots/delivery-occurrences/metrics.json) registra os números completos e ausência de erros.

| Viewport | Pedidos completos no pico | Paradas completas na montagem | Rodapé de atribuição |
| --- | ---: | ---: | --- |
| 1280×800 | 6 | 3 | acessível |
| 1440×900 | 8 | 6 | acessível |
| 320×844 | 4 | 1 | acessível; conferência ampliada disponível |
| 375×844 | 4 | 3 | acessível |
| 390×844 | 4 | 3 | acessível |

Não houve rolagem horizontal nesses cinco viewports. A conferência ampliada da montagem continua disponível para listas extensas e telas muito estreitas, com seus testes existentes preservados.

Exemplos: [alerta desktop](screenshots/delivery-occurrences/alert-1280.png), [Central 320px](screenshots/delivery-occurrences/center-320.png), [rota destacada mobile](screenshots/delivery-occurrences/routes-390.png), [próxima entrega](screenshots/delivery-occurrences/courier-next-390.png), [formulário com relato e observações](screenshots/delivery-occurrences/courier-failure-390.png), [retorno](screenshots/delivery-occurrences/courier-returning-390.png), [prazo crítico](screenshots/delivery-occurrences/critical-390.png), [timeout no histórico](screenshots/delivery-occurrences/timeout-history-390.png) e [múltiplas pendências](screenshots/delivery-occurrences/multiple-center-390.png).

## Preservação

Os seis arquivos anteriores do checkout principal foram comparados por SHA-256 antes e depois: package.json, package-lock.json, supabase/.gitignore, supabase/config.toml, .env.local e imagem original em public/brand. Todos permaneceram idênticos. Nenhum conteúdo de credencial foi exposto.

O diff da feature não altera dependências, autenticação, banco, migrations, Supabase, marca ou motores de otimização/agrupamento. A validação de produto usa somente mocks e estado fictício. Nenhum merge, auto-merge ou deploy foi executado.

## Revisão independente e correções

O subagente nativo `rpmdelivery_visual_critic` foi invocado sem histórico do Builder, com `sandbox=read-only` e `approval=never`. Primeira sessão: coordenador `01a13568-075c-7df1-8b6a-a4fa39800822`, filho `01a13568-6bc1-7291-8a04-859fe814d5ba`, role nativo confirmado nos metadados. [Relatório inicial integral](delivery-occurrences-visual-review-initial.md).

Os três P2 foram corrigidos pelo Builder:

- Hover da aba selecionada mantém fundo escuro e texto branco, com regra específica.
- Identificação da próxima entrega fica fora da área rolável, com rótulo visível no mobile e foco sem deslocamento. O aviso de prazo urgente separado aparece quando corresponde a outro pedido; o prazo do pedido atual permanece na própria entrega.
- Referência, observação e relato integral, inclusive motivos diferentes de “Outro”, ficam antes das decisões. Histórico e metadados secundários continuam progressivos.

A rechecagem do Builder encontrou ainda a Central reabrindo no histórico após uma nova ocorrência. O fechamento agora restaura Pendentes. Um E2E cobre o fluxo completo e os três P2 em 320/375/390/1280/1440. Outro cobre Web Audio ausente ou bloqueado; a instrumentação também verifica novas ocorrências com som desligado, além do histórico sem replay.

As sete capturas citadas nos P2 iniciais foram preservadas em [before-review](screenshots/delivery-occurrences/before-review/). As capturas na raiz são da versão corrigida. O relatório inicial corresponde ao commit `0e5fe18`; ele não deve ser interpretado como revisão dessas imagens novas.

O relatório independente final e o resultado do CI são vinculados na PR; suas observações não são substituídas por este relatório do Builder. O revisor inicial não teve acesso ao IAB e não contornou a recusa do Chrome; usou screenshots e código. Nenhuma aprovação automática foi dada.
