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
    /** The most ids the tracks dataset reads in one request (packages/weave filters.js IN_MAX). */
    const val IDS_MAX = 200

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

    /** Tracks whose title starts with [title] (the dataset's prefix filter), as the web's Search asks. */
    suspend fun searchTracks(title: String): List<Track> =
        Models.tracks(get("/api/tracks?title=${enc(title.trim())}"))

    /**
     * The rows for [ids], in that order: a playlist's track_refs, or the session's queue. The
     * dataset reads at most [IDS_MAX] ids a request (Weave's IN_MAX), so a long list is asked
     * for in pieces.
     */
    suspend fun tracksByIds(ids: List<Long>): List<Track> {
        val rows = ids.distinct().chunked(IDS_MAX).flatMap { part ->
            Models.tracks(get("/api/tracks?ids=${part.joinToString(",")}"))
        }
        return Models.inOrder(ids, rows)
    }

    suspend fun playlists(): List<Playlist> = Models.playlists(get("/api/playlists"))

    suspend fun createPlaylist(name: String, trackRefs: List<Long> = emptyList()): Playlist =
        Models.playlist(api.call("POST", "/api/playlists", Models.playlistBody(name, trackRefs)).text)

    /** Rename, or reorder by sending the whole list back: the collection has no other primitive. */
    suspend fun updatePlaylist(id: Long, name: String? = null, trackRefs: List<Long>? = null): Playlist =
        Models.playlist(api.call("PATCH", "/api/playlists/$id", Models.playlistBody(name, trackRefs)).text)

    suspend fun deletePlaylist(id: Long) {
        api.call("DELETE", "/api/playlists/$id")
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
