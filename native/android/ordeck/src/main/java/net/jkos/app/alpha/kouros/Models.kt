package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import org.json.JSONArray
import org.json.JSONObject

// KourOS's API shapes, as this app reads them. The server half is
// apps/kouros/backend/src/routes/{browse,discover,tracks}.js and the playlists collection. org.json is part of Android; the JVM
// unit test uses the org.json artifact, so the parsing below is held there too.

data class Album(
    val album: String,
    val artist: String,
    val year: Int?,
    val tracks: Int,
    val duration: Long,
    val anchorId: Long,
    val coverId: Long?,
)

data class Artist(val artist: String, val tracks: Int, val albums: Int, val duration: Long, val coverId: Long?)

data class Track(
    val id: Long,
    val title: String,
    val artist: String?,
    val album: String?,
    val albumArtist: String?,
    val trackNo: Int?,
    val discNo: Int?,
    val year: Int?,
    val durationSec: Double,
    val hasCover: Boolean,
)

data class LibraryStats(val tracks: Int, val albums: Int, val artists: Int, val duration: Long)

/** A `playlists` row (discovery.js PLAYLISTS): the person's own, in their order. */
data class Playlist(val id: Long, val name: String, val description: String?, val trackRefs: List<Long>)

object Models {
    /** A string field, with JSON null and absence both null. (optString turns null into "null".) */
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)
    private fun JSONObject.int(k: String): Int? = if (isNull(k)) null else optInt(k)
    private fun JSONObject.long(k: String): Long? = if (isNull(k)) null else optLong(k)

    private inline fun <T> list(json: String, item: (JSONObject) -> T): List<T> {
        val a = JSONArray(json)
        return List(a.length()) { item(a.getJSONObject(it)) }
    }

    fun albums(json: String): List<Album> = list(json) { o ->
        Album(
            album = o.str("album") ?: "",
            artist = o.str("artist") ?: "",
            year = o.int("year"),
            tracks = o.optInt("tracks"),
            duration = o.optLong("duration"),
            anchorId = o.optLong("anchor_id"),
            coverId = o.long("cover_id"),
        )
    }

    fun artists(json: String): List<Artist> = list(json) { o ->
        Artist(
            artist = o.str("artist") ?: "",
            tracks = o.optInt("tracks"),
            albums = o.optInt("albums"),
            duration = o.optLong("duration"),
            coverId = o.long("cover_id"),
        )
    }

    private fun track(o: JSONObject) = Track(
        id = o.getLong("id"),
        title = o.str("title") ?: "",
        artist = o.str("artist"),
        album = o.str("album"),
        albumArtist = o.str("albumartist"),
        trackNo = o.int("track_no"),
        discNo = o.int("disc_no"),
        year = o.int("year"),
        durationSec = o.optDouble("duration", 0.0).let { if (it.isNaN()) 0.0 else it },
        // An album's tracks carry cover_path; a radio result carries has_cover.
        hasCover = if (o.has("has_cover")) o.optBoolean("has_cover") else o.str("cover_path") != null,
    )

    fun albumTracks(json: String): List<Track> = list(json, ::track)

    /** GET /api/tracks: the `tracks` dataset's bare array. */
    fun tracks(json: String): List<Track> = list(json, ::track)

    /**
     * The rows for [ids], in [ids]' order (the dataset answers in catalog order). An id the
     * catalog no longer has is skipped, the way the web's playlist view skips a vanished ref.
     */
    fun inOrder(ids: List<Long>, rows: List<Track>): List<Track> {
        val byId = rows.associateBy { it.id }
        return ids.mapNotNull { byId[it] }
    }

    private fun playlist(o: JSONObject): Playlist {
        // track_refs is a list:true column: a JSON array, written by the web as numbers. A
        // numeric string reads as its number; anything else isn't a track and is dropped.
        val refs = o.optJSONArray("track_refs")
        val ids = if (refs == null) emptyList() else (0 until refs.length()).mapNotNull { i ->
            when (val v = refs.opt(i)) {
                is Number -> v.toLong().takeIf { it >= 0 && v.toDouble() == it.toDouble() }
                is String -> v.toLongOrNull()?.takeIf { it >= 0 }
                else -> null
            }
        }
        return Playlist(o.getLong("id"), o.str("name") ?: "", o.str("description"), ids)
    }

    fun playlists(json: String): List<Playlist> = list(json, ::playlist)

    fun playlist(json: String): Playlist = playlist(JSONObject(json))

    /** A POST or PATCH /api/playlists body: only the fields given. track_refs as numbers. */
    fun playlistBody(name: String? = null, trackRefs: List<Long>? = null): String = JSONObject().apply {
        if (name != null) put("name", name)
        if (trackRefs != null) put("track_refs", JSONArray(trackRefs))
    }.toString()

    /** GET /api/discover/radio → its `results`. */
    fun radio(json: String): List<Track> {
        val a = JSONObject(json).optJSONArray("results") ?: return emptyList()
        return List(a.length()) { track(a.getJSONObject(it)) }
    }

    fun stats(json: String): LibraryStats {
        val o = JSONObject(json)
        return LibraryStats(o.optInt("tracks"), o.optInt("albums"), o.optInt("artists"), o.optLong("duration"))
    }

    /** The POST /api/history body. `context` is omitted, not null, when there is none. */
    fun listenBody(l: Listen): String = JSONObject().apply {
        put("item_ref", l.itemRef)
        put("started_at", l.startedAt)
        put("ms_played", l.msPlayed)
        put("completed", l.completed)
        if (l.context != null) put("context", l.context)
    }.toString()
}

// ── the KourOS Home (discovery.js discoverHome: GET /api/discover/home?hour=) ──

/** A run: a sequenced set built from recent listening (ALGORITHMS.md). */
data class HomeRun(val id: String, val title: String, val blurb: String, val arc: String, val meta: String, val seedId: Long?, val seedTitle: String?, val tracks: List<Track>)

/** An artist the listener keeps returning to. [anchorId] is a track of theirs, for the art. */
data class HomeArtist(val artist: String, val meta: String, val anchorId: Long?, val hasCover: Boolean)

/** Something played lately, by where it was played from. [route] is its play context, which is also its page. */
data class HomeRecent(val kind: String, val title: String, val subtitle: String?, val coverId: Long?, val coverIsBook: Boolean, val route: String)

data class HomeBook(val id: Long, val title: String, val author: String?, val hasCover: Boolean, val durationSec: Double, val positionSec: Double, val remainingLabel: String)

data class HomeAlbum(val album: String, val artist: String, val year: Int?, val meta: String, val anchorId: Long?, val hasCover: Boolean)

/** The home rails in one answer, as the web's Home widget binds them. */
data class DiscoverHome(
    val tracks: Int,
    val libraryLabel: String,
    val coverageLabel: String?,
    /** "morning" | "working" | "evening" | "late", or null. */
    val slot: String?,
    /** "features" (matched by sound) or "genre". */
    val basis: String?,
    val timeOfDay: List<Track>,
    val runs: List<HomeRun>,
    val deepIn: List<HomeArtist>,
    val recent: List<HomeRecent>,
    val continueBooks: List<HomeBook>,
    val freshAlbums: List<HomeAlbum>,
) {
    /** The page's greeting (kouros-home.json's map of the slot). */
    val greeting: String get() = when (slot) { "morning" -> "Good morning"; "working" -> "Good afternoon"; "evening" -> "Good evening"; "late" -> "Still up"; else -> "Home" }
    /** The time-of-day rail's head. */
    val picksTitle: String get() = when (slot) { "morning" -> "Morning picks"; "working" -> "Working picks"; "evening" -> "Evening picks"; "late" -> "Late picks"; else -> "Picks" }
    val picksBasis: String? get() = when (basis) { "features" -> "MATCHED BY SOUND"; "genre" -> "MATCHED BY GENRE"; else -> null }
}

object HomeModels {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)
    private fun JSONObject.long(k: String): Long? = if (isNull(k) || !has(k)) null else optLong(k)
    private fun JSONObject.dbl(k: String): Double = optDouble(k, 0.0).let { if (it.isNaN()) 0.0 else it }
    private fun JSONObject.arr(k: String): JSONArray = optJSONArray(k) ?: JSONArray()
    private inline fun <T> JSONArray.rows(item: (JSONObject) -> T?): List<T> = (0 until length()).mapNotNull { i -> optJSONObject(i)?.let(item) }

    private fun hits(a: JSONArray): List<Track> = a.rows { o -> if (o.has("id")) Models.tracks(JSONArray().put(o).toString()).first() else null }

    fun home(json: String): DiscoverHome {
        val o = JSONObject(json)
        val tod = o.optJSONObject("time_of_day")
        return DiscoverHome(
            tracks = o.optJSONObject("stats")?.optInt("tracks") ?: 0,
            libraryLabel = o.str("library_label") ?: "",
            coverageLabel = o.str("coverage_label"),
            slot = tod?.str("slot"),
            basis = tod?.str("basis"),
            timeOfDay = tod?.let { hits(it.arr("results")) } ?: emptyList(),
            runs = o.arr("runs").rows { r ->
                val seed = r.optJSONObject("seed")
                HomeRun(r.str("id") ?: "", r.str("title") ?: "", r.str("blurb") ?: "", r.str("arc") ?: "none", r.str("meta") ?: "",
                    seed?.let { BookModels.ref(it.opt("id")) }, seed?.str("title"), hits(r.arr("tracks")))
            }.filter { it.tracks.isNotEmpty() },
            deepIn = o.arr("deep_in").rows { a ->
                a.str("artist")?.let { HomeArtist(it, a.str("meta") ?: "", BookModels.ref(a.opt("anchor_id")), a.str("cover_url") != null) }
            },
            recent = o.arr("recent").rows { r ->
                val route = r.str("route") ?: return@rows null
                val cover = r.optJSONObject("cover")
                HomeRecent(r.str("kind") ?: "", r.str("title") ?: "", r.str("subtitle"), cover?.let { BookModels.ref(it.opt("id")) }, cover?.str("kind") == "book", route)
            },
            continueBooks = o.arr("continue_books").rows { b ->
                if (!b.has("id")) null else HomeBook(b.getLong("id"), b.str("title") ?: "", b.str("author"), b.optBoolean("has_cover"), b.dbl("duration"), b.dbl("position"), b.str("remaining_label") ?: "")
            },
            freshAlbums = o.arr("fresh_albums").rows { a ->
                val album = a.str("album") ?: return@rows null
                HomeAlbum(album, a.str("artist") ?: "", if (a.isNull("year") || !a.has("year")) null else a.optInt("year"), a.str("meta") ?: "", BookModels.ref(a.opt("anchor_id")), a.str("cover_url") != null)
            },
        )
    }
}

/** GET /api/discover/similar/:id → its tracks, best first, and whether they were matched by sound. */
data class Similar(val bySound: Boolean, val tracks: List<Track>)
