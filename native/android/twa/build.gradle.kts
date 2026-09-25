// :twa — the Trusted Web Activity shells (native/shells.js rows with android: 'twa').
//
// One product flavor per shell, read from the generated shells.json; each flavor's origins,
// name, colours and shortcuts are in its generated src/<shell><Debug|Release>/res/. There is
// no app code here: androidbrowserhelper's LauncherActivity asks Chrome to open the start
// origin with its URL bar removed, and Chrome does everything else.

import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
}

@Suppress("UNCHECKED_CAST")
val shells = JsonSlurper().parse(rootProject.file("shells.json")) as Map<String, Any>

android {
    namespace = "net.jkos.twa"

    flavorDimensions += "shell"
    productFlavors {
        @Suppress("UNCHECKED_CAST")
        for (shell in shells["twa"] as List<Map<String, Any>>) {
            create(shell["id"] as String) {
                dimension = "shell"
                applicationId = shell["package"] as String
            }
        }
    }
}

dependencies {
    implementation(libs.androidbrowserhelper)
}
