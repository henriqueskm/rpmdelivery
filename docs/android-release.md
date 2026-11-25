# App do motoboy: versão final (release)

O app real é o **RpmDelivery Motoboy** (`com.rpmdelivery.courier`), assinado com a chave definitiva.
A versão de teste continua sendo `com.rpmdelivery.courier.demo` ("RpmDelivery · Prévia"), com a chave de
debug. As duas podem ficar instaladas no mesmo celular.

| | Teste (debug) | Final (release) |
|---|---|---|
| Pacote | `com.rpmdelivery.courier.demo` | `com.rpmdelivery.courier` |
| Nome na tela | RpmDelivery · Prévia | RpmDelivery Motoboy |
| Versão | `1.0.0-preview` | `1.0.0` (versionCode 4) |
| Assinatura | chave debug do PC | chave definitiva, fora do projeto |
| Demonstração com dados fictícios | aparece | escondida |

## 1. Criar a chave (uma vez só)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-release-key.ps1
```

- **Onde fica:** em `%USERPROFILE%\.rpmdelivery\courier-release`, com `rpm-courier-release.jks`, `signing.properties` (as senhas, geradas ao acaso) e `fingerprint.txt`.
- **Nada disso entra no projeto.** O `.gitignore` também recusa `*.jks` e `*.keystore`.
- **Faça backup da pasta em dois lugares**, por exemplo um pen drive e uma nuvem particular. Sem a chave:
  - o app instalado não aceita atualização;
  - não dá para registrar o app no Google.
- **O script não roda de novo** se a chave já existe.
- **A impressão digital SHA-256 é pública.** Ela vai para:
  - `public/.well-known/assetlinks.json`, para o link de convite abrir o app;
  - o registro do app no Google.

## 2. Montar o APK final

```powershell
cd android\courier
$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jbr-21.0.11"
.\gradlew.bat :app:assembleRelease
```

- **Endereço e chave pública do Supabase:** vêm de `auth.local.properties`, como na versão de teste. Só a publishable key é aceita.
- **Arquivo gerado:** `app/build/outputs/apk/release/app-release.apk`.
- **Sem a pasta da chave,** o build gera `app-release-unsigned.apk`, que não instala.
- **Chave em outro lugar:** indique o arquivo com `-PRPM_RELEASE_SIGNING=<caminho>\signing.properties`.
- **Sem encolhimento de código (R8) por enquanto:** o supabase-kt e o Ktor precisam de regras próprias, e isso só deve ser ligado depois de testado num celular.

Para cada nova versão, aumente `versionCode` e `versionName` em `android/courier/app/build.gradle.kts`.

## 3. Distribuir

Desde 30/09/2026, no Brasil, o Android em celulares certificados exige que os apps sejam de desenvolvedores verificados. Ver a [verificação de desenvolvedores do Android](https://developer.android.com/developer-verification/guides).

| Caminho | Custo | Para o motoboy |
|---|---|---|
| **Teste interno da Google Play** | US$ 25, uma vez (conta da Play Console, com documento) | Instala e atualiza pela Play Store, por convite (até 100 pessoas) |
| **Distribuição limitada** (Android Developer Console) | Grátis, sem documento | APK por link, em até 20 aparelhos convidados |
| **Conta completa** (Android Developer Console) | US$ 25, uma vez, com documento | APK por link em qualquer aparelho |
| **Sem registro** | Grátis | APK por link com o "fluxo avançado": modo desenvolvedor e espera de 24 h, ou instalação por cabo (ADB) |

**Escolha do piloto: distribuição limitada.**
- **Cadastro dos celulares:** cada celular de motoboy entra na lista uma vez, por convite (QR Code ou link), com o aceite no próprio celular. Depois disso, o APK baixado pelo link instala normalmente.
- **Atualizações:** fora da Play Store, o app não se atualiza sozinho. Cada versão nova precisa de:
  - mais um no `versionCode`;
  - a assinatura com a mesma chave;
  - publicação no mesmo link.

  O motoboy baixa e instala por cima, sem perder a conta nem os dados.

Em todos os caminhos com registro, o pacote `com.rpmdelivery.courier` é registrado com a impressão digital da chave, e é preciso provar que se tem a chave assinando um APK.

## Política de privacidade

- **Página:** `https://rpmdelivery.vercel.app/privacidade` (`app/privacidade/page.tsx`). O app abre essa página pelo menu (☰ → "Política de privacidade").
- **Responsável e e-mail:** ficam em `features/legal/privacy-contact.ts`.

O que a página diz segue o que o sistema faz:
- **Cadastro do motoboy:** nome, e-mail, celular e moto (modelo, placa e cor), em `SupabaseCourierAuth.kt`.
- **Localização:** só na rota, com o aviso fixo do serviço. Sem localização em segundo plano (`AndroidManifest.xml`).
- **Câmera:** só para ler o QR do convite.
- **Link de acompanhamento:** vale 24 h depois da entrega ou do cancelamento (`docs/delivery-core-commands.md`).
- **Backup:** o app não guarda cópia de segurança (`allowBackup="false"`).

**Falta para a Play Store:** a Google Play exige que quem cria conta no app possa pedir a exclusão dentro do app e por uma página na web. Hoje a exclusão é pedida por e-mail, pela política.
