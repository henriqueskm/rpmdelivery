# RPM-SEC-GPS-002 — Privilégios da sequência GPS

Proposta Draft, baseada na main ab2be68a9769455d2c64ad5a990b3598c300362c
(merge da PR #19). **Não aplicada ao Supabase.**

Migration forward-only:
`20261015172010_courier_gps_sequence_privileges.sql`, criada com
`supabase migration new courier_gps_sequence_privileges`.

## Causa e escopo

A sequência `public.courier_locations_id_seq` pertence a
`courier_locations.id bigint GENERATED ALWAYS AS IDENTITY`.
Os defaults amplos vigentes quando a tabela foi criada concederam USAGE,
SELECT e UPDATE a anon/authenticated. O hardening de defaults da PR #17
protege objetos futuros, mas não revoga grants de sequências preexistentes.

Mesmo sem INSERT na tabela, esses grants permitem avançar/resetar a sequência
e observar o valor da sessão. Isso é independente das políticas RLS da tabela.

A migration revoga somente os três privilégios dessa sequência de
PUBLIC/anon/authenticated. Não faz ALTER SEQUENCE, nextval, setval, INSERT,
UPDATE de dados, alteração de IDENTITY, tabela, RLS ou grants de outros papéis.
Postgres e service_role mantêm exatamente seus grants anteriores.

Antes de revogar, uma precondição valida tipo, proprietário postgres e vínculo
à coluna IDENTITY ALWAYS esperada. Depois da revogação, o guard verifica os
privilégios efetivos e caminhos de SET ROLE, inclusive NOINHERIT.
Permissão residual gera `RPM_GPS_SEQUENCE_RESIDUAL_PRIVILEGE` / 42501 e rollback
integral; nenhum outro papel ou membership é modificado para contornar o erro.
A migration não protege contra concessões administrativas futuras: mudanças
posteriores de grants/memberships também exigirão revisão.

## Inventário e consumidores

Análise das dez migrations anteriores, funções/serviços versionados, arquitetura,
schema e snapshot de catálogo coletado após a PR #19 em 15/10/2026:
- ACL anterior: postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU.
- PUBLIC sem grant explícito no snapshot; anon/authenticated sem outro papel
  efetivamente herdado. A fixture adiciona grant PUBLIC para provar sua remoção.
- Dependência interna da sequência para courier_locations.id é preservada.
- Não há RPC implementada que grave GPS ou consuma diretamente essa sequência;
  create_restaurant/create_courier_profile usam UUID e permanecem inalteradas.
- O frontend utiliza estado operacional demonstrativo em memória, sem chamadas
  nextval/currval/setval ou gravações courier_locations.
- Não há view ou endpoint novo. Consumidores externos não versionados continuam
  desconhecidos e precisam ser conferidos antes de aplicação hospedada.

Não houve consulta nem aplicação ao PostgreSQL remoto nesta tarefa. O snapshot
anterior é referência histórica; uma futura aplicação exige novo preflight
read-only no projeto RpmDelivery yyfbpmppdszmvhcruoyb.

## Matriz antes/depois

U = USAGE, S = SELECT, W = UPDATE. Valores são efetivos, incluindo herança.

| Papel | Antes (snapshot anterior) | Depois (PostgreSQL 17 descartável) |
| --- | --- | --- |
| PUBLIC | Sem grant explícito | Sem grant; grant sintético removido |
| anon | U/S/W | Nenhum |
| authenticated | U/S/W | Nenhum |
| postgres | U/S/W | U/S/W, ACL original |
| service_role | U/S/W | U/S/W, ACL original |
| Papel herdado inesperado | Não observado | Guard aborta, sem alterar o papel |
| NOINHERIT com SET ROLE para papel autorizado | Não observado | Guard aborta |

[nextval requer USAGE ou UPDATE; currval requer USAGE ou SELECT; setval requer
UPDATE](https://www.postgresql.org/docs/17/functions-sequence.html).
A revogação não substitui autorização de INSERT/RPC e RLS. As futuras gravações
GPS devem validar identidade real do motoboy, rota/turno, restaurante, estado,
coordenadas, rate limit, idempotência e concorrência no backend. Esta PR não
cria esse comando nem libera escrita direta ao browser. Um comando privilegiado
autorizado continuará gerando a IDENTITY como demonstrado pelos testes.

## Evidências e reprodução

`tests/sql/run-gps-sequence.sh` exige opt-in
RPMDELIVERY_DISPOSABLE_POSTGRES=1, host 127.0.0.1, banco vazio exclusivo
rpmdelivery_gps_sequence_test e PostgreSQL 17. Nenhuma credencial real é usada.
Reproduz as dez migrations anteriores, incluindo PR #19, e reutiliza fixtures
sintéticas de duas lojas, um motoboy e duas rotas.

O cluster usa bootstrap independente sequence_bootstrap e owner postgres.
O owner é rebaixado para NOSUPERUSER ao final; a migration é reaplicada por ele
e seus comandos são testados sem bypass de SUPERUSER. Service_role é um login
sintético NOSUPERUSER/BYPASSRLS, compatível com sua função privilegiada.

Cobertura nativa:
- Reprodução anterior: conexões diretas anon/authenticated executam
  nextval/currval/setval apesar da ausência de INSERT na tabela.
- Depois: os seis comandos são negados com 42501 por conexões próprias,
  sem uso de SET ROLE administrativo para simular usuário.
- Snapshot compara contador last_value/is_called, definição, owner, IDENTITY,
  dependências, dados sintéticos, funções completas (inclusive PR #19), grants
  de tabelas/colunas, constraints, roles/memberships, defaults e políticas.
- USAGE/SELECT/UPDATE herdados para cada papel: seis rejeições transacionais;
  ACL antes/depois do erro idêntica prova rollback também do REVOKE direto.
- Duas rejeições adicionais de NOINHERIT/SET ROLE.
- Reaplicação segura; RPCs/onboarding, leitura de cadastro e localização por rota
  da PR #19 continuam funcionais.
- Postgres e service_role executam nextval/currval/setval e INSERT autorizado
  com geração automática do ID, ambos NOSUPERUSER.
- Só os testes privilegiados finais avançam a sequência fictícia; a migration e
  as tentativas negadas preservam o contador.

A prova nativa local usa PostgreSQL 17.11, container sem rede externa, dados em
tmpfs, sem portas publicadas ou volumes antigos. Logs locais ignorados:
`playwright/.cache/gps-sequence/`.

PGlite é evidência complementar: aplica todas as migrations, verifica os mesmos
snapshots/ACLs, reaplicação e rollback do guard. Não substitui PostgreSQL 17.

O workflow `GPS sequence security` reproduz a prova em serviço PostgreSQL 17
descartável, contents:read, sem secrets/ambiente remoto, timeout de 10 minutos
e artefato exclusivamente sintético com retenção de sete dias.
O CI existente de PostgreSQL/PostgREST da PR #19 permanece inalterado.

## Validação e limites

Validação local: npm ci; verify (lint, tipos e build); 74 unitários;
SQL/PGlite; PostgreSQL 17 nativo; audit de produção zero vulnerabilidades;
Playwright desktop/mobile; git diff --check. Resultados finais e links de CI
ficam registrados na PR.

Na execução inicial do E2E com dois workers e zero retries, 130 passaram e dois
testes existentes falharam: Escape durante debounce do endereço e abertura da
montagem automática. Traces foram preservados localmente. A suíte foi repetida
com um worker (como no CI), sem modificar testes, produto ou retries globais;
o resultado completo dessa execução será informado na PR.

Cinco alertas de desenvolvimento preexistentes apareceram no npm ci; não foram
corrigidos/silenciados nem houve alteração de dependências/lockfile.
QA integrado: preview fictício em 1280×800 e 390×844, navegação da aba Motoboys
mobile e console sem erros/avisos capturados. Network/exceções cobertos pelos
E2E; não foi feita homologação Auth/Storage/Realtime hospedada.
Sem mudança visual, Figma e Visual Critic não se aplicam.

## Compatibilidade e aplicação futura

Chamadores que consomem diretamente a sequência como anon/authenticated passarão
a receber 42501. Isso é intencional. Nenhum consumidor versionado depende disso;
integrações externas precisam de inventário e migração para comando autorizado.
Se houver grants dependentes ou acesso herdado inesperado, interromper e submeter
diagnóstico ao Lead, sem CASCADE ou ampliação de permissões.

Antes de qualquer aplicação remota: autorização explícita separada, identidade do
projeto, backup validado, comparação de ACLs/role memberships, dependências,
dry-run exclusivo e SQL/HEAD revisados. Depois: conferir versão exata, ACLs
efetivas e invariância de IDENTITY/owner/RLS/PR19; nunca usar nextval/setval como
teste de leitura remoto, pois alteram estado e não são desfeitos por rollback.

Nenhuma migration foi aplicada ao Supabase nesta tarefa. Sem Auth, Storage,
Realtime, credenciais, dependências, produção, EstoqueNK, merge ou auto-merge.
