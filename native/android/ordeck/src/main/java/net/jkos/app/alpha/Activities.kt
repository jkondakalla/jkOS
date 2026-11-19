package net.jkos.app.alpha

import net.jkos.app.alpha.auth.Auth
import net.jkos.app.alpha.kouros.PlaybackService

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Process start: read this build's config and any stored session. */
class JkosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Auth.init(this)
    }

    companion object {
        /** Work that must outlive a screen or the service (posting a listen, finishing sign-in). */
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /**
         * A screen something outside the UI asked for, once: the playback notification's tap
         * asks for Now Playing ([OPEN_NOW_PLAYING]). The shell opens it and clears this.
         */
        val open = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

        /** The extra the playback notification's intent carries. Naming a screen is all it can do. */
        const val EXTRA_OPEN = "net.jkos.app.alpha.open"
        const val OPEN_NOW_PLAYING = "now-playing"
    }
}

class MainActivity : ComponentActivity() {
    /** Only the one screen name is read from an intent; anything else is ignored. */
    private fun take(intent: Intent?) {
        if (intent?.getStringExtra(JkosApp.EXTRA_OPEN) == JkosApp.OPEN_NOW_PLAYING) JkosApp.open.value = JkosApp.OPEN_NOW_PLAYING
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        take(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) take(intent)
        enableEdgeToEdge()
        setContent {
            val look by Auth.look.collectAsState()
            // The system bars' icons follow the face the person chose, not the device's own
            // day/night: paper under a dark-mode phone needs dark icons.
            val dark = look.mode.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            JkosTheme(look) {
                JkosRoot()
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
        intent?.dataString?.let { raw -> JkosApp.scope.launch { Auth.completeSignIn(raw) } }
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
