// jkOS native shells — the Android build. See Documentation/agents/NATIVE.md.
//
// Three modules, three kinds of app (native/shells.js is the one list of which shell is which):
//   :twa       Trusted Web Activities — one flavor per shell (jkOS, KourOS). No app code.
//   :home      the jkOS Home launcher — our own WebView, origin policy, kiosk drawer.
//   :selector  jkOS Alpha — a native list of every app, each opened as a TWA. No WebView.

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
include(":twa", ":home", ":selector")
