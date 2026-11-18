package net.jkos.app.alpha.ordeck

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.jkos.app.alpha.auth.Auth
import net.jkos.app.alpha.auth.BearerClient
import net.jkos.app.alpha.auth.Http
import net.jkos.app.alpha.auth.HttpResult
import net.jkos.app.alpha.auth.Probe

/**
 * The systems card's probes: each app's health, read at the URL the web's systems card reads
 * (`/health/<id>` on the portal's origin, through the edge). Every URL is one this build
 * derives (native/shells.js → shell.xml's health_urls); a probe that isn't one is refused.
 *
 * ⚠️ THE TOKEN GOES WITH A PROBE ONLY ON STAGING. There the edge gates every path behind
 * `auth_request`, which reads the Bearer, so a probe without it would read the gate's
 * "sign in first" as the app being down. In production the /health/<peer> routes are open and
 * nothing reads a token, so none is sent. `healthBearer` is derived, and check:native holds it
 * to both edge confs, probe by probe.
 */
object HealthApi {
    /** The web's probe timeout: a probe that hasn't answered in 5 s is down. */
    const val TIMEOUT_MS = 5_000

    /** This build's probes, less the AI ones while the LazurOS kill switch is off (probeApps). */
    fun probes(aiEnabled: Boolean): List<Probe> = Auth.config.health.filter { !it.ai || aiEnabled }

    suspend fun probe(probe: Probe): SysRow = withContext(Dispatchers.IO) {
        check(probe in Auth.config.health)
        val t0 = System.nanoTime()
        val r: HttpResult? = try {
            if (Auth.config.healthBearer) BearerClient("health") { probe.url }.call("GET", probe.url, timeoutMs = TIMEOUT_MS)
            else Http.request("GET", probe.url, mapOf("Accept" to "application/json"), timeoutMs = TIMEOUT_MS)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null   // refused, unreachable or timed out: down, as the web's probe reads a throw
        }
        Systems.row(probe.app, r?.ok == true, (System.nanoTime() - t0) / 1_000_000, r?.text)
    }
}
