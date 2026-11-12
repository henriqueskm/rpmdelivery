# RpmDelivery · Motoboy Android

Aplicativo nativo Kotlin + Jetpack Compose + Material 3, isolado do Next.js.
RPM-ANDROID-002 adiciona Auth real e conclusão do cadastro via RPC existente.
**Minha rota permanece uma prévia independente**, sem operações reais.

Sem configuração, o APK abre, permite conhecer a prévia e informa que login/cadastro
não estão conectados. Nenhum usuário remoto é criado pelos testes ou pelo build.

## Executar

1. Abrir esta pasta (`android/courier`) no Android Studio, com JDK **17**.
2. Instalar SDK Platform **36**, Build Tools **35.0.0**, aceitar licenças e sincronizar.
3. Usar Android **8.0/API 26+**. Nenhuma configuração web/`.env.local` é utilizada.
4. Para homologação autorizada de Auth: copiar `auth.local.properties.example` para
   `auth.local.properties` (ignorado), preenchendo somente a publishable key pública.
   Não colocar senha de usuário, banco ou chave privilegiada. Consultar os
   [contratos, segurança e configuração de redirect](docs/authentication.md).
5. Confirmação por deep link depende da allowlist/template hospedados. Esta PR
   não os modifica. Confirmação no e-mail + login manual continua alternativa.

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug
```

Linux/macOS: `bash ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`.
APK em `app/build/outputs/apk/debug/app-debug.apk`. Instalar em aparelho de teste
com `adb install -r <apk>`, se a assinatura instalada for a mesma. O CI utiliza
chave debug efêmera; não desinstalar uma versão com dados importantes sem avaliar
as consequências. Não há assinatura de release, deploy ou Play Store nesta etapa.
App ID preservado: `com.rpmdelivery.courier.demo`, rótulo “RpmDelivery · Prévia”.

## Ferramentas

AGP **8.13.2**, Gradle **8.14.6**, JDK **17**, Kotlin/Compose compiler **2.3.20**,
Compose BOM **2026.02.01**, Activity Compose **1.13.0**. Compile/target SDK36, min26.
O BOM 2026.09/Compose1.12 exige outra coorte AGP/SDK e não integra esta base.
Wrapper e distribuição possuem SHA-256 verificado/fixado. Nenhuma versão dinâmica.

Auth/PostgREST supabase-kt **3.6.0**, engine Ktor OkHttp **3.4.3**. Sem Storage,
Realtime, mapas, GPS, Room, WorkManager, DI ou bibliotecas pesadas de navegação.
INTERNET é a única permissão adicional; sem serviços/processos em segundo plano.
Tema claro, cores, raio minimalista, máscara de celular e catálogo da PR #22 preservados.

Lint mantém `warningsAsErrors`; `OldTargetApi` continua informativo pela coorte
AGP8.13/SDK36 validada. Sem baseline ou supressão global. Reavaliar antes de release.
Os cinco avisos locais de versões mais recentes da coorte Auth/Ktor são
documentados em [autenticação](docs/authentication.md); não alteram os demais gates.
[Compatibilidade oficial AGP](https://developer.android.com/build/releases/agp-8-13-0-release-notes).

## Organização

```text
app/src/main/java/com/rpmdelivery/courier/
  MainActivity.kt       # Activity, ciclo de vida e entrega do callback
  auth/                 # contratos, SDK, controller, ViewModel, storage Keystore
  registration/         # celular e catálogo locais, sem rede
  demo/                 # fixture separada de rota e validação de campos
  ui/CourierApp.kt      # navegação e estados do fluxo conectado
  ui/components/        # marca, campos, ações e sugestões
  ui/screens/           # conta, perfil, boas-vindas e rota demonstrativa
  ui/theme/             # design aprovado
app/src/debug/          # previews puros, sem inicializar Auth
app/src/test/           # mocks, contratos HTTP, domínio, segurança, Compose
```

As antigas telas/formulários demonstrativos da PR #22 foram movidos para fixtures
em `src/test`; não entram no APK e não criam um caminho alternativo de falso login.
Seus testes de máscara, catálogo, teclado e layout continuam como regressão, junto
com testes do fluxo atual. Não inferir cobertura de Auth a partir dessas fixtures.

## Validação e limites

Ver [autenticação](docs/authentication.md) para resultados, evidências e homologação.
[VALIDATION.md](VALIDATION.md) e [cadastro 001B](docs/registration.md) preservam o
registro histórico da fundação. O pipeline gera APK debug e relatórios por sete dias.
Robolectric renderiza Compose e testa interações sem emulador: não equivale a
aparelho real, teclado/IME real, TalkBack ou Keystore em hardware.

O navegador integrado e Playwright validam o projeto web, não executam APKs.
Não se usa uma réplica HTML como evidência de Android. Testes conectados de Auth,
confirmação e rotas reais dependem de autorização e homologação próprias.
