# PR 1A — Privilégios padrão PostgreSQL

Base: main `74891494ed5128ed87eae2d7bfae15098ee97890`. Referência de identidade
para eventual aplicação: **RpmDelivery / yyfbpmppdszmvhcruoyb**, nunca EstoqueNK.
O desenvolvimento inicial não consultou nem modificou o Supabase remoto.
A reconciliação posterior confirmou somente por leitura o histórico e o default
global após a aplicação da PR18 pelo Lead. Não usa CLI administrativo remoto,
db push/reset ou dados de clientes. Não aplica o hardening.

## Migration proposta

`20261015013358_postgres_public_default_privileges_hardening.sql` é forward-only.
Altera exclusivamente defaults de objetos criados futuramente por **postgres**
em **public**. Revoga ALL de tabelas, sequências e rotinas para PUBLIC, anon e
authenticated. ALL inclui MAINTAIN em PostgreSQL17, além de TRUNCATE, REFERENCES
e TRIGGER; nas sequências inclui UPDATE (nextval/setval).

Não muda objetos existentes, suas ACLs/políticas, RPCs, registros, outros schemas,
outros proprietários ou grants de service_role. Não concede nenhuma permissão.
Permissões futuras necessárias deverão ser opt-in, por objeto e na mesma
transação de sua criação. Tabelas expostas precisam também de RLS/políticas.

## Limite importante: privilégios globais

Defaults por schema são adicionados aos globais. Uma revogação em public não
remove um grant global, inclusive o EXECUTE implícito de PUBLIC para funções.
Uma migration contendo somente `IN SCHEMA public REVOKE EXECUTE` não resolve
esse caso. Consulte [ALTER DEFAULT PRIVILEGES PostgreSQL17](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

A migration verifica os defaults globais efetivos de postgres para tabelas,
sequências e rotinas, considerando PUBLIC e grants herdados por anon/authenticated.
Se encontrar qualquer acesso incompatível, interrompe com
`RPM_DEFAULT_PRIVILEGES_GLOBAL_GRANT` (42501), sem mudar defaults.

**Não altera defaults globais para contornar o problema**, pois isso afetaria
objetos futuros em outros schemas e excederia o escopo aprovado. Se o projeto
remoto tiver globals inseguros, esta proposta fica bloqueada para aplicação:
será necessária uma decisão do Lead e uma PR/autorização específica. A revisão
Lead confirmou originalmente PUBLIC EXECUTE implícito no remoto, e posteriormente
aplicou o SQL exato do [pré-requisito global](global-routine-execute-prerequisite.md).
O conector registrou `20261015013357`; o catálogo read-only agora mostra
`{postgres=X/postgres}`. O guard continua intacto: a precondição deve ser novamente
conferida antes de qualquer aplicação, sem presumir autorização ou compatibilidade
de toda a plataforma somente porque testes descartáveis passaram.

O cenário positivo agora aplica a **migration real do pré-requisito da PR18**;
não fecha globals apenas na fixture. A versão anterior 20261013192536 era Draft
não aplicada e foi renumerada para executar DEPOIS de 20261015013357, sem alterar
seu SQL. A ordem é validada e a cadeia real é executada do zero em outro banco
descartável. As sete migrations já existentes na main permanecem intactas.
Também testamos o caso normal sem pré-requisito, que deve ser rejeitado.

## Histórico reconciliado, sem escrita remota

O arquivo da PR18 foi alinhado ao timestamp remoto `20261015013357`, preservando
seu SQL. O hardening não aplicado passou de `20261013201124` para `20261015013358`,
para permanecer depois do pré-requisito. A versão Draft inicial `20261013192536`
também continua ausente. Nenhuma versão aplicada é removida/reparada no remoto.

Com oito versões aplicadas, a comparação offline deixa somente
`20261015013358_postgres_public_default_privileges_hardening.sql` pendente nesta
branch. O pré-requisito não é novamente agendado no modelo de comparação por
timestamp do Supabase. Não foi executado db push/dry-run, migration repair ou
apply_migration do conector. Um futuro push do banco aplicaria este hardening;
isso exige autorização explícita separada, mesmo após eventual merge humano.

SQL e guard permanecem byte-identical no Git (blob
`2c4d4f2e2277794889235caa79827812f2b9b7b4`). Somente nomes, testes e documentação
mudaram. A ordenação, rejeição de aliases/timestamps duplicados, instalação do
zero e rollback em globals incompatíveis continuam gates do CI.

## Avaliação separada de supabase_admin

A auditoria anterior encontrou defaults amplos nesse papel. Ele é gerenciado pela
plataforma, não o proprietário das 14 tabelas da aplicação. As permissões/defaults
do criador efetivo determinam os objetos novos; defaults de postgres não protegem
objetos criados por supabase_admin. [Papéis Supabase](https://supabase.com/docs/guides/database/postgres/roles).

Não há evidência suficiente nesta PR para revogar defaults de supabase_admin sem
impactar objetos/serviços gerenciados. **Nenhuma alteração desse papel é proposta.**
Os testes reproduzem seus grants amplos e confirmam que permanecem iguais,
inclusive em uma tabela fictícia criada após a migration. Isso comprova o limite
da mudança; não comprova funcionamento de todos os serviços hosted do Supabase.

Risco remanescente: objetos futuros desse proprietário continuam recebendo seus
defaults atuais. Não usá-lo como criador de novas tabelas/RPCs da aplicação sem
revisão própria. Nunca revogar grants gerenciados em massa ou confiar somente em RLS:
TRUNCATE não é protegido por RLS.

## Testes e evidências reproduzíveis

O job **PostgreSQL 17 privilege hardening** usa a imagem oficial `postgres:17`,
banco vazio `rpmdelivery_privileges_test`, porta ligada somente ao loopback do
runner Ubuntu, acesso trust somente no serviço descartável e sem secrets.
O script recusa outro host, usuário, nome de banco, versão principal, banco não
vazio ou ausência do opt-in explícito. Não exige Docker local nem instala runtime
na aplicação. Não usa URL/cliente de Supabase. O CI conserva contents:read.

`bash tests/sql/run-postgres-privileges.sh` aplica as migrations anteriores apenas
nesse banco e cobre:

- EXECUTE global implícito, grants globais diretos por classe e herdados: rejeição
  esperada e igualdade das ACLs após o rollback.
- Defaults antes/depois: resíduos de tabela Dxtm, UPDATE de sequências e EXECUTE
  por schema desaparecem para anon/authenticated; grants de service_role ficam.
- Objetos futuros: tabela/identity, sequência, função SECURITY DEFINER e procedure.
  Nenhum SELECT/escrita/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, USAGE/SELECT/UPDATE de
  sequência ou EXECUTE herdado para anon/authenticated.
- Execução real com SET ROLE: acessos negados e papéis efetivos conferidos.
- Grants existentes, incluindo SELECT, uso de sequência e EXECUTE, preservados.
- Opt-in explícito em novos objetos: SELECT com RLS filtra as linhas fictícias,
  EXECUTE volta a funcionar somente após GRANT específico.
- create_restaurant autenticada cria OWNER; create_courier_profile funciona e
  continua idempotente. Anon não executa RPCs. Escrita direta fica negada.
- Dois atores fictícios: o segundo não lê restaurante/perfil do primeiro; edição
  do próprio perfil continua permitida.
- Snapshot de ACLs de relações/colunas, corpo/configuração/ACL das funções e
  políticas/RLS existentes; defaults globais, outros schemas e supabase_admin
  permanecem iguais.
- Reaplicação controlada com novos objetos e RPC/RLS testados novamente.

O log before/after e PASSs é disponibilizado no artefato
`postgres-privileges-<run_id>-<attempt>`, retido por sete dias. Contém apenas dados
e atores sintéticos. A versão completa do servidor fica no início do log.
O tag oficial acompanha as atualizações de manutenção da linha17.

`npm run test:sql` mantém o teste anterior de geocoding/legado e roda a mesma
migration e verificações compatíveis em uma segunda instância **PGlite em memória**.
Não é a única evidência: o job PostgreSQL completo é obrigatório para esta PR.
Auth, papéis/defaults e schemas dos testes são fixtures; não simulam todos os
event triggers, Realtime ou serviços internos da plataforma.

## Plano futuro de aplicação — requer autorização explícita

1. Lead revisa migration, job PostgreSQL verde e a precondição dos globals.
2. Em sessão autorizada de leitura, confirmar novamente projeto/ref, proprietário,
   ACLs globais e de public, memberships de papéis e possíveis event triggers que
   concedam privilégios após a criação. Registrar ACLs/grants/RLS das tabelas e RPCs.
3. Se globals forem incompatíveis, **parar**. Não ampliar escopo automaticamente,
   não alterar supabase_admin nem usar um CLI que inicialize papéis administrativos.
4. Após autorização específica, validar em homologação descartável do ambiente
   Supabase e aplicar somente esta migration em uma transação pelo procedimento
   aprovado. Não iniciar aplicação remota como consequência de merge/CI.
5. Pós-aplicação: comparar metadados/ACLs anteriores, defaults novos, grants das
   RPCs, políticas/RLS e grants de service_role/supabase_admin. Nenhuma alteração
   inesperada de objeto existente é aceitável. Provas com objetos futuros e
   chamadas de criação ficam na homologação descartável, não em dados reais.

Não há rollback automático que reabra privilégios inseguros. Se necessário,
preparar outra mudança forward-only, mínima e revisada; não restaurar ALL em massa.

## Fora do escopo e riscos remanescentes

Não resolve exclusividade de delivery em rotas, transições operacionais,
idempotência de create_restaurant, retenção/localização, credenciais ou Auth.
Não altera a leitura explícita atualmente autorizada. Não protege futuros objetos
de outro proprietário nem grants globais/novos grants explícitos/event triggers.
Não cria endpoint, UI, dependência, notificação, tracking ou operação real.
Não foi solicitado Visual Critic, por se tratar exclusivamente de banco/segurança.
