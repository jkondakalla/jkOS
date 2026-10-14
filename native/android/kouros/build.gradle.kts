// :kouros — KourOS Alpha, the NATIVE KourOS app (native/shells.js: android: 'native').
//
// No WebView, no page: Compose draws it, Media3 plays it, and it reaches KourOS's API with a
// Bearer token from jkAuth's native sign-in. Its package, channel and every URL it trusts are
// generated (shells.json + src/<debug|release>/res/values/shell.xml) — none is typed here.
//
// The pure parts (PKCE, the play-context encoder, the listen ledger, the API's JSON shapes)
// carry no Android import on purpose, so `:kouros:testDebugUnitTest` holds them on the JVM.

import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

@Suppress("UNCHECKED_CAST")
val shell = ((JsonSlurper().parse(rootProject.file("shells.json")) as Map<String, Any>)["native"] as List<Map<String, Any>>)
    .single { it["module"] == project.name }
val playContextCases: File = rootProject.file("../play-context-cases.json")

android {
    namespace = "net.jkos.kouros"

    defaultConfig {
        applicationId = shell["package"] as String
        // 0.1.0 → 0.1.0-alpha; the debug build type then appends -staging (root build.gradle.kts).
        versionNameSuffix = shell["versionSuffix"] as String
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests.all { test ->
            test.inputs.file(playContextCases)
            test.systemProperty("jkos.playContextCases", playContextCases.absolutePath)
        }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
    testImplementation(libs.json)
}
