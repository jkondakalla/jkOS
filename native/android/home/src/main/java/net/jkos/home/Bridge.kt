package net.jkos.home

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * The native bridge: the page can post a message to `window.jkosShell` and get a reply.
 * The contract (message types and reply shapes) is declared in NATIVE.md § The bridge.
 *
 * ⚠️ ORIGIN-SCOPED BY THE PLATFORM, NEVER addJavascriptInterface. A JavascriptInterface is
 * injected into EVERY frame of EVERY origin the WebView ever shows — an ad iframe, a page a
 * redirect landed on — and cannot tell them apart. addWebMessageListener injects the object
 * only into frames whose origin matches [origin], and reports the sender's origin with each
 * message. check:native fails the build on any addJavascriptInterface in this module.
 *
 * [origin] is the start origin only: the page the launcher opens on (ORDECK). Never jkAuth,
 * never a peer app, even though the launcher shows them.
 */
internal object Bridge {
    const val NAME = "jkosShell"

    /** Returns false (and installs nothing) on a WebView too old to scope by origin. The page
     *  still works; it simply finds no `window.jkosShell`. */
    fun install(web: WebView, origin: String, info: JSONObject): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val expected = requireNotNull(OriginPolicy.normalize(origin)) { "bridge origin '$origin' is not https" }
        WebViewCompat.addWebMessageListener(web, NAME, setOf(expected)) { _, message, sourceOrigin, isMainFrame, reply ->
            // The platform already filtered on the origin rule; check again, and refuse
            // subframes outright — only the top-level page is the home screen.
            if (!isMainFrame || OriginPolicy.normalize(sourceOrigin.toString()) != expected) return@addWebMessageListener
            val type = runCatching { JSONObject(message.data ?: "").optString("type") }.getOrDefault("")
            val answer = when (type) {
                "info" -> JSONObject(info.toString())
                else -> JSONObject().put("type", "error").put("error", "unknown message type")
            }
            reply.postMessage(answer.toString())
        }
        return true
    }
}
