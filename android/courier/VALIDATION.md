# RPM-ANDROID-001 · Evidências e limites

Base: `b93b2ffab8f0dd172ceae0e63367f58c25f4feb9`, main após o merge da PR #21.
Branch: `feat/android-courier-foundation`. Implementação exclusivamente nova em
`android/courier` e workflow Android próprio; nenhum arquivo web, dependência
npm, migration, configuração Auth ou Supabase foi alterado.

## Ambiente de execução

Não havia Java, Gradle ou Android SDK no PATH do Windows. Foi iniciado o Docker
Desktop já instalado e criado o container próprio `rpm-android-foundation`, com
imagem oficial Temurin JDK 17.0.20.1. SDK Android 36 e Build Tools 35.0.0 foram
instalados somente nesse ambiente de build, sem instalação global no Windows.
Nenhum container/banco existente do usuário foi reutilizado ou inspecionado.

O wrapper Gradle 8.14.6 foi gerado pela distribuição oficial, com JAR e ZIP
conferidos pelos SHA-256 oficiais:

- JAR: `ad16bca46cb71bb5887c546860d93992aeee35c1fdaf4a242b0a612375d937e0`.
- ZIP: `7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24`.

## Verificações

Execução local concluída: `:app:assembleDebug :app:testDebugUnitTest
:app:lintDebug` — **BUILD SUCCESSFUL**, nove testes aprovados, sem falhas ou
skips. Lint passou com `warningsAsErrors`. `npm ci` e
`npm run verify` também passaram, sem alterar arquivos npm. O resultado do
GitHub Actions é registrado na Draft PR com o HEAD correspondente.

A primeira execução Android no GitHub encontrou `sdkmanager: command not found`
no runner, antes de compilar. O workflow passou a instalar explicitamente as
Command-line Tools 19.0 (13114758), Platform 36 e Build Tools 35.0.0 com
`android-actions/setup-android` v4 fixada por SHA, sem depender de SDK prévio.

Na execução seguinte, APK e nove testes passaram, mas o lint do runner
identificou `OldTargetApi` para o alvo 36. A recomendação de alvo mais recente
permanece visível como informativa: o alvo 36 é intencional na coorte AGP 8.13
validada; não se fez um salto de toolchain para apenas satisfazer esse aviso.
Todos os outros avisos seguem bloqueantes. Não há baseline nem desativação
global. A atualização/homologação do alvo é requisito antes de release.

A suíte nativa contém nove testes:

- feedback local de e-mail, senha fictícia e campos obrigatórios;
- contraste calculado ≥4,5:1 nas combinações principais de texto/ação;
- navegação pelas quatro telas e descarte dos campos ao sair do login;
- cadastro demonstrativo e confirmação explícita de que não criou conta;
- três ações da rota abrem avisos, sem alterar pedido ou contador;
- alvos de ação ≥48dp, endereço longo e reflow em 320dp/fonte150%;
- Activity real em SDK26/Robolectric, abertura e restauração da tela escolhida.

Os testes de tela usam Compose UI Test + Robolectric SDK35, renderização nativa
em JVM. O smoke mínimo usa SDK26. Isso não é Android instrumentado nem aparelho
físico. PixelCopy do Robolectric produz as capturas; `captureToImage` do Compose
1.10 dependia de um callback real de RenderThread ausente nesse ambiente e foi
substituído somente no helper de testes, sem alterar o produto ou remover asserts.
[Limitação upstream](https://github.com/robolectric/robolectric/issues/8071).

A primeira execução web concorrente com a compilação Android teve 151 passes
e uma falha de temporização no teste preexistente mobile de cancelamento de
autocomplete (`onboarding-address.spec.ts:70`, esperava uma request, recebeu 0).
Não foi editado o teste, aumentado retry ou alterado o Next.js. A rechecagem
sequencial passou com **152/152, zero retries**, em 5,7 minutos. O resultado
do CI é discriminado no PR.

## Capturas

A [referência aprovada](docs/reference-my-route.png) é a imagem enviada pelo
usuário. Nenhum frame Figma adicional foi fornecido; não se afirma validação no
Figma. O raio e suas cores vêm do design system web existente.

Capturas são da Activity renderizada pelo Robolectric, com configurações
390×844dp/mdpi e 320×640dp/mdpi; não incluem uma sessão real de System UI.
O cadastro exige rolagem: há imagem do início e outra da seção da moto.

- [Boas-vindas](docs/screenshots/01-welcome-390.png).
- [Login](docs/screenshots/02-login-390.png).
- [Cadastro: início](docs/screenshots/03-registration-390.png) e
  [dados da moto](docs/screenshots/03-registration-motorcycle-390.png).
- [Minha rota](docs/screenshots/04-route-390.png).
- [320dp/fonte 150%: endereço](docs/screenshots/05-route-320-large-font-address.png)
  e [ações após rolagem](docs/screenshots/05-route-320-large-font-actions.png).

APK debug local: 11.875.478 bytes, assinatura debug verificada com `apksigner`,
SHA-256 `4088DE99DED7D9ACDA8AEBF6FD4EE3A0F9DBC07DBD1BA172FB2AF11C502574A4`.
O manifesto empacotado não solicita internet, localização ou notificações;
contém apenas a permissão interna signature de receiver do AndroidX.
O APK não é versionado. O CI fornece seu próprio APK debug como artefato,
com assinatura/hash próprios do ambiente; não é um release de produção.

## Revisão independente

`rpmdelivery_visual_critic` atua somente em leitura por imagens e código, sem
executar testes, corrigir código ou aprovar a PR. Na rodada final inspecionou
os sete PNGs e não encontrou achados P0–P3 nos cenários cobertos: hierarquia da referência,
distinção demo/real, campos, endereço e ações permaneceram claros; o endereço
longo quebra integralmente e as ações ficam acessíveis por rolagem em 320dp.
A sessão independente aplicou as instruções do TOML existente; esta superfície
não comprova invocação nativa por `agent_type`. Não houve navegador executando
APK nem inspeção em aparelho. O Critic não mediu contraste nem testou TalkBack,
IME, gestos, insets reais, orientação ou fontes ampliadas nos formulários.
O teste automatizado de contraste é evidência separada do Builder.

## Limitações reais

- Sem KVM no container. Não foram utilizados emulador Android, Android Studio
  ou aparelho conectado nesta sessão. Não foram testados teclado físico/virtual real, TalkBack, gestos,
  launcher/OEM, consumo de bateria/RAM, orientação física ou desempenho em rua.
- O navegador integrado não executa APK/Compose. Não foi feita uma réplica HTML
  para apresentar como prova do aplicativo; a evidência é o render nativo JVM.
- Contraste calculado e semântica/tamanho de controles não certificam toda a
  acessibilidade. É necessária homologação num Android básico antes de uso real.
- Tema claro fixo; barras de sistema configuradas coerentemente. Não há tema
  escuro do produto. A rotação preserva a tela escolhida, não os campos/senhas.
- Sem autenticação, persistência, GPS, mapas reais, notificações ou comandos
  operacionais. Não há garantia de funcionamento dessas integrações futuras.
- APK debug é para revisão; release assinado, loja e distribuição de produção
  não foram configurados, compilados ou publicados.
- Todas as alterações locais anteriores do checkout principal ficam intactas;
  hashes dos arquivos anteriores são conferidos antes da entrega.

Comandos de Android Studio e execução estão no [README](README.md).
