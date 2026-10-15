# Pré-requisito global da PR17 — histórico reconciliado para revisão Lead

Base: main `74891494ed5128ed87eae2d7bfae15098ee97890`. A revisão Lead da PR17,
HEAD `62fcc0392688d8cbd8ce70a592cc824ad73721ff`, confirmou por leitura remota que
postgres não tem override global para rotinas: aplica-se PUBLIC EXECUTE implícito.
Esse era o estado anterior à aplicação. O Lead aplicou o SQL exato da PR18 no
RpmDelivery `yyfbpmppdszmvhcruoyb`; o conector registrou a versão `20261015013357`.
A reconciliação confirmou somente por leitura o histórico e o default global
`{postgres=X/postgres}`. Não executou DDL, reparo de histórico ou CLI remoto,
não leu registros de clientes e não acessou EstoqueNK. A PR17 continua não aplicada.

## Proposta e alcance

Migration forward-only `20261015013357_postgres_global_routine_execute_prerequisite.sql`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
```

Tem transação explícita e é reaplicável. Altera exclusivamente o default GLOBAL
de EXECUTE para PUBLIC nas rotinas futuras criadas por postgres, em **todos os
schemas**, inclusive schemas criados posteriormente. ROUTINES cobre funções,
procedures e aggregates. Não altera grants/defaults de tabelas, sequências, tipos,
schemas, outros proprietários, membership de papéis ou objetos existentes.

PUBLIC representa todos os papéis; anon/authenticated/service_role e workers que
dependam SOMENTE desse fallback deixam de executar essas novas rotinas.
Concessões explícitas globais, por schema e por objeto permanecem. No public
atual, o grant explícito de service_role por schema permanece suficiente;
em outro schema sem opt-in, uma função futura pode exigir GRANT específico.
Não adicionamos EXECUTE global a service_role para compensar isso em massa.

Funções existentes com ACL implícita PUBLIC permanecem acessíveis. CREATE OR
REPLACE preserva ACLs existentes; DROP + CREATE é objeto novo e recebe novos
defaults. Esta PR não é uma revogação retroativa de funções inseguras existentes.
Veja [PostgreSQL17 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
e [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).

## Supabase: análise e dependências de compatibilidade

Os [scripts oficiais de inicialização](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql)
definem papéis da API, grants por schema e defaults específicos de supabase_admin.
São referência de arquitetura, **não prova da configuração/versionamento hospedado**.
Os defaults do criador efetivo se aplicam à criação, não os defaults de outros
papéis aos quais ele pertença. Uma criação por supabase_admin ou por um papel
próprio de Auth/Storage não recebe este default de postgres. Nenhum desses
proprietários/defaults é modificado nesta proposta.

| Dependência | Impacto avaliado | Evidência e limite |
| --- | --- | --- |
| RPCs atuais | ACLs/corpos permanecem; identity vem de auth.uid | Snapshot e chamadas autenticadas de create_restaurant/create_courier_profile, RLS de dois atores |
| auth.uid e helpers atuais | Objetos existentes não mudam | Fixture testa Auth SQL atual; não certifica GoTrue/SSR hosted |
| service_role | Grants explícitos atuais e defaults explícitos permanecem; fallback PUBLIC futuro deixa de existir | Execução real, opt-in por schema/objeto e cenário de grant global explícito |
| supabase_admin/outros criadores | Não recebem a alteração de postgres | Snapshot e criações fictícias com papéis distintos; não homologa serviços reais |
| Event triggers atuais | Objetos/ACLs não mudam; futuras funções auxiliares podem exigir grant | Listener DDL representativo continua disparando em PostgreSQL17; não reproduz todos os triggers hosted |
| Extensões atuais | Objetos atuais não mudam | Snapshot inclui funções de pgcrypto existentes no CI |
| Extensões futuras/upgrades | **Risco relevante:** funções criadas por postgres podem perder fallback de execução | Contrib hstore é instalada após a migration e precisa de opt-in explícito na fixture |
| API/Realtime/Storage/cron/network | Futuras rotinas criadas por postgres podem depender de PUBLIC ou de grants automáticos | **Não certificados** sem inventário e homologação da versão hospedada |

Documentação oficial: [papéis](https://supabase.com/docs/guides/database/postgres/roles),
[event triggers](https://supabase.com/docs/guides/database/postgres/event-triggers)
e [extensões](https://supabase.com/docs/guides/database/extensions).
Event triggers/scripts de extensões podem conceder EXECUTE explicitamente e
reabrir acesso; o default global não é proteção contra esses grants deliberados.

**Estado atual:** o Lead aplicou o pré-requisito; esta atualização altera somente
a identidade do arquivo no Git, testes e documentação. Não reaplica SQL.
CI verde e aplicação bem-sucedida não certificam todos os serviços/upgrades
gerenciados. O escopo e as garantias SQL permanecem iguais.

## Ordem obrigatória e coordenação com PR17

1. `20261015013357_postgres_global_routine_execute_prerequisite.sql` — já aplicada pelo Lead.
2. `20261015013358_postgres_public_default_privileges_hardening.sql` — PR17 ainda não aplicada.

A versão anterior `20261013192536` da PR17 deve ser substituída somente porque
é Draft **não aplicada**, bloqueada segundo o Lead. O SQL/guard é preservado.
As sete migrations já versionadas na main não são editadas/reordenadas.
Se aparecer evidência de aplicação da versão antiga em qualquer ambiente, parar
e planejar compatibilidade; não renomear histórico já aplicado.

`tests/sql/security-migrations.ts` rejeita a versão antiga, ordem invertida ou
duplicatas. Rejeita também a antiga identidade do pré-requisito e timestamps
iguais com nomes diferentes. A Draft é independente, baseada na main, sem incluir a migration
de escopo public. A branch PR17 incorpora esta dependência sem reescrever
histórico ou fazer force-push; as duas PRs continuam Draft, sem merge em main.

Quando a PR17 estiver presente, os testes usam a migration real do pré-requisito,
não um fechamento global escondido na fixture. O job nativo inicializa um segundo
banco vazio e executa **todos os arquivos em ordem**, seguido de RPC/RLS. As PRs
permanecem Draft, sem merge ou aplicação automática.

## Reconciliação com o histórico aplicado

O conector gravou `20261015013357 / postgres_global_routine_execute_prerequisite`,
embora o arquivo Draft usasse `20261013201122`. Preservamos o registro remoto:
o arquivo passa a usar a versão remota, com SQL byte-identical no Git. Não criamos
uma segunda migration, alias ou reparo remoto para marcar a versão antiga.

O hardening Draft da PR17 usava `20261013201124`, anterior ao registro aplicado.
Como ainda não foi aplicado, passa a `20261015013358`, preservando SQL e guard.
Essa renumeração não deve ser generalizada para migrations já aplicadas.

O histórico read-only contém oito versões: as sete anteriores e o pré-requisito.
A comparação offline dos timestamps encontra zero versões pendentes nesta PR,
e somente o hardening na PR17. O teste unitário exercita esse mesmo conjunto,
inclusive rejeitando versões antigas/duplicadas. Não é um dry-run de CLI remoto.

O Supabase compara versões do arquivo com `supabase_migrations.schema_migrations`;
com o arquivo alinhado, um futuro db push não agenda novamente o pré-requisito.
[Referência oficial de histórico](https://supabase.com/docs/reference/cli/supabase-migration-list).
Isso pressupõe um checkout reconciliado e o histórico intacto. Não executar
db push, migration repair/fetch/pull, nem apply_migration do conector nesta tarefa.
O conector atribuiria outro timestamp caso o SQL fosse submetido novamente.
Quando a PR17 estiver no checkout, db push poderá agendar seu hardening: isso
continua exigindo autorização separada. Merge não é autorização de aplicação.

## Evidências e reprodução

- PostgreSQL17 oficial, descartável no CI, ligado só ao loopback, sem secrets ou
  dependências runtime adicionais. Não exige Docker local.
- Before: PUBLIC EXECUTE implícito verificado no catálogo. After: só PUBLIC é
  removido do default global; snapshots confirmam outros defaults/grants/objetos.
- Rotinas futuras em public e schemas com/sem opt-in; função SECURITY DEFINER,
  procedure, papel sem concessão própria para testar herança de PUBLIC.
- SET ROLE anon/authenticated/service_role; bloqueios e opt-ins funcionais.
- Outra autoria (supabase_admin e papel Auth fictício), grants explícitos nos três
  níveis, RPCs existentes, RLS, reaplicação e instalação do zero.
- Listener DDL e extensão hstore reais no PostgreSQL descartável. Representam
  cenários, não são simuladores integrais da plataforma hosted.
- PGlite complementar cobre catálogo/RPCs/grants compatíveis, sem alegar evidência
  de event triggers ou extensão hstore. Mantém a suíte anterior de geocoding.
- Logs sintéticos são anexados pelo job `PostgreSQL17 global routine prerequisite`
  no artefato `postgres-global-routines-<run_id>-<attempt>`, retenção sete dias.

## Procedimento futuro — sem autorização de execução nesta tarefa

1. Lead confirma estratégia global e ordem das duas Drafts; confirma ausência da
   versão antiga de PR17 no histórico de todos os ambientes autorizados.
2. Em sessão read-only autorizada no projeto correto, inventariar defaults,
   proprietários/ACLs de rotinas, papéis consumidores, event triggers e extensões
   com suas versões. Não consultar dados pessoais ou vault/credenciais.
3. Homologar em ambiente Supabase descartável, aprovado e sem dados reais, com
   versão/configuração equivalentes; testar Auth, Data API, serviços usados e
   instalação/upgrade das extensões relevantes. Essa homologação **não ocorreu**.
4. Se houver dependência de PUBLIC, parar e revisar opt-ins específicos com Lead/
   suporte Supabase. Não conceder ALL/EXECUTE global em massa ou alterar supabase_admin.
5. O pré-requisito já aplicado não deve ser reenviado. Somente após autorização
   explícita própria, avaliar/aplicar o hardening public da PR17, se o guard aceitar.
   Conferir novamente histórico e ACLs antes de qualquer execução. Sem CLI que
   inicialize papéis remotos.
6. Pós-aplicação: verificação de catálogo e homologação funcional; nenhuma criação
   de conta/restaurante fictício em produção como teste. Nenhum rollback automático
   que reabra PUBLIC: correções forward-only específicas e revisadas.

## Alternativa se o alcance global não for aprovado

Manter estas Drafts bloqueadas. Reespecificar explicitamente PR17 como hardening
**parcial de tabelas/sequências**, deixando o risco de EXECUTE futuro aberto,
com revisão Lead própria. Funções públicas novas precisariam de REVOKE/GRANT na
mesma transação e testes de ACL. Não remover/afrouxar o guard atual silenciosamente
nem alegar default seguro para funções. Outra opção arquitetural futura é um
criador dedicado aos objetos da aplicação, com defaults próprios; não implementar
troca de proprietários/papéis nesta PR de pré-requisito.
