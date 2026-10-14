// jkOS native shells — the Android build. See Documentation/agents/NATIVE.md.
//
// The modules, one per kind of app (native/shells.js is the one list of which shell is which):
//   :twa     Trusted Web Activities — one flavor per shell (jkOS, KourOS). No app code.
//   :home    the jkOS Home launcher — our own WebView, origin policy, kiosk drawer.
//   :<app>   a NATIVE app (android: 'native'), named after its start app — :kouros is
//            KourOS Alpha. Included from shells.json's `native` list, not typed here.

pluginManagement {
    repositories {
        // ⚠️ Content-filtered on purpose. Without a filter Gradle asks EVERY repository for
        // every coordinate, so a same-named package published to the second repo can win
        // (dependency confusion). Google's repo serves only Google/AndroidX groups here.
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "jkos-native"
include(":twa", ":home")

@Suppress("UNCHECKED_CAST")
val nativeShells = (groovy.json.JsonSlurper().parse(file("shells.json")) as Map<String, Any>)["native"]
    as List<Map<String, Any>>? ?: emptyList()
nativeShells.forEach { include(":${it["module"]}") }
