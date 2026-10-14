package net.jkos.kouros

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Process start: read this build's config and any stored session. */
class KourosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Auth.init(this)
    }

    companion object {
        /** Work that must outlive a screen or the service (posting a listen, finishing sign-in). */
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KourosTheme {
                KourosRoot()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        PlaybackService.checkpoint()
    }
}

/**
 * The sign-in redirect lands here (AndroidManifest.xml). It hands the URI to Auth — which
 * checks the path, the state and the pending attempt before anything is exchanged — and gets
 * out of the way: MainActivity comes back to the front, closing the Custom Tab above it.
 */
class RedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.dataString?.let { raw -> KourosApp.scope.launch { Auth.completeSignIn(raw) } }
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
