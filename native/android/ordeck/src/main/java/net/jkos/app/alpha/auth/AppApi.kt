package net.jkos.app.alpha.auth

/**
 * One suite app's API, as this app reaches it: `${base}/api/…`. The base is that app's entry
 * in the build's derived list (shell.xml's api_apps / api_bases, from native/shells.js): an
 * app with no entry there cannot be called at all. The token goes only to URLs under
 * `${base}/api/` ([BearerClient]).
 */
class AppApi(val app: String) {
    /** This app's base in this build. Throws for an app the build doesn't reach. */
    val base: String get() = Auth.config.apiBases.getValue(app)
    private val client = BearerClient(app) { "$base/api/" }

    fun url(path: String): String = base + path

    /** True when [url] is under this app's API — the only URLs its Bearer token is sent to. */
    fun authorized(url: String): Boolean = client.authorized(url)

    internal suspend fun call(method: String, path: String, json: String? = null): HttpResult = client.call(method, url(path), json)

    suspend fun get(path: String): String = call("GET", path).text
}
