package net.jkos.kouros

import org.json.JSONArray
import org.json.JSONObject

// KourOS's API shapes, as this app reads them. The server half is
// apps/kouros/backend/src/routes/{browse,discover}.js. org.json is part of Android; the JVM
// unit test uses the org.json artifact, so the parsing below is held there too.

data class User(val id: Long, val email: String, val name: String?, val role: String)

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

/** POST /auth/native/token's answer, either grant. */
data class TokenGrant(val accessToken: String, val expiresInSec: Long, val refreshToken: String, val user: User)

object Models {
    /** A string field, with JSON null and absence both null. (optString turns null into "null".) */
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)
    private fun JSONObject.int(k: String): Int? = if (isNull(k)) null else optInt(k)
    private fun JSONObject.long(k: String): Long? = if (isNull(k)) null else optLong(k)

    private inline fun <T> list(json: String, item: (JSONObject) -> T): List<T> {
        val a = JSONArray(json)
        return List(a.length()) { item(a.getJSONObject(it)) }
    }

    fun user(o: JSONObject) = User(
        id = o.getLong("id"),
        email = o.getString("email"),
        name = o.str("name"),
        role = o.getString("role"),
    )

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

    /** GET /api/discover/radio → its `results`. */
    fun radio(json: String): List<Track> {
        val a = JSONObject(json).optJSONArray("results") ?: return emptyList()
        return List(a.length()) { track(a.getJSONObject(it)) }
    }

    fun stats(json: String): LibraryStats {
        val o = JSONObject(json)
        return LibraryStats(o.optInt("tracks"), o.optInt("albums"), o.optInt("artists"), o.optLong("duration"))
    }

    fun tokenGrant(json: String): TokenGrant {
        val o = JSONObject(json)
        return TokenGrant(
            accessToken = o.getString("access_token"),
            expiresInSec = o.getLong("expires_in"),
            refreshToken = o.getString("refresh_token"),
            user = user(o.getJSONObject("user")),
        )
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
