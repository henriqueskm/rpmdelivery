# RPM-SEC-GPS-001 — Isolamento de GPS entre lojas

Proposta Draft, baseada na main `2ad18ec76b1c40f766086aeb42c63fc14c5b22b2`.
Migration: `20261015092344_courier_gps_read_isolation.sql`, gerada pela CLI local.
**Não aplicada ao Supabase.** Projeto de referência: RpmDelivery / yyfbpmppdszmvhcruoyb.

## Causa e correção

O grant SELECT de tabela em couriers incluía last_latitude, last_longitude e
location_updated_at. A helper can_view_courier aceitava qualquer linha de vínculo,
independentemente de status. Uma loja com vínculo REJECTED conseguia ler a posição
global do motoboy operando em outra loja. A política de courier_locations já
negava o GPS da rota alheia, mas não protegia esse caminho alternativo.

A migration retira SELECT de tabela de PUBLIC/anon/authenticated e grants
explícitos das três colunas GPS. Authenticated recebe somente id, user_id,
motorcycle_model, motorcycle_plate, motorcycle_color, created_at e updated_at.
Não cria view/RPC nova nem copia coordenadas para uma projeção pública. Um guard
aborta a transação se existir permissão GPS herdada de outro papel, em vez de
alterar esse papel silenciosamente. Defaults e service_role permanecem iguais.

can_view_courier preserva o próprio cadastro e aceita vínculo ACTIVE para membro
ativo da loja. PENDING permite leitura de cadastro por OWNER/MANAGER para
conferência/aprovação, coerente com courier_invites_select_managers. OPERATOR
não gerencia convites nem passa a poder aprovar vínculos. REJECTED/SUSPENDED e
membership inativo não concedem leitura de cadastro alheio. can_view_profile
reutiliza essa regra para o ramo de perfil do motoboy, preservando self/equipe.

O enum atual é PENDING/ACTIVE/SUSPENDED/REJECTED. **INACTIVE não existe** e não foi
adicionado. Os testes cobrem sua rejeição pelo enum, SUSPENDED e membership
active=false. O próprio motoboy continua lendo seu cadastro/perfil em qualquer
estado de vínculo, sem os campos GPS globais.

## Matriz antes/depois

Identidade = sete colunas cadastrais acima; nome/telefone/foto vêm de profiles,
com sua própria RLS. Antes decorre da política anterior; o caso REJECTED foi
reproduzido antes da correção, sem dados reais.

| Ator/contexto | Identidade/perfil antes | Identidade/perfil depois | GPS global depois |
|---|---|---|---|
| Membro ativo, vínculo ACTIVE | Sim | Sim | Negado |
| OWNER/MANAGER ativo, vínculo PENDING | Sim | Sim, para aprovação | Negado |
| OPERATOR, vínculo PENDING | Sim | Não | Negado |
| Membro ativo, vínculo REJECTED/SUSPENDED | Sim | Não | Negado |
| Membership da loja inativo | Não por esse vínculo | Não | Negado |
| Sem vínculo | Não | Não | Negado |
| Próprio motoboy | Sim | Sim | Negado |
| Anon | Sem grants de tabela | Sem grants de colunas | Negado |
| Service_role | Privilégios anteriores | Iguais | Nenhuma ampliação |

## Consumidores e localização por rota

Inventário do repositório, sem mudanças no aplicativo:

- Não há consulta SDK a public.couriers no frontend/services/lib/hooks. A central
  usa DemoCourier em memória, não linhas dessa tabela.
- create_courier_profile lê id/user_id e grava cadastro sob owner postgres;
  assinatura, corpo, ACL e idempotência não mudam. create_restaurant não muda.
- Helpers private.current_courier_id/is_active_restaurant_courier,
  courier_owns_route/courier_has_active_delivery/courier_has_active_order e as
  helpers de perfil/cadastro acessam campos de identidade sob owner postgres.
- Não há view de couriers nem RPC que retorne seus campos GPS ou a linha inteira.
  As RPCs de onboarding retornam UUID. Não foi criado endpoint geográfico novo.
- As políticas de couriers/profiles continuam chamando helpers; somente dois
  corpos mudam. Grants de helpers, demais RPCs e RLS ficam iguais.

private.can_view_route_location foi revisada e permanece inalterada: verifica
o par route_id/courier_id e autoriza o próprio motoboy ou membro ativo do
restaurante daquela rota. courier_locations referencia routes(id,courier_id);
routes referencia o mesmo courier/restaurante em courier_shifts. As constraints
compostas impedem trocar o turno/restaurante associado sem respeitar essas chaves.

O teste mantém um motoboy ACTIVE em A e B, mas ON_ROUTE apenas em A, com turno
encerrado e rota histórica em B. B não vê o ponto atual de A; continua podendo
ver os pontos históricos de sua própria rota. Não se alteram retenção/histórico,
revogação de pedidos atribuídos, estados PREPARING/ON_ROUTE/RETURNING ou início
manual. A futura escrita GPS ainda precisará validar identidade/estado/turno;
ninguém ganha INSERT/UPDATE nesta proposta. Os outros P2 da auditoria ficam fora.

## Compatibilidade PostgREST

SELECT * passa a falhar para authenticated, inclusive para o próprio motoboy,
com 42501. SELECT explícito de cadastro funciona com RLS. Não há mascaramento
silencioso nem retorno parcial de coordenadas. PostgREST retorna 403 para JWT
authenticated e 401 para anon; os testes confirmam filtros, ordenação e embedding
por profiles sem bypass das permissões. A migration notifica reload do cache.

Integrações externas/não versionadas que usem select=* precisam migrar para:
`select=id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color,created_at,updated_at`.
Esse é um risco de compatibilidade deliberado, necessário para impedir exposição
em consultas gerais. Uma revogação por coluna sem remover SELECT de tabela não
resolveria o problema. Referência: [Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security).

## Evidências e reprodução

`tests/sql/run-courier-gps.sh` aceita somente opt-in explícito, loopback,
banco vazio rpmdelivery_gps_test e PostgreSQL 17. Bootstrap administrativo e testes
de usuário são separados: sete logins authenticated e um anon têm conexões próprias,
sem SUPERUSER/BYPASSRLS/CREATEROLE. Nenhuma credencial real é necessária.

1. Executa as nove migrations anteriores em banco descartável e popula fixtures.
2. Reproduz vazamento de GPS/perfil via vínculo REJECTED antes da correção.
3. Adiciona grants GPS por coluna para provar que a migration também os remove.
4. Aplica somente localmente a proposta e testa 28 combinações (sete atores ×
   quatro estados), coordenadas explícitas, wildcard, perfil próprio, membro
   inativo, duas lojas, GPS da rota e RPC idempotente do motoboy.
5. Confere snapshots de defaults, service_role, sequência, políticas, grants e
   RPCs fora do escopo; executa rpc-rls.sql e reaplicação local controlada.
6. Injeta grant herdado sintético, exige falha no guard, remove a fixture e
   confere os snapshots novamente.

`tests/sql/courier-gps/postgrest.mjs` usa JWTs HS256 fictícios, conexão do gateway
authenticator NOINHERIT e aceita somente HTTP loopback com opt-in. Com PostgREST
16.1 e PostgreSQL 17.11 locais, os quatro estados passam em **220 requisições
funcionais**: identidade, GPS explícito, wildcard, filtro/ordenação, embedding,
anon e rota autorizada. A fixture auth.uid aceita os claims do gateway; não
simula GoTrue/signup hospedado. Não é promessa de homologação completa do Supabase.

O workflow Courier GPS security reproduz esses testes em PostgreSQL 17
descartável no CI, com privilégio contents:read, timeout, sem secrets nem banco
remoto. O binário PostgREST 16.1 vem da release oficial do GitHub e seu SHA-256
é conferido antes da execução, evitando quotas do registro ECR compartilhado.
Os artefatos contêm somente
dados sintéticos e duram sete dias. Nenhuma dependência runtime foi adicionada.

Validação local: npm ci; verify aprovado; 74 unitários; SQL/PGlite legado
aprovado; audit de produção 0; Playwright 132 testes desktop/mobile, retries=0,
todos aprovados; diff check aprovado. O E2E usa mocks e não comprova RLS.
QA integrado: preview demonstrativo e navegação Motoboys em 1280×800 e 390×844,
console sem erros/avisos capturados; network é coberta pelo Playwright. Sem
mudança visual ou comparação Figma necessária; Visual Critic não se aplica.

## Aplicação futura — somente após revisão/autorização

Confirmar consumidores externos, grants herdados e identidade do projeto; executar
homologação descartável com PostgREST e sessões sintéticas; obter autorização
separada para aplicar a migration. Após eventual aplicação, conferir somente por
metadados as três colunas negadas, sete colunas cadastrais autorizadas, helpers/RPCs,
RLS, service_role e histórico. Não criar dados de prova em produção. Se o guard
falhar, interromper e revisar a herança, sem reabrir SELECT de tabela.

Nesta tarefa não houve conexão ao banco remoto, alteração de Auth/Storage,
aplicação hospedada, db push, acesso a EstoqueNK ou correção da sequência GPS.
