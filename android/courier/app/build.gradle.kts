import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.rpmdelivery.courier"
    compileSdk = 36
    // The release key never enters the project: scripts/android-release-key.ps1 creates it, with its
    // passwords, in %USERPROFILE%\.rpmdelivery\courier-release (or the RPM_RELEASE_SIGNING file given).
    // Without it, assembleRelease still builds an unsigned APK. See docs/android-release.md.
    val signingFile = providers.gradleProperty("RPM_RELEASE_SIGNING")
        .orElse(File(System.getProperty("user.home"), ".rpmdelivery/courier-release/signing.properties").path)
        .map(::File).get()
    if (signingFile.exists()) {
        val signing = Properties().apply { signingFile.inputStream().use { load(it) } }
        signingConfigs.create("release") {
            storeFile = signingFile.resolveSibling(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }
    defaultConfig {
        // The real app. Debug builds keep the old ".demo" id (and "Prévia" label), so both can sit on one phone.
        applicationId = "com.rpmdelivery.courier"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.0.0"
        // Public client configuration only. Never read the web .env or privileged keys.
        val localAuth = Properties().apply {
            val file = rootProject.file("auth.local.properties")
            if (file.exists()) file.inputStream().use { load(it) }
        }
        val clientUrl = providers.gradleProperty("RPM_SUPABASE_URL").orElse(localAuth.getProperty("RPM_SUPABASE_URL", "")).get()
        val clientKey = providers.gradleProperty("RPM_SUPABASE_PUBLISHABLE_KEY").orElse(localAuth.getProperty("RPM_SUPABASE_PUBLISHABLE_KEY", "")).get()
        require(clientUrl.isEmpty() || clientUrl == "https://yyfbpmppdszmvhcruoyb.supabase.co") {
            "Use only the approved RpmDelivery project URL."
        }
        require(clientKey.isEmpty() || clientKey.matches(Regex("sb_publishable_[A-Za-z0-9_-]+"))) {
            "Only a public Supabase publishable key is accepted."
        }
        buildConfigField("String", "SUPABASE_URL", "\"$clientUrl\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"$clientKey\"")
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".demo"
            versionNameSuffix = "-preview"
        }
        release {
            // No code shrinking yet: R8 needs keep rules for supabase-kt/Ktor serialization, to be
            // validated on a phone before turning it on.
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.maxHeapSize = "2g"
            it.systemProperty("robolectric.graphicsMode", "NATIVE")
            // Robolectric 4.17 / Java 17 guidance; applies only to the test JVM.
            it.jvmArgs(
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.security=ALL-UNNAMED",
                "--add-opens=java.base/java.text=ALL-UNNAMED",
                "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                "--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
                "--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
            )
            it.testLogging.events("passed", "failed", "skipped")
        }
    }
    lint {
        warningsAsErrors = true
        checkReleaseBuilds = true
        // API 36 is intentional for the validated AGP 8.13 demo cohort.
        // Keep the newer-target advisory visible; reassess before a release.
        informational += "OldTargetApi"
        // Gradle 8.14.6 (SHA-256 pinned) and AGP 8.13 are the validated cohort. A newer patch
        // release on the server is an upgrade to plan, not a reason to fail every build.
        informational += "AndroidGradlePluginVersion"
    }
}
kotlin { jvmToolchain(17) }
dependencyLocking { lockAllConfigurations() }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Explicit compatibility cohort: SDK 3.8 targets Kotlin 2.4/newer R8.
    // Keep the validated Kotlin 2.3/AGP 8.13 toolchain; see docs/authentication.md.
    //noinspection NewerVersionAvailable
    implementation("io.github.jan-tennert.supabase:auth-kt:3.6.0")
    //noinspection NewerVersionAvailable
    implementation("io.github.jan-tennert.supabase:postgrest-kt:3.6.0")
    // Ktor version used by this exact SDK cohort, not an independent upgrade.
    //noinspection NewerVersionAvailable
    implementation("io.ktor:ktor-client-okhttp:3.4.3")
    // Reading the store's invite QR Code inside the app: CameraX preview + ML Kit's bundled QR model
    // (no Play services download, works offline). The camera is opened only while the reader is shown.
    // 1.7.0 needs compileSdk 36 and AGP 8.9.1+, both met by this cohort.
    val cameraX = "1.7.0"
    implementation("androidx.camera:camera-camera2:$cameraX")
    implementation("androidx.camera:camera-lifecycle:$cameraX")
    implementation("androidx.camera:camera-view:$cameraX")
    implementation("androidx.camera:camera-mlkit-vision:$cameraX")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    // Validated runner for the SDK 36 / Java 17 cohort; a newer Robolectric is its own upgrade.
    //noinspection NewerVersionAvailable
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    // Test transport/coroutines must match the selected runtime cohort.
    //noinspection NewerVersionAvailable
    testImplementation("io.ktor:ktor-client-mock:3.4.3")
    //noinspection NewerVersionAvailable
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
