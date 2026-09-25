package net.jkos.home

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

/**
 * jkOS Home: ORDECK as the device's home screen.
 *
 * Three rules shape everything here:
 *  1. **The home screen can never strand the device.** If jkos.net is unreachable (NAS
 *     rebooting, Wi-Fi down, a 502 from the edge) the native offline view takes over and
 *     retries on its own; the drawer (and through it Settings) is reachable in every state.
 *  2. **Only jkOS origins are shown.** OriginPolicy decides every top-level navigation;
 *     anything else is refused, not handed to a browser — a kiosk does not give a guest one.
 *  3. **Nothing is granted by default.** No camera/mic/location for the page, no file
 *     access, no mixed content, no certificate error waved through.
 */
class HomeActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var policy: OriginPolicy
    private lateinit var startUrl: String
    private lateinit var hold: CornerHold
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { load() }
    private var failed = false

    private val debuggable get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        startUrl = getString(R.string.start_url)
        policy = OriginPolicy(resources.getStringArray(R.array.shell_origins).toList())
        web = findViewById(R.id.web)
        offline = findViewById(R.id.offline)
        findViewById<View>(R.id.retry).setOnClickListener { load() }
        hold = CornerHold(root) { openDrawer() }

        configure()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // A home screen has nothing behind it: back walks the page's history and stops.
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() }
        })
        load()
    }

    @SuppressLint("SetJavaScriptEnabled") // ORDECK is a React app; the policy, not JS, is the boundary
    private fun configure() {
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true            // ORDECK keeps its HUD layout in localStorage
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)    // target=_blank navigates this view, through the policy
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        WebView.setWebContentsDebuggingEnabled(debuggable) // staging builds only
        Bridge.install(web, getString(R.string.bridge_origin), JSONObject()
            .put("type", "info")
            .put("shell", "home")
            .put("package", packageName)
            .put("version", packageManager.getPackageInfo(packageName, 0).versionName))
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
    }

    private fun load() {
        handler.removeCallbacks(retry)
        failed = false
        web.loadUrl(startUrl)
    }

    private fun fail() {
        failed = true
        web.visibility = View.INVISIBLE
        offline.visibility = View.VISIBLE
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, RETRY_MS)
    }

    private fun refuse(url: String) {
        if (debuggable) Toast.makeText(this, getString(R.string.refused_debug, url), Toast.LENGTH_SHORT).show()
        else Toast.makeText(this, R.string.refused, Toast.LENGTH_SHORT).show()
    }

    private fun openDrawer() {
        // The page saw the finger go down; tell it the gesture is over, then leave.
        val now = SystemClock.uptimeMillis()
        MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0).also {
            super.dispatchTouchEvent(it)
            it.recycle()
        }
        startActivity(Intent(this, DrawerActivity::class.java))
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        hold.watch(ev)
        return if (hold.fired) true else super.dispatchTouchEvent(ev)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Home pressed while already home: if the portal is down, try again now.
        if (failed) load()
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }

    override fun onDestroy() {
        handler.removeCallbacks(retry)
        web.destroy()
        super.onDestroy()
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false // a subframe cannot leave the page, and gets no bridge
            if (policy.allows(request.url.toString())) return false
            refuse(request.url.toString())
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            // shouldOverrideUrlLoading is never asked about a POST (a form submit): this is
            // where a main-frame navigation that slipped past it gets caught.
            if (!policy.allows(url)) {
                view.stopLoading()
                refuse(url)
                load()
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (failed) return
            offline.visibility = View.GONE
            web.visibility = View.VISIBLE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) fail()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            // The edge answers 502/504 while the NAS or a container restarts.
            if (request.isForMainFrame && response.statusCode >= 500) fail()
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel() // never proceed(): a certificate error is not ours to wave through
            fail()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer crashed or was reclaimed for memory. A launcher must outlive it:
            // this WebView is dead, so rebuild the activity around a new one.
            recreate()
            return true
        }
    }

    private class Chrome : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
            callback.invoke(origin, false, false)
    }

    companion object {
        const val RETRY_MS = 30_000L
    }
}
