# QA — prazos e retirada

Base: main `632b61df7e7f2fc3a28f48dbf5036611cfbdff59`. Dados fictícios, sem credenciais ou comunicação operacional remota.

## Comparação visual

Capturas em [screenshots/deadlines-pickup](screenshots/deadlines-pickup), medidas em [measurements.json](screenshots/deadlines-pickup/measurements.json). Antes: implementação da PR #10 equivalente à main; depois: esta feature. Ambos com fonte carregada, DPR 1, relógio congelado em 12/10/2026 15:00 no fuso America/Sao_Paulo, cenário de mil pedidos, primeiros vinte selecionados, sem rolar listas. Contam apenas linhas inteiras dentro do painel e viewport. Capturas foram produzidas por Playwright via controles da interface, sem injeção de estado.

| Viewport | Pedidos antes → depois | Montagem antes → depois | Conferência ampliada antes → depois |
| --- | --- | --- | --- |
| 1280×800 | 6 → 6 | 3 → 4 | 6 → 6 |
| 1440×900 | 8 → 8 | 7 → 7 | 8 → 8 |
| 320×844 | 3 → 3 | 2 → 2 | 4 → 4 |
| 375×844 | 5 → 4 | 3 → 3 | 5 → 6 |
| 390×844 | 5 → 4 | 3 → 3 | 6 → 6 |

A barra inferior e o horário na mesma linha atendem à escolha do usuário. No pico mobile 375/390, a linha adicional de prazo custa um pedido completo visível; nomes, bairros, observações integrais e alvos de 44px foram preservados. Os painéis mantêm altura e rolagem próprias. A conferência ampliada mantém o seletor e a atribuição disponíveis.

A visão do motoboy com vinte paradas mantém estado, prazo urgente e ação de início fora da lista rolável: área de lista de 352px em 320/375 e 369px em 390, ação inteira visível, sem overflow horizontal. Datas de outro dia permanecem explícitas; no mobile o texto de atraso pode ocupar a linha anterior para conservar barra e horário juntos.

Exemplos:

- [Desktop antes](screenshots/deadlines-pickup/before-1280-desktop.jpg) / [depois](screenshots/deadlines-pickup/after-1280-desktop.jpg).
- [Mobile antes](screenshots/deadlines-pickup/before-390-orders.jpg) / [depois](screenshots/deadlines-pickup/after-390-orders.jpg).
- [Motoboy aguardando](screenshots/deadlines-pickup/after-390-driver-waiting.jpg), [liberado](screenshots/deadlines-pickup/after-390-driver-ready.jpg), [em rota](screenshots/deadlines-pickup/after-390-driver-on-route.jpg).
- [Texto longo em 320px](screenshots/deadlines-pickup/after-320-worst-orders.jpg), [editor](screenshots/deadlines-pickup/after-320-deadline-editor.jpg), [vazio](screenshots/deadlines-pickup/after-390-empty.jpg) e [novo pedido](screenshots/deadlines-pickup/after-390-new-order.jpg).

## Verificação funcional do Builder

Navegador integrado: desktop 1280×800 e 1440×900, mobile 320/375/390×844. Cadastro fictício com horário original anterior, edição de promessa, estados verde/laranja/vermelho e vencido, múltipla seleção, leitura antes de liberar, liberação sem iniciar, composição que invalida, início manual e bloqueio posterior. Vazio, um pedido, textos longos e pico também inspecionados nas capturas/E2E.

Console integrado sem erros/warnings; CDP sem exceções, falhas de carregamento ou HTTP inesperado 4xx/5xx na janela final de QA, sem perda/paginação pendente de eventos. Não houve requisição HTTP externa no preview. E2E também verifica ausência de mutações e acesso remoto nas operações demonstrativas.

Instalação limpa com npm ci; verify (lint, TypeScript, build), 18 unitários, instalação SQL e SQL/PGlite locais aprovados. Audit de produção: zero vulnerabilidades. Audit completo: cinco alertas altos dev preexistentes, documentados no contrato; sem mudança de dependências ou gate.

Foi observada uma falha intermitente no teste preexistente de debounce do onboarding durante uma execução local (`Rua` disparada antes da segunda entrada). O arquivo de onboarding e retries globais não foram alterados. A repetição completa passou com 62 testes; o resultado final e o CI constam na PR. Falhas de densidade durante desenvolvimento foram corrigidas no CSS sem reduzir os critérios do teste.

## Limitações

Sem frame Figma aprovado, sem aparelho físico/teclado virtual/safe areas/gestos, sem auditoria WCAG completa. Auth permanece coberto pelos mocks existentes; esta tarefa não testa nem modifica Supabase real. Revisão independente nativa é documentada separadamente; resultados do Builder não equivalem a aprovação do Critic ou humana.
