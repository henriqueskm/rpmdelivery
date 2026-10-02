# Base de autenticação e onboarding

## Referência visual local

Nenhum arquivo/frame Figma foi fornecido. Esta proposta local é a alternativa autorizada para a primeira implementação, ainda sujeita à revisão visual. Quando houver frames aprovados, comparar os mesmos estados e viewports antes de evoluir as telas.

- Marca: monograma de movimento, assinatura RpmDelivery, linha pontilhada entre restaurante e destino.
- Grafite verde `#1d2c24`, fundo marfim `#f8f8f4`, coral decorativo `#fb673b`. Botões usam coral mais escuro `#bd401b` para contraste com texto branco.
- Geist, títulos grandes com espaçamento compacto, labels visíveis, controles de pelo menos 44px, foco destacado. Sem imagens externas ou animações decorativas.
- Desktop: painel de marca à esquerda, formulário concentrado à direita. Mobile: marca compacta e formulário sem painel lateral; dashboard empilha identidade, conteúdo e cards.
- Login/cadastro compartilham campos e estrutura; onboarding mantém a linguagem visual; dashboard combina faixa de configuração concluída e estado inicial sem pedidos fictícios.
- Contraste, teclado, senha visível/oculta, loading, erro e confirmação são parte da referência. Usuários com movimento reduzido não recebem spinner animado.

## Integração e limites de segurança

A única dependência nova é `@supabase/supabase-js`, fixada para integrar Auth, consultas e RPC sem implementar tokens ou HTTP manualmente. Next/React/TypeScript permanecem na mesma versão.

Rotas públicas: `/`, `/login`, `/cadastro`. Após login ou cadastro com sessão, `/onboarding` verifica o usuário com `auth.getUser()` e busca seu primeiro vínculo ativo (ordem de criação). Se já existir restaurante, segue para `/dashboard`; sem vínculo, permite chamar `create_restaurant(p_name, p_address, p_phone?)`. Telefone é opcional. O RPC existente cria restaurante e membro OWNER. Cadastro sem sessão exige confirmação de e-mail e não libera acesso.

O SDK mantém sessão no navegador e renova tokens. O guard client é UX; **a autorização é feita pelas RLS e pelo RPC existentes**, usando o token do usuário. As páginas server são apenas shells públicos sem dados privados. Não há service role, endpoints server novos nem cookies de autenticação SSR. Futuras Server Actions/API devem verificar tokens independentemente; não confiar em localStorage, getSession ou no guard client. Sair encerra a sessão deste navegador.

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
