# RpmDelivery · Motoboy Android

Fundação **nativa Android**, Kotlin + Jetpack Compose + Material 3, independente
do Next.js. APK demonstrativo, sem autenticação, banco, mapas, GPS ou operações
reais. Nenhum endpoint, credencial, permissão de internet/localização, serviço
ou processo em segundo plano. Use apenas dados fictícios nos formulários.

## Abrir e executar

1. No Android Studio estável com suporte a AGP 8.13, abra **esta pasta**
   (`android/courier`), sem importar a raiz Next.js como projeto Android.
2. Selecione **JDK 17** em Settings → Build Tools → Gradle → Gradle JDK.
3. No SDK Manager, instale Android SDK Platform **36** e Build Tools **35.0.0**.
   Aceite as licenças do SDK pela interface do Android Studio.
4. Aguarde o Gradle Sync. Execute a configuração `app` num emulador ou aparelho
   Android **8.0/API 26 ou superior**. Não é necessário `.env` ou conta Supabase.

PowerShell, a partir desta pasta, com JDK 17 e SDK configurados:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug
```

Linux/macOS: `bash ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`.
O Android Studio pode gerar `local.properties` com `sdk.dir`; esse arquivo,
chaves, caches e builds são ignorados. Não versionar configuração pessoal.

APK: `app/build/outputs/apk/debug/app-debug.apk`.
Instalação em aparelho de teste autorizado: `adb install -r <caminho-do-apk>`.
App ID separado: `com.rpmdelivery.courier.demo`, rótulo “RpmDelivery · Demo”.
Assinatura debug para revisão; nenhuma chave de release ou distribuição de
produção é configurada. O CI também disponibiliza o APK por sete dias.

## Ferramentas e dependências

Versões fixas estáveis: AGP **8.13.2**, Gradle **8.14.6**, JDK **17**, Kotlin e
plugin Compose **2.3.20**, Compose BOM **2026.02.01**, Activity Compose **1.13.0**.
Compile/target SDK 36; min SDK 26. Sem versões dinâmicas, alpha, beta ou RC.
O BOM foi escolhido para compatibilidade com AGP 8.13/SDK 36; a linha Compose
1.12 do BOM 2026.09 exige AGP 9.1/SDK 37 e não integra esta base.

`OldTargetApi` permanece no relatório lint como **informativo**, pois o alvo 36
é intencional nesta coorte validada (AGP 8.13 suporta até API 36.1). Os demais
avisos continuam bloqueantes com `warningsAsErrors`; não há baseline ou
desativação global. Antes de distribuir um release, atualizar e homologar a
coorte para o Android mais recente e reavaliar esse aviso. Não há alegação de
homologação em API 37 ou atendimento aos requisitos futuros da Play Store.

- [Compatibilidade AGP/Gradle/JDK](https://developer.android.com/build/releases/agp-8-13-0-release-notes).
- [BOM e compiler Compose](https://developer.android.com/develop/ui/compose/bom).
- Runtime: AndroidX Activity/Compose/Material 3; sem biblioteca de ícones extensa,
  navegação, DI, cliente HTTP ou fonte baixada. Vetor do raio copia o caminho
  existente de `components/brand.tsx`; a marca web não foi alterada.
- Testes: JUnit 4, Compose UI Test e Robolectric **4.17**, apenas escopo test.
  Permitem renderizar Compose e testar ações sem instalar emulador no computador.
  **Não equivalem a teste no Android real.**
- Wrapper padrão gerado pelo Gradle 8.14.6, JAR
  conferido pelo SHA-256 oficial. A distribuição também tem SHA-256 fixado em
  `gradle-wrapper.properties`.

## Organização e evolução

```text
app/src/main/java/com/rpmdelivery/courier/
  MainActivity.kt       # única Activity e edge-to-edge
  demo/                 # fixture e feedback local dos formulários
  ui/
    CourierDemoApp.kt   # navegação demonstrativa em memória
    components/         # campos, marca, avisos e ações comuns
    screens/            # boas-vindas, login, cadastro, minha rota
    theme/              # cores semânticas e tipografia Material 3
app/src/debug/          # previews do Android Studio, fora do release
app/src/test/           # JUnit/Compose/Robolectric
```

Uma única Activity/módulo é suficiente nesta fundação. Não há repositórios
falsos nem abstrações vazias. Em tarefas futuras, regras operacionais puras
podem entrar em `domain/`, repositórios e Room em `data/`, WorkManager em
`sync/`, GPS em adaptador próprio e Supabase em `data/remote/`. ViewModels
podem coordenar estado e ciclo de vida quando existir lógica assíncrona real.
Esses componentes **ainda não estão instalados nem integrados**.

Não reutilizar a fixture como contrato de autorização. A rota “Em rota” é um
snapshot fictício já iniciado, sem comandos de atribuir/liberar/iniciar rota.
Futuras ações dependerão da identidade real, autorização e regras do backend.

## Telas e comportamento da demonstração

- Boas-vindas: acesso ao login, cadastro e atalho para conhecer Minha rota.
- Login: feedback local de campos; qualquer combinação fictícia válida navega
  para a prévia. Não comprova autenticação nem cria sessão.
- Cadastro: dados básicos e da moto; confirmação explica que nenhuma conta foi
  criada. Campos ficam só na composição e são descartados ao sair da tela.
  Senhas não usam `rememberSaveable`, logs ou armazenamento.
- Minha rota: mesma hierarquia da imagem aprovada — status, contador, pedido,
  endereço, navegação, conclusão verde e tentativa sem sucesso. Botões abrem
  avisos demonstrativos; não abrem mapas, alteram pedido ou criam ocorrências.

Conteúdo rolável, largura máxima de 480dp, insets e teclado respeitados, fontes
do sistema e ações com no mínimo 48dp (principais 56/64dp). Sem animação
decorativa, timer, alerta automático ou obrigação de interagir durante o trajeto.
O app não detecta movimento: usar as ações somente com a moto parada em local
seguro, como indicado nas telas.

## QA e evidências

`testDebugUnitTest` cobre feedback de campos, navegação local, descarte dos
campos, cadastro, diálogos sem mutação e controles acessíveis. Também exercita
320dp com fonte de 150% e endereço longo. As imagens renderizadas por
Robolectric ficam em `app/build/outputs/demo-screenshots/`; não são fotos de
emulador/aparelho. Previews Compose estão disponíveis no Android Studio.

O workflow `Android courier` executa build, testes e lint em Ubuntu/JDK 17,
com permissões somente de leitura e sem secrets, assinatura release ou deploy.
Os workflows web existentes permanecem intactos.

Resultados executados, capturas e limitações desta entrega serão registrados
em [VALIDATION.md](VALIDATION.md) e na Draft PR. Antes de conectar dados reais,
homologar em aparelho Android básico, teclado, TalkBack, gestos/insets,
orientação e escala de fontes; confirmar comportamento real de mapas e Auth
somente nas tarefas autorizadas correspondentes.
