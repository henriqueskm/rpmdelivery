---
name: rpmdelivery-senior-dev
description: Use ao implementar, revisar, depurar ou otimizar o RpmDelivery, especialmente em tarefas que envolvam Next.js, GitHub, Supabase, RLS, migrations, segurança, Vercel, performance ou deploy. Coordene as ferramentas conectadas com o mínimo de contexto necessário e valide antes de concluir.
---

# RpmDelivery Senior Dev

Use este fluxo para mudanças reais no projeto. Seja econômico com contexto e ferramentas: consulte apenas o que pode mudar a decisão atual.

## 1. Classifique a tarefa

Escolha somente as fontes necessárias:

- Código/UI/regra local: repositório.
- Banco/Auth/RLS/RPC/migration: repositório + Supabase.
- Erro de produção/build/runtime/performance: Vercel + repositório; use Supabase somente se houver indício de banco.
- Revisão de PR: diff/arquivos alterados primeiro; abra contexto adicional apenas quando necessário.

Não consulte todas as integrações por padrão.

## 2. Obtenha contexto mínimo

1. Leia `AGENTS.md` e `CONVENTIONS.md`.
2. Pesquise pelos símbolos, rotas, tabelas ou mensagens de erro envolvidos.
3. Abra apenas os arquivos e trechos relevantes.
4. Confirme o estado atual antes de propor mudança.
5. Para Next.js, respeite a documentação da versão instalada no projeto.

Se código remoto, banco remoto e deploy divergirem, não adivinhe qual está correto. Registre a divergência e evite mudanças destrutivas até determinar a fonte de verdade.

## 3. Planeje a menor mudança segura

Antes de editar:

- identifique a causa ou requisito concreto;
- liste os arquivos que realmente precisam mudar;
- preserve APIs e comportamentos fora do escopo;
- evite novas dependências quando uma solução simples já existe;
- se houver risco de dados, autenticação, concorrência ou permissões, descreva o risco antes da implementação.

## 4. Fluxos por integração

### GitHub

- Nunca implemente diretamente na `main`.
- Use branch por tarefa.
- Faça mudanças pequenas e relacionadas.
- Revise o diff completo antes de concluir.
- Não inclua arquivos gerados, secrets ou alterações fora de escopo.

### Supabase

Quando a tarefa tocar Supabase:

1. Consulte documentação atual relevante antes de depender de comportamento específico.
2. Inspecione somente schema, policies, funções e migrations relacionados.
3. Preserve isolamento por restaurante/tenant.
4. Em tabelas expostas, mantenha RLS e autorização efetiva por usuário/tenant.
5. Para UPDATE com RLS, confirme regras de leitura e de `WITH CHECK`.
6. Trate `SECURITY DEFINER` como código privilegiado; valide identidade, grants e `search_path`.
7. Nunca exponha `service_role` ou secrets ao frontend.
8. Toda alteração permanente de schema deve terminar em migration versionada.
9. Execute teste relevante e advisors de segurança/performance quando disponíveis.

Não use mudanças manuais no banco como substituto permanente de migration.

### Vercel

Quando a tarefa tocar produção ou deploy:

1. Identifique o projeto/deployment correto.
2. Comece por status, erro agregado ou rota afetada.
3. Abra logs detalhados apenas para o período/rota/request necessário.
4. Relacione o erro a um arquivo ou mudança concreta antes de editar.
5. Não altere env vars, domínios ou configurações de produção sem solicitação explícita.

## 5. Implementação

- Prefira patch pequeno e reversível.
- Mantenha regras de negócio fora de componentes visuais quando possível.
- Mantenha TypeScript estrito e evite `any`.
- Preserve mobile-first, acessibilidade e estados de loading/empty/error.
- Divida arquivos apenas quando isso melhorar responsabilidade e legibilidade.

## 6. Verificação

Durante iteração, execute verificações focadas quando forem suficientes para feedback rápido.

Antes de concluir alteração de código, execute:

`npm run verify`

A conclusão deve informar separadamente:

- lint;
- typecheck;
- build;
- testes adicionais executados;
- validações de Supabase/Vercel quando aplicáveis.

Nunca declare sucesso de uma verificação que não foi executada.

## 7. Revisão final

Cheque:

- escopo: somente o solicitado mudou?
- segurança: RLS, Auth, secrets e permissões continuam corretos?
- dados: constraints, concorrência e idempotência foram preservadas?
- performance: houve chamadas, queries ou carregamentos desnecessários?
- UX: mobile e estados de erro/carregamento continuam funcionais?
- Git: diff limpo e sem arquivos não relacionados?

## 8. Formato de entrega

Seja conciso. Entregue:

1. o que mudou;
2. arquivos principais;
3. verificações executadas e resultado;
4. riscos ou pendências reais;
5. próximo passo somente se necessário.

Não repita toda a análise nem despeje logs extensos.
