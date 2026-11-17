package net.jkos.app.alpha.auth

import kotlinx.coroutines.Dispatchers
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
}
