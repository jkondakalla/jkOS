// :selector — jkOS Alpha, the whole suite as one download (native/shells.js: android: 'selector').
//
// A native list of every app the shell reaches; a tap hands that app's URL to
// androidbrowserhelper's LauncherActivity, which opens it as a Trusted Web Activity exactly as
// the :twa shells do. Our code draws the list and nothing else — no WebView, no permissions —
// so, as with a TWA, nothing of ours runs beside a page. The list itself is generated into
// src/<debug|release>/res/ by native/gen-native.mjs.

import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
}

@Suppress("UNCHECKED_CAST")
val selector = (JsonSlurper().parse(rootProject.file("shells.json")) as Map<String, Any>)["selector"] as Map<String, Any>

android {
    namespace = "net.jkos.selector"

    defaultConfig {
        applicationId = selector["package"] as String
        // The channel rides in the version itself (0.1.0-alpha, 0.1.0-alpha-staging), so an
        // installed alpha says what it is in Android's own app info, not only on its screen.
        versionNameSuffix = selector["versionSuffix"] as String
    }
}

dependencies {
    implementation(libs.androidbrowserhelper)
}
