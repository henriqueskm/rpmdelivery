# Prazos prometidos e liberação de retirada — protótipo

Evolução da central da PR #10, baseada na main `632b61df7e7f2fc3a28f48dbf5036611cfbdff59`. Exclusivamente dados fictícios e estado em memória. Não implementa persistência, RPC, migration, RLS, tracking, notificações, Decisions nem otimização geográfica. Alertas sonoros, pop-ups e centro de ocorrências continuam no [backlog #12](https://github.com/henriqueskm/rpmdelivery/issues/12).

## Experimentar

Abra `/preview/operacao?scenario=demo` no localhost anunciado pelo servidor. O dashboard mantém autenticação/isolamento existentes; o preview público usa só fixtures. Recarregar ou trocar cenário restaura a demonstração.

1. Em Pedidos, **Padrão · 60 min** configura a promessa para novos cadastros. Pedidos já criados preservam suas próprias promessas.
2. Em Novo pedido, informe **Pedido feito em** e **Prazo prometido**. O horário original pode ser anterior ao cadastro. O formulário propõe o horário atual ao abrir, mesmo após permanecer muito tempo na página.
3. Clique em **Prazo** ao lado de um pedido (ou na barra da rota) para ajustar horário original/promessa. O limite sempre é `orderedAt + promisedMinutes × 60.000`; cadastro, atribuição e saída não reiniciam esse prazo. Pedidos entregues não são editáveis e aparecem como Entregue, sem declarar que cumpriram o prazo.
4. Atribua uma ou várias entregas: rota PREPARING, motoboy reservado, **Aguardando liberação**. Ele já pode conferir sequência, destinos, referências, observações e prazo mais urgente na visão separada demonstrativa, mas o início está bloqueado.
5. A loja toca uma vez em **Liberar retirada**, confirmando todos os pedidos daquela rota juntos. A rota continua PREPARING e aparece **Pronto para retirada**; nada é enviado ao cliente.
6. Só o motoboy atribuído pode tocar **Recolhi os pedidos · Iniciar rota**. O reducer exige liberação válida, pedidos atribuídos, vínculo ativo e turno adequado. ON_ROUTE bloqueia composição e sequência. Depois, retorno/fila seguem as regras anteriores.
7. Editar uma rota liberada para adicionar/remover/substituir pedidos invalida a liberação, inclusive substituição com a mesma quantidade. Reordenar o mesmo conjunto preserva a liberação e o motoboy vê a sequência planejada pela loja.

## Tempo e apresentação

| Informação | Representação da demonstração | Regra |
| --- | --- | --- |
| Prazo padrão do restaurante | `defaultPromiseMinutes`, inicial 60 | Só novos pedidos; faixa demonstrativa de 1–240 minutos inteiros |
| Horário original | `orderedAt`, milissegundos Unix | Válido, positivo, nunca posterior ao cadastro |
| Cadastro | `createdAt`, milissegundos Unix | Registrado no cadastro e preservado nas edições |
| Promessa própria | `promisedMinutes` | Snapshot do padrão ou override individual |
| Limite | Derivado de horário original + promessa | Não é ETA; sem previsão de chegada ou garantia de cumprimento |
| Liberação da rota | `pickupReleasedAt: number \| null` | Null ao atribuir; timestamp único ao liberar todos |

Contagem compartilhada por um único relógio do workspace, sem intervalos por linha. Ele lê o horário atual a cada segundo e ao retomar a página; não acumula ticks como tempo de negócio. O relógio e seus listeners são encerrados ao sair. As fixtures ancoram no primeiro horário do workspace, sem reancorar a cada tick. SSR/hidratação usa um estado de carregamento breve até o relógio local estar disponível, evitando timestamps divergentes.

Restante é arredondado para cima em minutos; vencido mostra minutos completos de atraso, com “Vencido agora” no primeiro minuto. A barra fica abaixo das informações do pedido, com restante e horário limite na mesma linha. Ela diminui proporcionalmente ao prazo prometido: verde acima de dez minutos, laranja entre cinco e dez, vermelho nos últimos cinco minutos e após vencer. **Próximo** indica até dez minutos restantes; **Crítico** indica até cinco; **Vencido** começa no limite. Textos e cores distinguem estados; os números usam tabular figures. Não há anúncio aria-live por segundo, reordenação automática ou previsão de trajeto. O pedido mais urgente é somente o menor limite entre entregas ainda não concluídas; não muda a sequência.

Horários de entrada/exibição usam o fuso do dispositivo nesta demonstração. Limites de outro dia incluem data e hora, e o campo `time.dateTime` contém ISO completo. Datas locais inexistentes/normalizadas indevidamente e valores não finitos são rejeitados. O backend futuro precisará definir fuso do restaurante e relógio autoritativo, sem confiar no relógio do navegador.

Configuração do padrão e editor ficam em dialogs acessíveis. A seleção do pedido e a edição do prazo têm controles separados. A visão do motoboy mantém estado, prazo urgente e ação de início fora da rolagem das paradas, inclusive com vinte pedidos. A ação bloqueada continua visível; alvos mobile têm pelo menos 44px.

## Contrato futuro do backend — não implementado

- Restaurante: `default_delivery_promise_minutes` e fuso IANA definido; faixa/política de promessa configurável e revisada antes da integração real.
- Pedido: `ordered_at`, `created_at`, `promised_minutes` e limite derivado/calculado pelo servidor. UTC/timestamptz no armazenamento; conversão explícita do fuso na entrada/saída. Auditar alteração de promessa/horário por ator e preservar cadastro. Validar limites, passado/futuro e consistência transacional.
- Rota: `pickup_released_at`, `pickup_released_by`, `composition_version` e versão liberada. PREPARING continua o status até início pelo motoboy; liberação é informação separada, não enum de rota nem preparo por pedido.
- Liberar: membership ativo e papel autorizado da loja no mesmo restaurante; rota PREPARING, turno/vínculo válidos, conjunto atual não vazio e entregas atribuídas. Uma transação libera todos e registra ator/horário/versão; idempotência não muda o timestamp original.
- Editar: bloquear a rota, validar exclusividade das entregas e versão esperada. Mudança no conjunto incrementa versão e limpa liberação/ator; mudança só de sequência mantém a liberação. Resolver corrida com início de rota sem updates livres do frontend.
- Iniciar: identidade autenticada derivada do servidor, courier dono da rota, mesmo restaurante/turno, vínculo ACTIVE, PREPARING, liberação vigente para a composição atual e entregas válidas. Transação impede início concorrente, composição/ordem após saída e segunda rota ativa. Nenhum `actorId` ou flag do cliente é prova de autorização.
- Leitura do motoboy: RLS/endpoint restrito às próprias rotas/entregas, inclusive PREPARING; não abrir dados de outras lojas/clientes. Atualizações de composição/liberação devem chegar à visão dele e invalidar comandos obsoletos.
- Atribuição/liberação não disparam tracking nem notificações de saída. Futuro evento de início/outbox ocorre somente após a transação de início autorizado, nunca antes. Esta PR não emite evento externo algum.

O reducer é demonstração das regras, não uma fronteira de segurança de produção. A liberação também compara um snapshot do conjunto de pedidos para rejeitar uma confirmação obsoleta; o backend deve usar versões/locks, não depender de arrays enviados pelo browser.

## Validação e limitações

Unitários cobrem cálculo original, default/override, fronteiras, entradas inválidas, urgência sem reordenação, liberação/início, ator errado, trocas de composição e versões obsoletas. E2E usam relógio controlado para atualizar vários contadores sem sleeps de parede e preservam smoke/Auth/fluxos/densidade anteriores. Cenários demo, vazio, um pedido, textos longos e pico continuam disponíveis.

QA usa emil-design-eng, mobile-native, break-ui, rpmdelivery-qa e revisão React; Visual Critic nativo independente/read-only após implementação. Capturas, medições e relatório estão registrados na PR com HEAD correspondente. Não existe frame Figma aprovado. Emulação não valida aparelho físico, teclado virtual, safe areas, gestos ou zoom nativo; não é auditoria completa WCAG.

Audit de produção é gate e retorna zero. Audit completo mantém cinco alertas altos preexistentes exclusivamente de desenvolvimento, no caminho eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces; nenhuma dependência, override ou regra CI foi alterada para silenciar alertas.
