package net.jkos.app.alpha.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

class ApiException(val app: String, val code: Int) : IOException("$app answered $code")

/**
 * One suite app's API, as this app reaches it: `${base}/api/…`, every call with
 * `Authorization: Bearer`. The base is that app's entry in the build's derived list
 * (shell.xml's api_apps / api_bases, from native/shells.js): an app with no entry there
 * cannot be called at all.
 *
 * A 401 (or a 3xx — the staging gate's "sign in first", see Http) renews the token once and
 * retries; a second refusal is an error, not a loop.
 *
 * ⚠️ THE ONE PLACE A REQUEST GETS THE TOKEN, besides the player's data source, which asks
 * [authorized] too. The token is attached only to URLs under this app's base, so no redirect
 * and no stray URL can carry it to another host. check:native holds both.
 */
class AppApi(val app: String) {
    /** This app's base in this build. Throws for an app the build doesn't reach. */
    val base: String get() = Auth.config.apiBases.getValue(app)

    fun url(path: String): String = base + path

    /** True when [url] is under this app's API — the only URLs its Bearer token is sent to. */
    fun authorized(url: String): Boolean = url.startsWith("$base/api/")

    private fun refused(r: HttpResult) = r.code == 401 || r.code in 300..399

    internal suspend fun call(method: String, path: String, json: String? = null): HttpResult = withContext(Dispatchers.IO) {
        val target = url(path)
        check(authorized(target))
        val headers = { token: String -> mapOf("Authorization" to "Bearer $token", "Accept" to "application/json") }
        var token = Auth.accessToken()
        var r = Http.request(method, target, headers(token), json)
        if (refused(r)) {
            token = Auth.renewAfterRejection(token)
            r = Http.request(method, target, headers(token), json)
        }
        if (!r.ok) throw ApiException(app, r.code)
        r
    }

    suspend fun get(path: String): String = call("GET", path).text
}
