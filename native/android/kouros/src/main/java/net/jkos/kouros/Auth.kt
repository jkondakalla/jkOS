package net.jkos.kouros

import android.app.Activity
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException

/** The facts this build was generated with (src/<debug|release>/res/values/shell.xml). */
class ShellConfig(
    val apiBase: String,
    val authOrigin: String,
    val clientId: String,
    val redirectUri: String,
    val environment: String,
    val channel: String,
    val versionName: String,
) {
    companion object {
        fun load(context: Context): ShellConfig {
            @Suppress("DEPRECATION")
            val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
            return ShellConfig(
                apiBase = context.getString(R.string.api_base),
                authOrigin = context.getString(R.string.auth_origin),
                clientId = context.getString(R.string.client_id),
                redirectUri = context.getString(R.string.redirect_uri),
                environment = context.getString(R.string.environment),
                channel = context.getString(R.string.channel),
                versionName = version,
            )
        }
    }
}

sealed interface AuthState {
    data object SignedOut : AuthState
    data class SignedIn(val user: User) : AuthState
}

/** Thrown when the session is gone — the UI is already on its way to the sign-in screen. */
class SignedOutException : IOException("signed out")

/**
 * The app's one session (jkAuth native sign-in — apps/jkauth/src/routes/native.js).
 *
 *  · Sign-in: PKCE + state, persisted (sealed) before the Custom Tab opens, so the redirect can
 *    be completed by a process that was not the one that started it.
 *  · The refresh token lives only in [SessionStore] (Keystore-sealed, no-backup). The access
 *    token lives only in memory and is renewed 60 s before it expires.
 *  · ⚠️ REFRESH IS SERIALISED by [mutex]. jkAuth rotates refresh tokens, and a phone has no
 *    shared cookie jar: two concurrent refreshes would spend the token twice, the loser's copy
 *    would be reuse a few seconds later, and the server would burn the session — a signed-out
 *    phone for no reason. Every renewal runs under the lock, and the new refresh token is
 *    written to disk BEFORE the new access token is used.
 *  · `invalid_grant` (expired, revoked, reused) is signed out. 409 REFRESH_RACE should never
 *    happen with the lock held; it is reported as a transient error, never retried in a loop.
 */
object Auth {
    lateinit var config: ShellConfig
        private set
    private lateinit var store: SessionStore

    private val _state = MutableStateFlow<AuthState>(AuthState.SignedOut)
    val state: StateFlow<AuthState> = _state

    /** A one-line message for the sign-in screen, or null. */
    val message = MutableStateFlow<String?>(null)

    private val mutex = Mutex()
    private var access: String? = null
    private var accessExpiresAtMs = 0L

    /** A pending sign-in older than this is abandoned (jkAuth's consent page is 10 minutes). */
    private const val PENDING_MAX_MS = 15 * 60 * 1000L
    private const val RENEW_BEFORE_MS = 60_000L

    fun init(context: Context) {
        config = ShellConfig.load(context)
        store = SessionStore(context)
        _state.value = store.readSession()?.let { AuthState.SignedIn(it.user) } ?: AuthState.SignedOut
    }

    /** Open jkAuth's authorize page in a Custom Tab (the system browser's engine, not ours). */
    fun beginSignIn(activity: Activity) {
        val pkce = Pkce.create()
        store.writePending(pkce, System.currentTimeMillis())
        message.value = null
        val url = authorizeUrl(config.authOrigin, config.clientId, config.redirectUri, pkce)
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, Uri.parse(url))
    }

    /** RedirectActivity hands the whole redirect URI here. */
    suspend fun completeSignIn(raw: String): Unit = withContext(Dispatchers.IO) {
        mutex.withLock {
            val q = parseRedirect(raw, config.redirectUri) ?: return@withLock
            val pending = store.readPending()
            store.clearPending() // one attempt, one redirect: whatever happens next, it is spent
            val state = q["state"]
            if (pending == null || state == null || !constantTimeEquals(state, pending.state)
                || System.currentTimeMillis() - pending.createdAtMs > PENDING_MAX_MS
            ) {
                message.value = "That sign-in didn't come from this app. Try again."
                return@withLock
            }
            val error = q["error"]
            if (error != null) {
                message.value = if (error == "access_denied") "Sign-in cancelled." else "Sign-in failed ($error)."
                return@withLock
            }
            val code = q["code"] ?: run {
                message.value = "Sign-in returned no code."
                return@withLock
            }
            val body = JSONObject()
                .put("grant_type", "authorization_code")
                .put("code", code)
                .put("code_verifier", pending.verifier)
                .put("client_id", config.clientId)
                .put("redirect_uri", config.redirectUri)
            val res = try {
                Http.request("POST", "${config.authOrigin}/auth/native/token", json = body.toString())
            } catch (e: IOException) {
                message.value = "Couldn't reach jkOS: ${e.message}"
                return@withLock
            }
            if (!res.ok) {
                message.value = "jkOS refused the sign-in (${res.code})."
                return@withLock
            }
            adopt(Models.tokenGrant(res.text))
            message.value = null
        }
    }

    /** A valid access token, renewing it first if it is (nearly) expired. */
    suspend fun accessToken(): String = withContext(Dispatchers.IO) {
        mutex.withLock {
            val a = access
            if (a != null && System.currentTimeMillis() < accessExpiresAtMs - RENEW_BEFORE_MS) a else refreshLocked()
        }
    }

    /** The API answered 401 to [rejected]: renew once — unless another caller already did. */
    suspend fun renewAfterRejection(rejected: String): String = withContext(Dispatchers.IO) {
        mutex.withLock {
            val a = access
            if (a != null && a != rejected && System.currentTimeMillis() < accessExpiresAtMs - RENEW_BEFORE_MS) a else refreshLocked()
        }
    }

    /** Sign out here AND on the server (revoke), then forget everything. */
    suspend fun signOut(): Unit = withContext(Dispatchers.IO) {
        mutex.withLock {
            store.readSession()?.let { s ->
                try {
                    Http.request(
                        "POST", "${config.authOrigin}/auth/native/revoke",
                        json = JSONObject().put("client_id", config.clientId).put("token", s.refreshToken).toString(),
                    )
                } catch (_: IOException) {
                    // Offline: the server-side session then ends at its own idle timeout.
                }
            }
            forgetLocked()
        }
    }

    // ── under the lock ──────────────────────────────────────────────────────────

    private fun refreshLocked(): String {
        val session = store.readSession() ?: run {
            forgetLocked()
            throw SignedOutException()
        }
        val body = JSONObject()
            .put("grant_type", "refresh_token")
            .put("refresh_token", session.refreshToken)
            .put("client_id", config.clientId)
        val res = Http.request("POST", "${config.authOrigin}/auth/native/token", json = body.toString())
        when {
            res.ok -> return adopt(Models.tokenGrant(res.text))
            res.code == 400 || res.code == 401 -> {
                // invalid_grant (expired, revoked, reused) or invalid_client: this session is over.
                forgetLocked()
                message.value = "You were signed out. Sign in again."
                throw SignedOutException()
            }
            else -> throw IOException("token refresh failed (${res.code})")
        }
    }

    private fun adopt(grant: TokenGrant): String {
        store.writeSession(grant.refreshToken, grant.user) // FIRST: the old token is already spent
        access = grant.accessToken
        accessExpiresAtMs = System.currentTimeMillis() + grant.expiresInSec * 1000
        _state.value = AuthState.SignedIn(grant.user)
        return grant.accessToken
    }

    private fun forgetLocked() {
        access = null
        accessExpiresAtMs = 0
        store.clearSession()
        store.clearPending()
        _state.value = AuthState.SignedOut
    }
}
