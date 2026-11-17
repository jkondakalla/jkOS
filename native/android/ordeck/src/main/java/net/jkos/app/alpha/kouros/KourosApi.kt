package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
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
        if (l.book) api.call("POST", "/api/book_history", BookModels.bookListenBody(l))
        else api.call("POST", "/api/history", Models.listenBody(l))
    }

    // ── audiobooks ──

    /** The book catalog; [title] and [author] are the dataset's prefix filters. */
    suspend fun books(title: String = "", author: String = ""): List<Book> {
        val qs = listOfNotNull(
            title.trim().takeIf { it.isNotEmpty() }?.let { "title=${enc(it)}" },
            author.trim().takeIf { it.isNotEmpty() }?.let { "author=${enc(it)}" },
        ).joinToString("&")
        return BookModels.books(get("/api/books" + if (qs.isEmpty()) "" else "?$qs"))
    }

    suspend fun book(id: Long): BookDetail = BookModels.detail(get("/api/book/$id"))

    /** This listener's positions, every book; [unfinished] asks only for those still under way. */
    suspend fun progress(unfinished: Boolean = false): List<Progress> =
        BookModels.progress(get("/api/progress" + if (unfinished) "?finished=false" else ""))

    private val progressLock = Mutex()
    private val progressRows = HashMap<Long, Long>()

    /**
     * Save [bookId]'s position. ⚠️ The row is PATCHed by its id, as the web does, and POSTed only
     * when there is none: a POST onto an existing row is the server's upsert, which deletes it
     * and inserts a new id, and a web tab holding the old id would then PATCH a row that's gone.
     * One at a time, so two saves of a new book can't both create it.
     */
    suspend fun saveProgress(bookId: Long, body: String) = progressLock.withLock {
        val known = progressRows[bookId] ?: progress().firstOrNull { it.bookId == bookId }?.id
        if (known != null) {
            try {
                api.call("PATCH", "/api/progress/$known", body)
                progressRows[bookId] = known
                return@withLock
            } catch (e: ApiException) {
                if (e.code != 404) throw e
                progressRows.remove(bookId)   // removed elsewhere: make it again
            }
        }
        progressRows[bookId] = JSONObject(api.call("POST", "/api/progress", body).text).getLong("id")
    }

    /** This listener's bookmarks in [bookId] (the collection has no book filter: the rest are dropped here). */
    suspend fun bookmarks(bookId: Long): List<Bookmark> =
        BookModels.bookmarks(get("/api/bookmarks")).filter { it.bookId == bookId }.sortedBy { it.positionSec }

    suspend fun addBookmark(bookId: Long, positionMs: Long, title: String?) {
        api.call("POST", "/api/bookmarks", BookModels.bookmarkBody(bookId, positionMs, title))
    }

    suspend fun deleteBookmark(id: Long) {
        api.call("DELETE", "/api/bookmarks/$id")
    }

    suspend fun bookCoverBytes(bookId: Long): ByteArray? = try {
        api.call("GET", "/api/books/cover/$bookId").body
    } catch (e: ApiException) {
        if (e.code == 404) null else throw e
    }

    fun bookStreamUrl(bookId: Long, fileIndex: Int) = api.url("/api/books/stream/$bookId/$fileIndex")
    fun bookCoverUrl(bookId: Long) = api.url("/api/books/cover/$bookId")

    fun streamUrl(trackId: Long) = api.url("/api/stream/$trackId/0")
    fun coverUrl(trackId: Long) = api.url("/api/cover/$trackId")
}
