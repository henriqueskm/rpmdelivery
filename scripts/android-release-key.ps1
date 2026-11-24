# Creates the RpmDelivery Motoboy release signing key, once, outside the project.
#
#   powershell -ExecutionPolicy Bypass -File scripts\android-release-key.ps1
#
# - Folder: %USERPROFILE%\.rpmdelivery\courier-release (never inside the repository).
# - Random passwords, written only to signing.properties in that folder; never printed.
# - Refuses to run again if the key already exists: a new key could not update the installed app.
# - Prints and saves the SHA-256 fingerprint (public): it goes in assetlinks.json and in Google's
#   developer registration. See docs/android-release.md.
#
# Messages are plain ASCII on purpose: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.

$ErrorActionPreference = "Stop"
$folder = Join-Path $env:USERPROFILE ".rpmdelivery\courier-release"
$store = Join-Path $folder "rpm-courier-release.jks"
$alias = "rpm-courier"

if (Test-Path $store) {
    Write-Host "A chave ja existe em $store. Nada foi alterado."
    Write-Host "Nao apague nem troque essa chave: o app instalado so aceita atualizacoes assinadas com ela."
    exit 1
}

# keytool: JAVA_HOME, the JBR used for the Android build, Android Studio's JBR, or the PATH.
$candidates = @()
if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME "bin\keytool.exe" }
$candidates += Join-Path $env:USERPROFILE ".jdks\jbr-21.0.11\bin\keytool.exe"
$candidates += "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
$keytool = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $keytool) {
    $found = Get-Command keytool -ErrorAction SilentlyContinue
    if ($found) { $keytool = $found.Source }
}
if (-not $keytool) { Write-Host "Nao encontrei o keytool (vem com o Java/Android Studio)."; exit 1 }

function New-Secret {
    $chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

New-Item -ItemType Directory -Force $folder | Out-Null
# PKCS12 keeps one password for the store and the key. Passed through the environment, not the command line.
$env:RPM_KEY_SECRET = New-Secret
try {
    & $keytool -genkeypair -keystore $store -storetype PKCS12 -alias $alias -keyalg RSA -keysize 4096 `
        -validity 10000 -dname "CN=RpmDelivery Motoboy, O=RpmDelivery, C=BR" `
        -storepass:env RPM_KEY_SECRET -keypass:env RPM_KEY_SECRET | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool nao criou a chave." }

    $properties = @(
        "# RpmDelivery Motoboy release key. Keep this folder backed up; never commit or send it.",
        "storeFile=rpm-courier-release.jks",
        "storePassword=$($env:RPM_KEY_SECRET)",
        "keyAlias=$alias",
        "keyPassword=$($env:RPM_KEY_SECRET)"
    )
    Set-Content -Path (Join-Path $folder "signing.properties") -Value $properties -Encoding ASCII

    $listing = & $keytool -list -v -keystore $store -storetype PKCS12 -alias $alias -storepass:env RPM_KEY_SECRET
    $sha256 = ($listing | Select-String -Pattern "SHA256:\s*([0-9A-F:]+)").Matches[0].Groups[1].Value
    Set-Content -Path (Join-Path $folder "fingerprint.txt") -Value $sha256 -Encoding ASCII
} finally {
    Remove-Item Env:\RPM_KEY_SECRET -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Chave criada em: $folder"
Write-Host "Impressao digital SHA-256 (publica, pode mandar para o Claude):"
Write-Host "  $sha256"
Write-Host ""
Write-Host "IMPORTANTE: copie a pasta inteira para dois lugares seguros (pen drive e nuvem particular)."
Write-Host "Sem ela, nao da para atualizar o app nos celulares dos motoboys nem registrar o app no Google."
Write-Host "Nunca envie signing.properties ou o arquivo .jks para ninguem, nem coloque no projeto."
