// :home — jkOS Home, the home-screen launcher (native/shells.js: android: 'home').
//
// Unlike the TWAs this is our own code around our own WebView, because a home screen must
// stay usable with the network down and hide the device's apps behind a gesture — neither
// of which Chrome can do for us. So it is also the one shell with an attack surface worth a
// test: OriginPolicy is held to native/origin-cases.json, the same vectors the desktop
// shell's policy passes.

import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
}

@Suppress("UNCHECKED_CAST")
val shells = JsonSlurper().parse(rootProject.file("shells.json")) as Map<String, Any>
val originCases: File = rootProject.file("../origin-cases.json")

android {
    namespace = "net.jkos.home"

    defaultConfig {
        applicationId = (shells["home"] as Map<*, *>)["package"] as String
    }

    testOptions {
        unitTests.all { test ->
            test.inputs.file(originCases)
            test.systemProperty("jkos.originCases", originCases.absolutePath)
        }
    }
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
    testImplementation(libs.json)
}
