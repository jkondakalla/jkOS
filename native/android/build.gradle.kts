// jkOS native shells — what every Android app here shares.
//
// The per-shell facts (package ids, names, origins, icons, bar colours) are NOT typed here.
// native/gen-native.mjs derives them from native/shells.js and each start app's web manifest
// into shells.json and each variant's res/; this file only reads them. The SDK levels the
// build asks for come from toolchain.json — the same file the installer reads — so the SDK
// that is installed and the SDK that is asked for cannot disagree.

import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.variant.ApplicationAndroidComponentsExtension
import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application) apply false
}

@Suppress("UNCHECKED_CAST")
fun json(path: String) = JsonSlurper().parse(file(path)) as Map<String, Any>

val toolchain = json("toolchain.json")
val shells = json("shells.json")
val repoRoot: Directory = layout.projectDirectory.dir("../..")

/** The repo-relative maskable icon of the shell a variant builds. */
@Suppress("UNCHECKED_CAST")
fun iconFor(module: String, flavor: String?): String = when (module) {
    "twa" -> (shells["twa"] as List<Map<String, Any>>).single { it["id"] == flavor }["icon"] as String
    "home" -> (shells["home"] as Map<String, Any>)["icon"] as String
    else -> throw GradleException("no shell icon rule for module :$module")
}

/**
 * Copies a shell's web maskable icon into a generated res dir as `ic_launcher_art` — the one
 * name every adaptive icon here points at. The APK's icon IS the web app's icon: nothing is
 * redrawn, and nothing is committed twice (a web file name like `icon-maskable-512.png` is
 * not a legal Android resource name, hence the copy rather than a source-set path).
 */
abstract class ShellIcon : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val source: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val dir = outputDir.get().dir("drawable-nodpi").asFile
        dir.deleteRecursively()
        dir.mkdirs()
        source.get().asFile.copyTo(File(dir, "ic_launcher_art.png"))
    }
}

// ⚠️ RELEASE SIGNING COMES FROM THE ENVIRONMENT ONLY. The keystore is the apps' permanent
// identity and lives outside the repo (~/.jkos/android-release.keystore — see signing.mjs);
// its password is never written to a file. With JKOS_ANDROID_KEYSTORE unset, a release build
// produces an explicitly UNSIGNED apk rather than quietly signing with a debug key.
val keystore = providers.environmentVariable("JKOS_ANDROID_KEYSTORE")
val keystorePassword = providers.environmentVariable("JKOS_ANDROID_KEYSTORE_PASSWORD")

subprojects {
    plugins.withId("com.android.application") {
        extensions.configure<ApplicationExtension> {
            compileSdk = (toolchain["compileSdk"] as Number).toInt()
            buildToolsVersion = toolchain["buildTools"] as String

            defaultConfig {
                minSdk = 26
                targetSdk = 36
                versionCode = (shells["versionCode"] as Number).toInt()
                versionName = shells["version"] as String
            }

            signingConfigs {
                if (keystore.isPresent) {
                    create("jkos") {
                        storeFile = file(keystore.get())
                        storePassword = keystorePassword.orNull
                            ?: throw GradleException("JKOS_ANDROID_KEYSTORE is set but JKOS_ANDROID_KEYSTORE_PASSWORD is not")
                        keyAlias = "jkos"
                        keyPassword = storePassword // PKCS12: one password for store and key
                    }
                }
            }

            buildTypes {
                // A debug build is a STAGING build: it points at staging.jkos.net (its generated
                // res/ says so) and installs beside the release app, never over it.
                getByName("debug") {
                    applicationIdSuffix = shells["stagingSuffix"] as String
                    versionNameSuffix = "-staging"
                }
                getByName("release") {
                    isMinifyEnabled = false
                    signingConfig = signingConfigs.findByName("jkos")
                }
            }

            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
        }

        extensions.configure<ApplicationAndroidComponentsExtension> {
            onVariants { variant ->
                val icon = iconFor(project.name, variant.flavorName)
                val task = tasks.register<ShellIcon>("${variant.name}ShellIcon") {
                    source.set(repoRoot.file(icon))
                    outputDir.set(layout.buildDirectory.dir("generated/shell-icon/${variant.name}"))
                }
                variant.sources.res?.addGeneratedSourceDirectory(task, ShellIcon::outputDir)
            }
        }
    }
}
