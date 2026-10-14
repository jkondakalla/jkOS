package net.jkos.kouros

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.URLEncoder

class ApiException(val code: Int) : IOException("KourOS answered $code")

/**
 * KourOS's API, as this app uses it: `${apiBase}/api/…`, every call with
 * `Authorization: Bearer`. A 401 (or a 3xx — the staging gate's "sign in first", see Http)
 * renews the token once and retries; a second refusal is an error, not a loop.
 *
 * The token is attached ONLY to URLs under apiBase ([authorized]), here and in the player's
 * data source, so no redirect or stray URL can carry it to another host.
 */
object Api {
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    private fun url(path: String) = Auth.config.apiBase + path

    /** True when [url] is one of ours — the only URLs a Bearer token is ever sent to. */
    fun authorized(url: String): Boolean = url.startsWith(Auth.config.apiBase + "/api/")

    private fun refused(r: HttpResult) = r.code == 401 || r.code in 300..399

    private suspend fun call(method: String, path: String, json: String? = null): HttpResult = withContext(Dispatchers.IO) {
        val target = url(path)
        check(authorized(target))
        val headers = { token: String -> mapOf("Authorization" to "Bearer $token", "Accept" to "application/json") }
        var token = Auth.accessToken()
        var r = Http.request(method, target, headers(token), json)
        if (refused(r)) {
            token = Auth.renewAfterRejection(token)
            r = Http.request(method, target, headers(token), json)
        }
        if (!r.ok) throw ApiException(r.code)
        r
    }

    private suspend fun get(path: String) = call("GET", path).text

    suspend fun albums(q: String = "", artist: String? = null, sort: String = "added", limit: Int = 120, offset: Int = 0): List<Album> {
        val qs = buildString {
            append("?sort=").append(enc(sort)).append("&limit=").append(limit).append("&offset=").append(offset)
            if (q.isNotBlank()) append("&q=").append(enc(q.trim()))
            if (artist != null) append("&artist=").append(enc(artist))
        }
        return Models.albums(get("/api/albums$qs"))
    }

    suspend fun albumTracks(album: String, artist: String): List<Track> =
        Models.albumTracks(get("/api/albums/tracks?album=${enc(album)}&artist=${enc(artist)}"))

    suspend fun artists(q: String = "", limit: Int = 300, offset: Int = 0): List<Artist> {
        val qs = "?limit=$limit&offset=$offset" + if (q.isNotBlank()) "&q=${enc(q.trim())}" else ""
        return Models.artists(get("/api/artists$qs"))
    }

    suspend fun stats(): LibraryStats = Models.stats(get("/api/library/stats"))

    suspend fun radio(seedTrackId: Long, k: Int = 60): List<Track> =
        Models.radio(get("/api/discover/radio?seed=$seedTrackId&k=$k"))

    suspend fun coverBytes(trackId: Long): ByteArray? = try {
        call("GET", "/api/cover/$trackId").body
    } catch (e: ApiException) {
        if (e.code == 404) null else throw e
    }

    suspend fun recordListen(l: Listen) {
        call("POST", "/api/history", Models.listenBody(l))
    }

    fun streamUrl(trackId: Long) = url("/api/stream/$trackId/0")
    fun coverUrl(trackId: Long) = url("/api/cover/$trackId")
}
