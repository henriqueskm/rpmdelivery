# Central de alertas e ocorrências — protótipo

Relacionada à Issue #12. Base: main `3face6d07082a5e977ab2cce1a23383983a02aa5` (PR #15).
Tudo opera em memória com clientes, coordenadas, atores e entregas fictícios. Recarregar restaura o cenário. Nenhuma chamada operacional ao Supabase, Mapbox, WhatsApp, SMS ou push foi adicionada.

## Uso

Abra `/preview/operacao`. O cabeçalho mostra as pendências mesmo quando o aviso foi dispensado. “Ocorrências” abre a fila de decisões; “Acompanhar rotas” abre a aba no mobile e posiciona foco/rolagem na seção no desktop, destacando a rota associada.

Em Cenário, selecione os exemplos “Ocorrências”: nenhuma, uma nova, simultâneas, cliente não localizado, endereço, nova tentativa, retorno, cancelamento, prazo expirado, concluir demais, 1.000 pedidos e textos longos. Os cenários “uma nova” e “simultâneas” aguardam uma ação explícita nos controles de teste ou na visão do motoboy; não fingem um evento novo ao carregar fixtures históricas.

Na visão do motoboy de uma rota **ON_ROUTE**, execute cada próxima entrega com “Entregue” ou “Não consegui entregar”. A falha exige um dos quatro motivos documentados. “Outro motivo” exige relato com pelo menos três caracteres; relatos têm limite demonstrativo de 500 caracteres.

O aviso novo reúne a rajada numa única área de atenção. Mostra primeiro pedido, rota, motoboy, motivo e prazo de decisão. Não rouba o foco do formulário do motoboy. Fechá-lo devolve o foco ao indicador e mantém a pendência. A Central oferece nova tentativa e retorno; cancelamento e histórico ficam nos detalhes. Endereços, referências e observações integrais permanecem disponíveis.

## Domínio e transições

`model.ts` mantém atribuição manual/automática e retirada. `route-execution.ts`, `route-progress.ts`, `issue-reducer.ts` e `issue-events.ts` isolam execução, decisões e eventos, sem React, relógio interno ou I/O.

| Entidade | Informação |
| --- | --- |
| Entrega | WAITING, ASSIGNED, ON_ROUTE, NEXT, ATTEMPT_FAILED, RETURN_TO_STORE, DELIVERED, CANCELLED |
| Ocorrência | PENDING/CLOSED, tentativa, motivo, relato, ator, horário, deadline fixo e resolução |
| Recibo visual | viewedAt/dismissedAt separados do estado da ocorrência |
| Evento | ID estável, tipo, timestamp, ator/STORE/COURIER/SYSTEM e referências |
| Rota | orderIds imutável depois do início; retryOrderIds separado para execução |

Os comandos adicionados são `delivery-complete`, `delivery-failure`, `issue-decide`, `delivery-cancel`, `issue-timeout-config`, `alert-view`, `alert-dismiss` e `issues-tick`. `start` e `arrive` usam o mesmo ator demonstrativo atribuído; a interface passa o timestamp explicitamente. O comando legado `finish` não conclui entregas sem executá-las.

- Só o motoboy atribuído, com vínculo ativo e turno ON_ROUTE, executa a **próxima** entrega e a tentativa esperada. Comandos para outra parada, ator incorreto, timestamp inválido ou anterior aos eventos da rota são rejeitados.
- Uma falha marca ATTEMPT_FAILED, cria uma ocorrência com ID por pedido/tentativa e registra evento. A execução segue as primeiras tentativas restantes.
- Nova tentativa fecha a pendência e coloca o pedido numa fila de execução após as primeiras tentativas restantes. A sequência originalmente planejada não muda. Uma segunda falha gera outra ocorrência.
- Retorno marca RETURN_TO_STORE; cancelamento marca entrega e pedido CANCELLED. Permanecem visíveis e são pulados na execução. Retorno físico não equivale a entrega ao cliente: o estado comercial DELIVERING não é falsamente convertido em DELIVERED.
- Decisões da loja exigem o ator `demo-store-operator`. Entregas terminais e ocorrências encerradas não admitem nova tentativa.
- IDs de comandos consumidos e de eventos evitam efeitos duplicados. Recibos de aviso também são idempotentes.
- PREPARING, reserva FIFO, liberação/revogação e bloqueios ON_ROUTE são preservados. Atribuir, liberar ou cancelar a liberação não executa entregas, tracking ou notificações.

## Timeout e retorno

O prazo inicial é **10 minutos**, ajustável de 1 a 60 na demonstração. Cada falha captura seu próprio `decisionDeadline`; mudar a configuração vale somente para ocorrências futuras.

Uma fonte compartilhada de horário já existente atualiza a interface e envia `issues-tick`. Não há um timer por pedido. Sem transição, o reducer retorna a mesma referência, evitando invalidar propostas de planejamento a cada segundo.

No instante `now >= decisionDeadline`, o timeout prevalece mesmo que uma decisão da loja chegue antes do tick na mesma fronteira. A entrega vira RETURN_TO_STORE; a ocorrência fecha com “Prazo de resposta encerrado” e evento SYSTEM. Uma decisão válida antes do limite continua válida.

Se nenhuma primeira tentativa/nova tentativa liberada resta, as falhas ainda pendentes são convertidas em RETURN_TO_STORE imediatamente, com motivo “Demais entregas encerradas”. Assim o motoboy não fica preso esperando. Isso também vale para falha na única/última entrega.

Todos os pedidos DELIVERED/CANCELLED/RETURN_TO_STORE fazem rota e turno passarem para RETURNING. Somente o próprio motoboy confirma o retorno; ele entra no final da fila AVAILABLE. Eventos e estados terminais são preservados.

## Som e movimento

Som desativado por padrão e sem persistência entre páginas/cenários. O contexto Web Audio só é criado e retomado no clique “Ativar som de alertas”; falhas de ativação mantêm os avisos visuais. “Silenciar alertas” cancela sinal pendente e suspende o contexto. Não há arquivo de áudio externo, serviço ou biblioteca adicional.

O detector estabelece os IDs históricos como baseline. Só novas ocorrências ainda pendentes notificam; renders, relógio, reabertura da Central e fixtures antigas não repetem sinais. Uma janela de 150ms agrupa rajadas; intervalo mínimo de dois segundos evita tempestade de sons. Todos os avisos continuam na fila mesmo quando sons próximos são agrupados/suprimidos.

O sinal local tem duas notas suaves (660/880Hz, aproximadamente 290ms). A entrada do aviso usa apenas opacidade e deslocamento de 4px por 160ms, sem flashes ou loops. `prefers-reduced-motion: reduce` remove a transição. Verde, amarelo, vermelho e cinza sempre acompanham texto; coral permanece na ação principal.

[Boas práticas Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) e [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume) orientam ativação e controles. Testes instrumentados comprovam disparos, opt-in e deduplicação, não qualidade acústica em caixas reais.

## Integração futura — não implementada

O protótipo não é controle de autorização ou concorrência de produção. Antes de conectar dados reais:

1. Validar identidade e vínculo do restaurante/motoboy no servidor, tenant em todas as entidades e RLS específica; nunca confiar no actorId enviado pelo browser.
2. Implementar comandos transacionais com versão esperada, bloqueio/CAS, unicidade de ocorrência ativa por entrega e idempotency key. Preservar a sequência auditável e fila de nova tentativa separada.
3. Usar relógio do servidor e worker/scheduler para timeout mesmo sem abas abertas. Serializar decisões e expiração com a mesma regra de fronteira; concluir retorno sem depender de render ou do browser do restaurante.
4. Armazenar eventos append-only com ator verificado, razão, horário, correlação e retenção/privacidade. Definir explicitamente o destino comercial de pedidos retornados, sem reintroduzi-los automaticamente no despacho.
5. Sincronizar clientes por versão/cursor e snapshot inicial. Separar replay histórico de evento novo, recibos por operador/dispositivo e preferências locais de áudio. Deduplicar reconexões e controlar quotas/rajadas.
6. Validar retorno físico, turno, FIFO e ausência de outra rota ativa na mesma transação. Tracking e notificações reais continuam uma etapa separada, com outbox e autorização própria.

Não foram alterados schema, migrations, Supabase, autenticação, dependências ou produção. Os motores de otimização e agrupamento permanecem os mesmos.
