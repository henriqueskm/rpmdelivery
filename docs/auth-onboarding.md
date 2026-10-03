# Base de autenticação e onboarding

## Referência visual local

Na implementação inicial não havia frame Figma fornecido. O arquivo oficial agora é [RpmDelivery](https://www.figma.com/design/ACQilVSdQov2BYvWsRTuZR/RpmDelivery), mas a página `00 Brand` estava vazia na consulta desta feature. A base existente continua sujeita à revisão visual quando houver frames aprovados.

- Marca: monograma de movimento, assinatura RpmDelivery, linha pontilhada entre restaurante e destino.
- Grafite verde `#1d2c24`, fundo marfim `#f8f8f4`, coral decorativo `#fb673b`. Botões usam coral mais escuro `#bd401b` para contraste com texto branco.
- Geist, títulos grandes com espaçamento compacto, labels visíveis, controles de pelo menos 44px, foco destacado. Sem imagens externas ou animações decorativas.
- Desktop: painel de marca à esquerda, formulário concentrado à direita. Mobile: marca compacta e formulário sem painel lateral; dashboard empilha identidade, conteúdo e cards.
- Login/cadastro compartilham campos e estrutura; onboarding mantém a linguagem visual; dashboard combina faixa de configuração concluída e estado inicial sem pedidos fictícios.
- Contraste, teclado, senha visível/oculta, loading, erro e confirmação são parte da referência. Usuários com movimento reduzido não recebem spinner animado.

## Integração e limites de segurança

A base usa `@supabase/supabase-js` fixado. A feature de geocoding adiciona somente `server-only` para proteger imports do provider/token do servidor. Next/React/TypeScript permanecem na mesma versão.

Rotas públicas: `/`, `/login`, `/cadastro`. Após login ou cadastro com sessão, `/onboarding` verifica o usuário com `auth.getUser()` e busca seu primeiro vínculo ativo (ordem de criação). Se já existir restaurante, segue para `/dashboard`; sem vínculo, permite configurar restaurante com endereço confirmado e celular opcional. O RPC cria restaurante e membro OWNER. Cadastro sem sessão exige confirmação de e-mail e não libera acesso. Consulte [restaurant-address-geocoding.md](restaurant-address-geocoding.md) para o novo contrato de sete parâmetros, migration pendente de revisão e limites de idempotência.

O SDK mantém sessão no navegador e renova tokens. O guard client é UX; **a autorização de dados é feita pelas RLS e pelo RPC**, usando o token do usuário. As páginas server são shells públicos sem dados privados. Não há service role nem cookies de autenticação SSR. Os novos endpoints de geocoding recebem o bearer token e o verificam independentemente com `auth.getUser(token)` no servidor; `getSession()` no client serve apenas para obtê-lo. Sair encerra a sessão deste navegador.

Falhas de consulta não viram onboarding vazio. Falhas de criação bloqueiam reenvio nesta sessão e oferecem consulta do vínculo antes de qualquer nova tentativa: o RPC atual não é idempotente. Recarregar remove esse bloqueio de UX; idempotência e garantia contra concorrência exigem uma futura revisão do contrato de banco, fora deste PR. Não há retry automático da criação.

## Configuração local real

No ambiente de desenvolvimento autorizado, configure em `.env.local` (ignorado pelo Git):

- `NEXT_PUBLIC_SUPABASE_URL`: URL do Supabase local ou ambiente de desenvolvimento aprovado.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave pública desse ambiente, nunca service role.
- Permita o redirect de confirmação `http://localhost:<porta>/onboarding` ou `http://127.0.0.1:<porta>/onboarding` no Auth do ambiente local.

Não foram criados/alterados secrets ou arquivos Supabase. Sem configuração, o login continua visível e exibe orientação ao enviar; telas privadas exibem erro de configuração. Não há credenciais de produção embutidas.

Para validar a integração real, use uma instância **local e descartável** já preparada com schema/RLS/RPC, um e-mail fictício exclusivo e a caixa de e-mail local para confirmação. Crie a conta pelo formulário, confirme, entre, configure o restaurante, recarregue dashboard e saia. Não use usuários/dados reais nem execute comandos de banco remoto. A criação/limpeza automatizada de usuários e aplicação de migrations não fazem parte deste PR; futuro fixture local deve ser opt-in e recusar hosts remotos.

## E2E previsíveis

`npm run test:e2e` compila com URL loopback e chave placeholder explícitas no webServer do Playwright. Os testes interceptam **as chamadas do SDK** com respostas locais fictícias; não existe modo demo/backdoor no frontend. A configuração não usa secrets de CI nem banco remoto.

Labels e roles acessíveis são os seletores estáveis; nenhum data-testid foi necessário. Os testes cobrem entrada/cadastro, confirmação, sessão persistida, onboarding, payload do RPC, dashboard, logout, rota sem sessão, credenciais inválidas, falha de consulta e criação incerta em desktop e Pixel 7 emulado. Sucesso também verifica console, runtime e rede.

Esses testes validam UI, integração com SDK e contrato HTTP simulado. **Não provam Auth/RLS/RPC contra um Supabase real**; execute o roteiro local acima antes de aceitar mudanças de permissões/contrato. Nenhum teste escreve em ambiente remoto. Credenciais usadas são fictícias e restritas aos testes.
