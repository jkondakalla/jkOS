package net.jkos.app.alpha.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.withContext
import java.io.IOException

class ApiException(val service: String, val code: Int) : IOException("$service answered $code")

/**
 * ⚠️ THE ONE PLACE A REQUEST GETS THE TOKEN (besides the player's data source, which asks an
 * [AppApi] the same question first). A client is built for one [root] — a derived base plus a
 * fixed path prefix — and attaches `Authorization: Bearer` only to URLs that start with it,
 * so no redirect and no stray URL can carry the token to another host or another service.
 * check:native holds this file, and that only [AppApi] and [AccountApi] build one.
 *
 * A 401 (or a 3xx — the staging gate's "sign in first", see Http) renews the token once and
 * retries; a second refusal is an error, not a loop.
 */
class BearerClient(private val service: String, private val root: () -> String) {
    /** True when [url] is under this client's root — the only URLs its token is sent to. */
    fun authorized(url: String): Boolean = url.startsWith(root())

    private fun refused(r: HttpResult) = r.code == 401 || r.code in 300..399

    internal suspend fun call(method: String, target: String, json: String? = null): HttpResult = withContext(Dispatchers.IO) {
        check(authorized(target))
        val headers = { token: String -> mapOf("Authorization" to "Bearer $token", "Accept" to "application/json") }
        var token = Auth.accessToken()
        var r = Http.request(method, target, headers(token), json)
        if (refused(r)) {
            token = Auth.renewAfterRejection(token)
            r = Http.request(method, target, headers(token), json)
        }
        if (!r.ok) throw ApiException(service, r.code)
        r
    }

    /**
     * Read [target] as an event stream: each line to [onLine]. Returns the status the stream
     * opened with (a refusal is returned, not thrown: the caller decides between re-registering,
     * giving up and retrying). A 401 renews the token once, like [call]. Blocking on
     * Dispatchers.IO until the stream ends; cancelling the caller ends it.
     */
    internal suspend fun stream(target: String, onLine: (String) -> Unit): Int = withContext(Dispatchers.IO) {
        check(authorized(target))
        val headers = { token: String -> mapOf("Authorization" to "Bearer $token", "Accept" to "text/event-stream") }
        val conn = AtomicReference<HttpURLConnection?>(null)
        // Cancelling the caller closes the connection, which ends a read blocked inside it.
        val closer = launch { try { awaitCancellation() } finally { conn.get()?.disconnect() } }
        try {
            var token = Auth.accessToken()
            var status = 0
            val open = { code: Int -> status = code; code in 200..299 }
            Http.stream(target, headers(token), STREAM_READ_TIMEOUT_MS, conn::set, open, onLine)
            if (status == 401 || status in 300..399) {
                token = Auth.renewAfterRejection(token)
                Http.stream(target, headers(token), STREAM_READ_TIMEOUT_MS, conn::set, open, onLine)
            }
            status
        } finally {
            closer.cancel()
        }
    }

    companion object {
        /** Three of the session stream's 20 s pings missed: the connection is dead. */
        const val STREAM_READ_TIMEOUT_MS = 60_000
    }
}
