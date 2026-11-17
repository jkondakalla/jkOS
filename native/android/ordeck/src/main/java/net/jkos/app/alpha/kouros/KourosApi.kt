package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import java.net.URLEncoder

/**
 * KourOS's API, as this app uses it. Every path here is a dataset or capability KourOS
 * declares (apps/kouros/backend/discovery.js), or one of the media routes its own web client
 * uses undeclared (the stream and the cover); check:native holds each literal to that.
 * The transport, the token and the "only under this app's base" rule are [AppApi]'s.
 */
object KourosApi {
    private val api = AppApi("kouros")
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    private suspend fun get(path: String) = api.get(path)

    /** True when [url] is under KourOS's API — what the player's data source asks. */
    fun authorized(url: String): Boolean = api.authorized(url)

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
        api.call("GET", "/api/cover/$trackId").body
    } catch (e: ApiException) {
        if (e.code == 404) null else throw e
    }

    suspend fun recordListen(l: Listen) {
        api.call("POST", "/api/history", Models.listenBody(l))
    }

    fun streamUrl(trackId: Long) = api.url("/api/stream/$trackId/0")
    fun coverUrl(trackId: Long) = api.url("/api/cover/$trackId")
}
