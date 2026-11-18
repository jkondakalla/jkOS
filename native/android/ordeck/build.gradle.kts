// :ordeck — jkOS Alpha, the NATIVE app for the suite (native/shells.js: android: 'native').
// A native module is named after its start app.
//
// No WebView, no page: Compose draws it, Media3 plays it, and it reaches each app's API with a
// Bearer token from jkAuth's native sign-in. Its package, channel and every URL it trusts are
// generated (shells.json + src/<debug|release>/res/values/shell.xml) — none is typed here.
//
// The pure parts (PKCE, the play-context encoder, the listen ledger, the API's JSON shapes)
// carry no Android import on purpose, so `:ordeck:testDebugUnitTest` holds them on the JVM.

import com.android.build.api.artifact.SingleArtifact
import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// ── What the APK may ask for ──────────────────────────────────────────────────
// The manifest in src/main declares four permissions, but the APK carries the MERGED manifest,
// where every library's own <uses-permission> lands too: on the first Gradle build, Media3 had
// quietly added ACCESS_NETWORK_STATE. This list is held against the merged manifest of every
// variant, and `assemble` can't run without the check, so a dependency bump that brings in a
// permission fails the build instead of shipping it. check:native pins this list to the source
// manifest, so neither can change alone.
val ALLOWED_PERMISSIONS = listOf(
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    "android.permission.INTERNET",
    "android.permission.WAKE_LOCK",
)
// androidx.core's own, per package: a signature-level permission that keeps the app's receivers
// private on API < 33. Granted to no other app.
val SELF_PERMISSION = ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

abstract class CheckMergedPermissions : DefaultTask() {
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) abstract val mergedManifest: RegularFileProperty
    @get:Input abstract val allowed: ListProperty<String>
    @get:OutputFile abstract val report: RegularFileProperty

    @TaskAction fun check() {
        val xml = mergedManifest.get().asFile.readText()
        val asked = Regex("""<uses-permission(?:-sdk-23)?\s[^>]*?android:name="([^"]+)"""")
            .findAll(xml).map { it.groupValues[1] }.toSortedSet()
        val want = allowed.get().toSortedSet()
        if (asked != want) {
            throw GradleException(
                "The merged manifest asks for permissions that aren't allowed.\n" +
                "  extra:   ${asked - want}\n  missing: ${want - asked}\n" +
                "A library merged one in, or the source manifest changed. Remove it with " +
                "tools:node=\"remove\" in src/main/AndroidManifest.xml, or allow it in " +
                "ALLOWED_PERMISSIONS (ordeck/build.gradle.kts) and check:native together.")
        }
        report.get().asFile.writeText(asked.joinToString("\n", postfix = "\n"))
    }
}

androidComponents {
    onVariants { variant ->
        val cap = variant.name.replaceFirstChar { it.uppercase() }
        val check = tasks.register<CheckMergedPermissions>("check${cap}Permissions") {
            mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            allowed.set(variant.applicationId.map { id -> ALLOWED_PERMISSIONS + (id + SELF_PERMISSION) })
            report.set(layout.buildDirectory.file("permissions/${variant.name}.txt"))
        }
        tasks.matching { it.name == "assemble$cap" }.configureEach { dependsOn(check) }
    }
}

@Suppress("UNCHECKED_CAST")
val shell = ((JsonSlurper().parse(rootProject.file("shells.json")) as Map<String, Any>)["native"] as List<Map<String, Any>>)
    .single { it["module"] == project.name }
val playContextCases: File = rootProject.file("../play-context-cases.json")
// The listening session's two case files, which the web's route.ts and the server's validate.js
// are held to as well (test/native.mjs).
val sessionModeCases: File = rootProject.file("../session-mode-cases.json")
val sessionStateCases: File = rootProject.file("../session-state-cases.json")
val sessionCommandCases: File = rootProject.file("../session-command-cases.json")
val hudShelfCases: File = rootProject.file("../hud-shelf-cases.json")
val beigeboardBodyCases: File = rootProject.file("../beigeboard-body-cases.json")
// The HUD's order on the phone, which the web's own loadHudState is held to as well (test/native.mjs).
val hudOrderCases: File = rootProject.file("../hud-order-cases.json")
// What a real Chromium computes for every suite token (test/token-identity.mjs writes it): the
// app's palette (look/Tokens.kt) is held to it, so the two faces can't drift from the web's.
val tokenBaseline: File = rootProject.file("../../packages/design/tokens/computed-baseline.json")

android {
    namespace = "net.jkos.app.alpha"

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
            test.inputs.file(sessionModeCases)
            test.systemProperty("jkos.sessionModeCases", sessionModeCases.absolutePath)
            test.inputs.file(sessionStateCases)
            test.systemProperty("jkos.sessionStateCases", sessionStateCases.absolutePath)
            test.inputs.file(sessionCommandCases)
            test.systemProperty("jkos.sessionCommandCases", sessionCommandCases.absolutePath)
            test.inputs.file(hudShelfCases)
            test.systemProperty("jkos.hudShelfCases", hudShelfCases.absolutePath)
            test.inputs.file(beigeboardBodyCases)
            test.systemProperty("jkos.beigeboardBodyCases", beigeboardBodyCases.absolutePath)
            test.inputs.file(hudOrderCases)
            test.systemProperty("jkos.hudOrderCases", hudOrderCases.absolutePath)
            test.inputs.file(tokenBaseline)
            test.systemProperty("jkos.tokenBaseline", tokenBaseline.absolutePath)
            // Robolectric runs offline, on the runtime jar Gradle resolved and verified.
            test.dependsOn(robolectricJars)
            test.systemProperty("robolectric.offline", "true")
            test.systemProperty("robolectric.dependency.dir", robolectricJars.get().destinationDir.absolutePath)
            // The screenshot renders run only when asked for (-Pjkos.screens), and write PNGs.
            if (project.hasProperty("jkos.screens")) {
                // Robolectric reaches into the JDK's internals, which JDK 21 closes by default.
                test.jvmArgs(
                    "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--add-opens=java.base/java.io=ALL-UNNAMED",
                    "--add-opens=java.base/java.lang=ALL-UNNAMED",
                )
                test.systemProperty("roborazzi.test.record", "true")
                test.systemProperty("jkos.screensDir", layout.buildDirectory.dir("screens").get().asFile.absolutePath)
                test.filter.includeTestsMatching("*ScreensTest*")
            } else {
                test.exclude("**/ScreensTest*")
            }
        }
        unitTests.isIncludeAndroidResources = true
    }
}

/**
 * Robolectric's Android runtime, resolved here so its checksum is pinned (verification-metadata.xml).
 * ⚠️ Copied OUT of the repo: Robolectric percent-encodes the path it loads the runtime from, and
 * "The Forge" becomes "The%20Forge", a directory that doesn't exist (TRAPS.md: the space).
 */
val robolectricAndroidAll: Configuration by configurations.creating { isTransitive = false }
val robolectricJars = tasks.register<Sync>("robolectricJars") {
    from(robolectricAndroidAll)
    into(File(System.getProperty("java.io.tmpdir"), "jkos-robolectric-jars"))
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
    // Screenshot renders (ScreensTest): test-only.
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.compose.ui.test.junit4)
    robolectricAndroidAll(libs.robolectric.android.all)
}
