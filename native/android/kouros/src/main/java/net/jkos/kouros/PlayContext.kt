package net.jkos.kouros

// WHERE a listen was played from, as the one string KourOS's history ledger keeps.
// The grammar is apps/kouros/backend/src/playContext.js (and the server refuses anything
// else with a 400, which would lose the listen with it):
//
//   album/<artist>/<album>    both segments encoded like JavaScript's encodeURIComponent
//   artist/<artist>
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

    fun station(seedTrackId: Long): String? = if (seedTrackId in 0..999_999_999_999L) "station/$seedTrackId" else null
}
