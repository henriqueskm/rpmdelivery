# RPM-ANDROID-002 — Autenticação nativa

## Contratos e limites

Base: main `2d7e2ce2bd4c3801973b7c77db2a7f070077d456`, após PR #22.
Nenhum arquivo Next.js, migration, política, configuração Auth ou dado hospedado é
modificado. Os testes não criam usuários remotos nem enviam e-mails.

- Auth Email/Password cria a identidade; o trigger `handle_new_user` preenche
  `profiles.name` a partir de `data.name`. Metadata nunca autoriza ações.
- O aplicativo valida a identidade via Auth `/user`; consulta somente seu perfil,
  filtrado pelo ID retornado, com colunas explícitas.
- `profiles`: `id,name,phone`. `couriers`:
  `id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color`.
  Nunca usa `SELECT *`, colunas GPS ou acesso administrativo.
- RPC existente `complete_courier_registration(p_name,p_phone,p_model,p_plate,p_color)`:
  UUID próprio; identidade exclusivamente `auth.uid()`. SECURITY DEFINER com
  `search_path=''` e EXECUTE restrito conforme migrations existentes. A RPC
  serializa por UID, cria via `create_courier_profile` e repara somente campos
  ausentes/inválidos. O aplicativo não faz INSERT/UPDATE direto.
- Nome até 120, modelo até 80, placa até 20 e cor até 40 caracteres, não vazios.
  Um registro `couriers` existente não comprova completude. Valores válidos já
  salvos são exibidos como preservados, inclusive modelos fora do catálogo inicial.
- Novos celulares opcionais usam a máscara/DDD e E.164 da PR #22. O backend
  permanece responsável por preservar campos válidos sob concorrência.

## Fluxo

1. Boas-vindas → criar conta (nome, e-mail e senha) ou login.
2. Signup sem sessão → **Confira seu e-mail para confirmar sua conta**. A resposta
   pode ser ofuscada para contas existentes; não se afirma que o e-mail é novo.
3. Confirmação no mesmo aparelho via PKCE, quando homologada, ou confirmação no
   e-mail seguida de login manual. Nunca importar tokens implícitos de uma URL.
4. Sessão validada → completar dados faltantes do motoboy. Campos já válidos
   ficam preservados. Cadastro incompleto pode ser retomado após reabrir o app.
5. Moto não encontrada → conta permanece criada, cadastro de motoboy pendente.
   Não inventar um modelo nem enviar um valor arbitrário para a RPC.
6. Conclusão → estado de cadastro, **sem rota conectada neste aplicativo**. Não
   afirma inexistência de rotas no servidor: a consulta operacional está fora do
   escopo. Minha rota só abre por ação explícita, claramente demonstrativa.

O controlador bloqueia comandos duplicados enquanto processa. A integração não
repete escritas automaticamente. A RPC permite repetição idempotente da conclusão;
após resposta incerta o usuário pode recarregar os dados antes de repetir.

## Dependências

Somente módulos necessários: `auth-kt` e `postgrest-kt` **3.6.0**, engine
`ktor-client-okhttp` **3.4.3**. A versão 3.6.0 utiliza o conjunto Kotlin 2.3 /
Ktor 3.4; a 3.8.0 atual utiliza Kotlin 2.4. Mantemos o compilador validado da PR #22
sem atualização de toolchain desnecessária. Testes usam MockEngine 3.4.3 e
kotlinx-coroutines-test 1.10.2. Não se instalam Storage, Realtime, GPS, Room ou DI.

As cinco declarações novas possuem exceções locais e comentadas de
`NewerVersionAvailable`: os dois módulos Supabase, dois engines Ktor (runtime e
mock) e coroutines-test. Não são exceções de segurança nem falhas de compilação;
registram a escolha de uma coorte fixa compatível, em vez de ampliar esta PR para
Kotlin 2.4/R8. Não há baseline ou supressão global; `warningsAsErrors` continua
ativo para as demais verificações. Revisar a coorte numa atualização própria.
O lockfile Gradle fixa também as versões transitivas resolvidas.

Referências consultadas: [signup Kotlin](https://supabase.com/docs/reference/kotlin/auth-signup),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[SDK 3.6.0](https://github.com/supabase-community/supabase-kt/tree/3.6.0),
[compatibilidade Kotlin/Android](https://developer.android.com/build/kotlin-support),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore).
O changelog Supabase informa a retirada de cifras TLS 1.2 antigas em novembro de
2026; o cliente usa TLS da plataforma/OkHttp, sem TLS customizado ou cleartext.

## Configuração do APK

Sem configuração, o APK continua abrindo, mas login/cadastro informam que a conexão
não foi configurada. CI e APK de evidência não recebem chaves de ambiente real.
Não se lê/copía `.env.local` web, conexão PostgreSQL privada ou credencial remota.

Para uma compilação de homologação autorizada, configurar apenas URL e **publishable
key** públicas. Nunca usar senha do banco, access token administrativo, chave
`sb_secret_`, JWT service_role ou credenciais de usuários no build.

Copiar `auth.local.properties.example` para `auth.local.properties` (ignorado
pelo Git) e preencher somente a chave pública. O projeto também aceita as
propriedades Gradle `RPM_SUPABASE_URL` e `RPM_SUPABASE_PUBLISHABLE_KEY`, com
precedência sobre esse arquivo. Evitar valores sensíveis na linha de comando.
Somente a URL HTTPS do RpmDelivery
`https://yyfbpmppdszmvhcruoyb.supabase.co` e prefixo `sb_publishable_` são aceitos.
A chave pública integra o APK por definição; RLS e RPCs continuam autorizando
cada operação pelo JWT do usuário. Nunca versionar configuração local preenchida.

## Confirmação e homologação pendente

O Manifest declara apenas `rpmdelivery://auth/confirm`, validado novamente no código
(scheme/authority/path exatos, sem fragmento, sem porta/usuário, um único `code`).
O SDK gera desafio S256 e persiste o verifier criptografado; é necessário o verifier
do cadastro iniciado neste aparelho. Ele expira localmente em 24 horas e é removido
após troca bem-sucedida ou logout. O servidor continua validando seu prazo próprio.
Callback duplicado, externo, implícito ou sem verifier não autentica ninguém.

**Nenhuma destas configurações foi alterada no ambiente hospedado:**

- Homologar allowlist exata `rpmdelivery://auth/confirm` e template de confirmação
  que respeite `redirect_to`/ConfirmationURL. Não incluir wildcard amplo.
- Verificar se o template atual envia para a confirmação web por `token_hash`;
  nesse caso a confirmação web + login manual permanece alternativa. O Android
  não aceita hashes/tokens soltos como credencial.
- Testar conta sintética autorizada, confirmação, erro/expiração, abrir com app
  fechado, app em execução e confirmação em outro aparelho.
- Confirmar separadamente a disponibilidade da RPC versionada e seus grants no
  ambiente de homologação: esta tarefa não consultou nem aplicou SQL remoto.
- Schemes customizados podem ser registrados por outro app; PKCE impede trocar
  código interceptado sem verifier, mas não impede negação de serviço. Antes de
  distribuição pública, preferir HTTPS App Links verificados, domínio e assinatura
  de release fixos, com homologação própria. Não há domínio/assetlinks autorizado
  para implementar essa verificação nesta PR.

## Sessão e privacidade

- Password existe somente no formulário/chamada em memória; não é salvo em state
  bundle, storage, logs ou controller. É limpo ao enviar ou sair da tela.
- Sessão e verifier usam AES-256-GCM, IV novo, tag autenticada, AAD por finalidade,
  chave não exportável do Android Keystore e gravação atômica em `noBackupFilesDir`.
  Backup e transferência permanecem desativados no Manifest/regras da PR #22.
- SDK configurado com log NONE, HTTPS, timeout e redirects HTTP desativados.
  Não adicionar logging de headers, corpos, exceções brutas ou URLs de callback.
- Restauração valida/renova o refresh token com Auth antes de liberar o perfil;
  ações revalidam sessão. Nenhum serviço/timer em segundo plano foi introduzido.
- Falha de rede não apaga a sessão protegida. Refresh inválido encerra o acesso.
  Corrupção/falha de storage bloqueia a restauração; oferece limpar sessão local.
- Logout limpa sessão/verifier locais mesmo quando a revogação remota falha;
  a interface informa a limitação. Tokens já emitidos podem permanecer válidos
  até expiração no servidor. Não há promessa de revogação de todas as sessões.
- Limitações: Keystore/dispositivo comprometido, aparelho desbloqueado, root e
  malware no processo não são resolvidos por criptografia em repouso. Não se
  exige biometria a cada abertura nem integra Play Integrity nesta etapa.

## Evidência

Rodada local em 19/10/2026, JDK17/SDK36 no Docker local já preparado:

- `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug`: aprovados,
  **58 testes, zero falhas**, lint “No issues found”. Incluem 29 regressões da
  PR #22 e 29 verificações de Auth, sessão, contratos e UI atual.
- SDK real com `MockEngine`, sem sockets: signup pendente e repetido, mensagens
  seguras por código GoTrue, login, reparação idempotente de legado, colunas
  explícitas/UID, refresh válido/inválido, logout offline e redirect externo negado.
  Confirmação PKCE após reabrir o repositório preserva verifier sem inventar sessão.
- Controller: dupla ação, callback durante restauração, sessão expirada,
  indisponibilidade, bloqueio anônimo e cadastro sem rota fictícia autorizada.
- Criptografia: AES-GCM com IV aleatório, AAD por finalidade, adulteração rejeitada,
  expiração do verifier e storage corrompido bloqueando restauração.
- Compose/Robolectric SDK35: cadastro/login, confirmação, moto indisponível,
  legado, mensagens, senha limpa e erro ao salvar mantendo valores. SDK26 cobre
  integração Auth simulada e abertura da fundação. Nenhum teste criou conta remota.
- `npm run verify`, 78 unitários web, cinco grupos SQL/PGlite e
  `npm audit --omit=dev`: aprovados; audit de produção com zero vulnerabilidades.
- `npm run test:e2e -- --workers=1 --retries=0`: **152 testes aprovados**
  (desktop/mobile, 6,6 minutos), sem retries. `git diff --check`: aprovado.
  Resultado final do CI registrado na PR.

O APK debug local tem **16.243.459 bytes**; assinatura v2 validada com `apksigner`.
SHA-256 local:
`896DFD5DE9AC9131F7D370B4821B5604CAB907C618D77BF14046BF8108B14D46`.
URL/chave do BuildConfig estão vazias; este APK exige configuração pública e
recompilação para homologação conectada. O APK do CI usa chave debug efêmera e
não precisa ter o mesmo hash/assinatura. APKs não são versionados.
Permissões verificadas: INTERNET e a permissão de receiver interno gerada pelo
AndroidX; nenhuma permissão de localização, serviço ou notificação.

### Capturas atuais

Capturas nativas Compose/PixelCopy, com dados sintéticos. Não representam um APK
executado em aparelho ou emulador. As imagens antigas fora de `screenshots/auth/`
continuam como histórico da PR #22, não como evidência de Auth atual.

| Cenário | Evidência |
| --- | --- |
| Criar conta, 390×844dp | [Conta](screenshots/auth/auth-01-account-390.png) |
| Confirmação pendente, 390×844dp | [Confirmação](screenshots/auth/auth-02-confirm-email-390.png) |
| Perfil concluído sem rota real | [Home](screenshots/auth/auth-03-home-390.png) |
| Cadastro antigo incompleto | [Legado](screenshots/auth/auth-04-legacy-profile-390.png) |
| Moto fora do catálogo | [Modelo indisponível](screenshots/auth/auth-05-model-unavailable-390.png) |
| Login, 390×844dp | [Login](screenshots/auth/auth-06-login-390.png) |
| E-mail não confirmado | [Mensagem acionável](screenshots/auth/auth-07-unconfirmed-390.png) |
| 320×640dp, fonte 150%, inset IME sintético 280dp | [Perfil](screenshots/auth/auth-08-profile-320-font150-ime.png), [sugestões](screenshots/auth/auth-09-suggestions-320-font150-ime.png) |
| 375×812dp, fonte 150% | [Login ampliado](screenshots/auth/auth-10-login-375-font150.png) |
| Erro de rede com nome/modelo longos | [Falha preservando dados](screenshots/auth/auth-11-save-error-390.png) |

### Revisão independente

`rpmdelivery_visual_critic` revisou, em sessão independente e somente leitura,
as 11 capturas e o código correspondente, sobre a base desta PR com alterações
locais. Nenhum P0/P1/P2/P3 permaneceu pendente na cobertura observada.

- **P3 corrigido:** “Atualizar cadastro” apenas recarregava o perfil; passou para
  “Recarregar dados”. A recaptura confirma o rótulo coerente com a ação.
- **Hipótese P2 não confirmada:** o erro de conclusão poderia ficar escondido
  após rolagem. Duas reproduções 390×844dp, incluindo campos legados longos,
  mantiveram a mensagem inteira visível e os valores digitados preservados.
  Não se comprovou esse comportamento nos tamanhos compactos.
- Identidade, máscara, campos preservados, separação entre conta e rota fictícia,
  fonte ampliada e ausência aparente de corte horizontal resistiram à inspeção.
  Nenhum frame Figma novo foi fornecido; a referência continua sendo a PR #22
  aprovada no aparelho, sem redesenho da marca ou das telas.

| Antes | Depois | Benefício |
| --- | --- | --- |
| “Atualizar cadastro” chamava apenas `reload()` | “Recarregar dados” | Explica a ação sem prometer edição |

**Limitações:** o Critic inspecionou imagens/código, sem interação própria. O
teclado/inset é sintético. O navegador integrado/Playwright não executa APKs;
não se usou réplica HTML como evidência Android. Teclado real, TalkBack, gestos,
Keystore em hardware, envio/recebimento de e-mail e Auth hospedado permanecem
pendentes de aparelho/ambiente autorizado. Os testes de cifra JCE não comprovam
comportamento do Keystore de fabricantes. A aprovação continua humana.
