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
