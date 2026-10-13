# Pré-requisito global da PR17 — proposta para revisão Lead

Base: main `74891494ed5128ed87eae2d7bfae15098ee97890`. A revisão Lead da PR17,
HEAD `62fcc0392688d8cbd8ce70a592cc824ad73721ff`, confirmou por leitura remota que
postgres não tem override global para rotinas: aplica-se PUBLIC EXECUTE implícito.
Esse resultado é evidência **fornecida pelo Lead**, não uma nova inspeção remota
do Builder. Nesta tarefa não usamos consultas/CLI remoto, credenciais, dados reais
ou o EstoqueNK. Referência para eventual autorização: RpmDelivery `yyfbpmppdszmvhcruoyb`.

## Proposta e alcance

Migration forward-only `20261013201122_postgres_global_routine_execute_prerequisite.sql`:

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

**Avaliação:** mecanismo PostgreSQL adequado como candidato ao pré-requisito,
com alcance mínimo para retirar PUBLIC. **Não recomendamos aplicação hosted
somente com CI verde.** Há dependência de homologação/inventário e aprovação Lead
sobre serviços e upgrades gerenciados. Não presumimos compatibilidade completa.

## Ordem obrigatória e coordenação com PR17

1. `20261013201122_postgres_global_routine_execute_prerequisite.sql` — esta Draft.
2. `20261013201124_postgres_public_default_privileges_hardening.sql` — PR17 renumerada.

A versão anterior `20261013192536` da PR17 deve ser substituída somente porque
é Draft **não aplicada**, bloqueada segundo o Lead. O SQL/guard é preservado.
As sete migrations já versionadas na main não são editadas/reordenadas.
Se aparecer evidência de aplicação da versão antiga em qualquer ambiente, parar
e planejar compatibilidade; não renomear histórico já aplicado.

`tests/sql/security-migrations.ts` rejeita a versão antiga, ordem invertida ou
duplicatas. A nova Draft é independente, baseada na main, sem incluir a migration
de escopo public. A branch PR17 incorpora esta dependência por merge Git normal,
sem force-push; esse merge de branches **não** é merge de PR/main.

Quando a PR17 estiver presente, os testes usam a migration real do pré-requisito,
não um fechamento global escondido na fixture. O job nativo inicializa um segundo
banco vazio e executa **todos os arquivos em ordem**, seguido de RPC/RLS. As PRs
permanecem Draft, sem merge ou aplicação automática.

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
5. Somente após autorização explícita, aplicar o pré-requisito pelo procedimento
   aprovado, comparar ACLs/corpos existentes e novos defaults; então executar o
   hardening public da PR17, se o guard aceitar. Sem CLI que inicialize papéis remotos.
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
