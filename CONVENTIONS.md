# RpmDelivery — Regras de Desenvolvimento

## Objetivo

Manter o projeto simples, seguro, mobile-first, limpo e fácil de evoluir.

## Regras obrigatórias

* Alterar apenas os arquivos necessários para a tarefa.
* Não fazer refatorações extras sem necessidade.
* Não adicionar dependências novas sem justificar.
* Não alterar arquitetura crítica sem explicar o impacto antes.
* Não remover funcionalidades existentes sem solicitação explícita.
* Manter TypeScript estrito e evitar `any`.
* Priorizar acessibilidade e experiência mobile.
* Não expor secrets, chaves ou credenciais no código.
* Não colocar credenciais em arquivos versionados.

## Clean Code

* Priorizar código simples, legível e previsível.
* Usar nomes claros para variáveis, funções, componentes e arquivos.
* Evitar funções longas com muitas responsabilidades.
* Aplicar responsabilidade única sempre que fizer sentido.
* Evitar lógica de negócio complexa diretamente dentro de componentes React.
* Separar regras de negócio, acesso a dados, componentes visuais, tipos e utilitários.
* Evitar duplicação de código.
* Não criar abstrações desnecessárias apenas para reduzir linhas.
* Preferir composição em vez de componentes gigantes.
* Evitar comentários explicando código confuso; preferir tornar o próprio código claro.

## Tamanho de arquivos

* Evitar arquivos excessivamente grandes.
* Como referência, tentar manter arquivos de aplicação abaixo de aproximadamente 250 a 300 linhas.
* Arquivos acima disso devem ser avaliados para divisão por responsabilidade.
* Componentes React grandes devem ser divididos em subcomponentes quando tiverem múltiplas responsabilidades.
* Funções muito longas devem ser divididas em funções menores e nomeadas.
* Não dividir arquivos artificialmente apenas para obedecer um limite de linhas.
* A divisão deve melhorar legibilidade, manutenção e separação de responsabilidades.

## Organização

Preferir uma estrutura semelhante a:

`components/`

* componentes visuais reutilizáveis

`features/`

* funcionalidades específicas do sistema

`services/`

* integrações e operações externas

`lib/`

* infraestrutura e utilitários compartilhados

`types/`

* tipos compartilhados quando necessário

`hooks/`

* hooks reutilizáveis

Evitar criar pastas ou arquivos genéricos sem necessidade.

## Economia de contexto e tokens

* Pesquisar por símbolo, arquivo ou erro antes de abrir diretórios inteiros.
* Ler somente os trechos necessários para decidir ou implementar a mudança.
* Reutilizar contexto já confirmado em vez de reabrir os mesmos arquivos sem necessidade.
* Durante iteração, usar verificações focadas quando possível; executar o `npm run verify` completo antes de concluir.
* Não carregar logs extensos. Filtrar por rota, erro, período ou request relevante.
* Resumir descobertas antes de avançar para outra camada do sistema.

## Uso das integrações

### GitHub

* Trabalhar em branch específica para cada tarefa.
* Antes de mudar código, localizar os arquivos realmente envolvidos.
* Revisar o diff final e evitar arquivos não relacionados.
* Não fazer force push nem reescrever histórico da `main`.

### Supabase

* Consultar documentação atual quando a tarefa tocar banco, Auth, RLS, RPCs, Storage ou permissões.
* Inspecionar apenas tabelas, funções, policies e migrations relacionadas à tarefa.
* Toda mudança permanente de schema deve possuir migration versionada.
* RLS deve permanecer habilitada em tabelas expostas e policies devem aplicar autorização por tenant/usuário, não apenas autenticação.
* Tratar `SECURITY DEFINER` como operação privilegiada: usar somente quando necessário, validar `auth.uid()`, permissões de execução e `search_path`.
* Nunca expor `service_role` ou secrets ao cliente.
* Depois de mudanças de banco, executar validações relevantes e advisors de segurança/performance quando disponíveis.

### Vercel

* Usar dados de deploy/logs quando a tarefa envolver erro de produção, build, runtime ou performance.
* Começar por erros agregados ou pelo deployment relevante antes de abrir logs detalhados.
* Não alterar variáveis de ambiente, domínio ou configuração de produção sem solicitação explícita.

## Validação

Após qualquer alteração de código, executar:

`npm run verify`

A tarefa só deve ser considerada concluída se:

* lint passar;
* typecheck passar;
* build passar.

Se houver erro:

1. Ler o erro real do terminal.
2. Corrigir a causa.
3. Rodar novamente a validação.
4. Não esconder ou ignorar erros.

## Git

* Fazer commits pequenos e objetivos.
* Não reescrever histórico da branch principal.
* Não executar force push.
* Não apagar arquivos não relacionados à tarefa.
* Antes de alterações maiores, verificar o estado do Git.

## Interface

* Mobile-first.
* Visual limpo e moderno.
* Interfaces simples para operação rápida em restaurante.
* Botões e áreas de toque adequados para celular.
* Estados de carregamento, vazio e erro devem ser considerados.
* Não adicionar animações que atrapalhem a operação.

## Arquitetura

Antes de mudanças que afetem:

* banco de dados;
* autenticação;
* permissões;
* atribuição de entregas;
* cálculo financeiro;
* geolocalização;
* concorrência;
* segurança;

explicar a solução proposta e os riscos envolvidos.

## Escopo

Se uma tarefa pedir algo específico, implementar apenas esse escopo.

Se identificar uma melhoria adicional, informar separadamente em vez de implementá-la automaticamente.
