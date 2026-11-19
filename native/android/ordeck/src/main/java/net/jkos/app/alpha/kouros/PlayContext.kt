package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

// WHERE a listen was played from, as the one string KourOS's history ledger keeps.
// The grammar is apps/kouros/backend/src/playContext.js (and the server refuses anything
// else with a 400, which would lose the listen with it):
//
//   album/<artist>/<album>    both segments encoded like JavaScript's encodeURIComponent
//   artist/<artist>
//   playlist/<playlist id>
//   book/<book id>
//   station/<seed track id>
//
// The encoder is written out here rather than borrowed from android.net.Uri.encode: it has to
// produce the SAME bytes as the web player's encodeURIComponent, and as plain Kotlin it can be
// held to that on the JVM. native/play-context-cases.json holds the vectors; this file's unit
// test and test/native.mjs (JS's own encodeURIComponent + the server's parser) both pass them.
object PlayContext {
    /** The server's limit (playContext.js MAX_LEN). Longer, and the listen is kept without one. */
    const val MAX_LEN = 600

    private const val UNRESERVED = "-_.!~*'()"
    private val HEX = "0123456789ABCDEF".toCharArray()

    /** JavaScript's encodeURIComponent, or null where JS would throw (a lone surrogate). */
    fun encodeComponent(s: String): String? {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate()) {
                if (i + 1 >= s.length || !s[i + 1].isLowSurrogate()) return null
                i += 2
                continue
            }
            if (c.isLowSurrogate()) return null
            i++
        }
        val out = StringBuilder(s.length)
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val ch = (b.toInt() and 0xff).toChar()
            if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || UNRESERVED.indexOf(ch) >= 0) {
                out.append(ch)
            } else {
                out.append('%').append(HEX[(b.toInt() shr 4) and 0xf]).append(HEX[b.toInt() and 0xf])
            }
        }
        return out.toString()
    }

    private fun bounded(s: String?) = s?.takeIf { it.length <= MAX_LEN }

    fun album(artist: String, album: String): String? {
        if (artist.isEmpty() || album.isEmpty()) return null
        val a = encodeComponent(artist) ?: return null
        val b = encodeComponent(album) ?: return null
        return bounded("album/$a/$b")
    }

    fun artist(artist: String): String? {
        if (artist.isEmpty()) return null
        return bounded("artist/${encodeComponent(artist) ?: return null}")
    }

    fun station(seedTrackId: Long): String? = id("station", seedTrackId)

    fun playlist(playlistId: Long): String? = id("playlist", playlistId)

    fun book(bookId: Long): String? = id("book", bookId)

    /** `<kind>/<id>`: the server's ID is 1–12 digits. */
    private fun id(kind: String, id: Long): String? = if (id in 0..999_999_999_999L) "$kind/$id" else null

    /** A play context read back: where it was played from, which is also the page it opens. */
    sealed interface Place {
        data class Album(val artist: String, val album: String) : Place
        data class Artist(val artist: String) : Place
        data class Playlist(val id: Long) : Place
        data class Book(val id: Long) : Place
        data class Station(val seed: Long) : Place
    }

    /** The server's parsePlayContext (playContext.js): null for anything it would refuse. */
    fun parse(raw: String?): Place? {
        if (raw.isNullOrEmpty() || raw.length > MAX_LEN) return null
        val parts = raw.split('/')
        fun idOf(s: String) = s.takeIf { it.length in 1..12 && it.all(Char::isDigit) }?.toLong()
        return when (parts[0]) {
            "album" -> if (parts.size != 3) null else {
                val artist = decodeComponent(parts[1]); val album = decodeComponent(parts[2])
                if (artist.isNullOrEmpty() || album.isNullOrEmpty()) null else Place.Album(artist, album)
            }
            "artist" -> if (parts.size != 2) null else decodeComponent(parts[1])?.takeIf { it.isNotEmpty() }?.let { Place.Artist(it) }
            "playlist" -> if (parts.size != 2) null else idOf(parts[1])?.let { Place.Playlist(it) }
            "book" -> if (parts.size != 2) null else idOf(parts[1])?.let { Place.Book(it) }
            "station" -> if (parts.size != 2) null else idOf(parts[1])?.let { Place.Station(it) }
            else -> null
        }
    }

    /** JavaScript's decodeURIComponent, or null where JS would throw (a bad escape, bytes that aren't UTF-8). */
    fun decodeComponent(s: String): String? {
        if ('%' !in s) return s
        val bytes = java.io.ByteArrayOutputStream()
        val out = StringBuilder()
        fun flush(): Boolean {
            if (bytes.size() == 0) return true
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            val text = try { decoder.decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString() } catch (e: java.nio.charset.CharacterCodingException) { return false }
            out.append(text); bytes.reset(); return true
        }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%') {
                if (i + 2 > s.lastIndex) return null
                val hi = Character.digit(s[i + 1], 16); val lo = Character.digit(s[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                if (!flush()) return null
                out.append(c)
                i++
            }
        }
        return if (flush()) out.toString() else null
    }
}
