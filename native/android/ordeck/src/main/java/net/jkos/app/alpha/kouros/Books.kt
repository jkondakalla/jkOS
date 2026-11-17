package net.jkos.app.alpha.kouros

import org.json.JSONArray
import org.json.JSONObject

// Audiobooks: their shapes as this app reads them, and the arithmetic of a book that is N files
// with chapters across all of them. Pure: org.json is part of Android and an artifact on the JVM,
// so the test holds everything here. The server half is apps/kouros/backend/src/books/ and
// discovery.js's PROGRESS, BOOKMARKS and BOOK_HISTORY.
//
// ⚠️ `book_ref` is a weave `ref` column, so it is TEXT on the wire ("13", not 13). The web lost
// four features to that for months (TRAPS.md § SQLite). Here it is coerced at one door, [ref].

/** A `books` list row: scalar metadata only. */
data class Book(
    val id: Long,
    val title: String,
    val subtitle: String?,
    val author: String?,
    val narrator: String?,
    val series: String?,
    val seriesSeq: Double?,
    val year: Int?,
    val durationSec: Double,
    val hasCover: Boolean,
)

data class BookFile(val index: Int, val durationSec: Double)

data class Chapter(val startSec: Double, val endSec: Double, val title: String)

/** GET /api/book/:bookId: the list row plus the files, the chapters and the description. */
data class BookDetail(val book: Book, val description: String?, val files: List<BookFile>, val chapters: List<Chapter>)

/** A `progress` row: where this listener left one book, on any device. */
data class Progress(val id: Long, val bookId: Long, val positionSec: Double, val durationSec: Double, val finished: Boolean, val lastPlayed: String?)

data class Bookmark(val id: Long, val bookId: Long, val positionSec: Double, val title: String?)

/** What the queue holds for one playable thing: a track, or one file of a book. */
sealed interface MediaRef {
    data class TrackRef(val id: Long) : MediaRef
    data class BookFileRef(val bookId: Long, val fileIndex: Int) : MediaRef

    companion object {
        /**
         * A queue entry's mediaId. A bare number is a track, as every id already in the queue
         * and the history is. `book:<bookId>:<fileIndex>` is a book's file. Anything else is
         * nothing, and the service drops it.
         */
        fun parse(mediaId: String): MediaRef? {
            mediaId.toLongOrNull()?.let { return if (it >= 0) TrackRef(it) else null }
            val parts = mediaId.split(':')
            if (parts.size != 3 || parts[0] != "book") return null
            val book = parts[1].toLongOrNull()?.takeIf { it >= 0 } ?: return null
            val file = parts[2].toIntOrNull()?.takeIf { it >= 0 } ?: return null
            return BookFileRef(book, file)
        }

        fun of(bookId: Long, fileIndex: Int) = "book:$bookId:$fileIndex"
    }
}

/**
 * One book's files laid end to end. A position in the book ("global") is what the server keeps
 * in `progress`, what chapters are measured in and what the listener sees; the player plays
 * one file at a time, so each global position is a file and an offset into it.
 */
class BookLayout(files: List<BookFile>, val chapters: List<Chapter>) {
    /** The files in play order. */
    val files: List<BookFile> = files.sortedBy { it.index }
    private val startsMs: LongArray = LongArray(this.files.size).also { s ->
        var acc = 0L
        this.files.forEachIndexed { i, f -> s[i] = acc; acc += (f.durationSec * 1000).toLong() }
    }
    val totalMs: Long = this.files.sumOf { (it.durationSec * 1000).toLong() }

    /** Where file [pos] (its place in play order) starts in the book. */
    fun startOf(pos: Int): Long = startsMs.getOrElse(pos) { 0L }

    /** The file (place in play order) and the offset into it for [globalMs], kept inside the book. */
    fun locate(globalMs: Long): Pair<Int, Long> {
        if (files.isEmpty()) return 0 to 0L
        val g = globalMs.coerceIn(0L, totalMs)
        // The last file that starts at or before it: exactly on a boundary is the later file.
        val pos = startsMs.indexOfLast { it <= g }.coerceAtLeast(0)
        return pos to (g - startsMs[pos])
    }

    /** The chapter [globalMs] is in, or -1 (no chapters, or past them all). */
    fun chapterAt(globalMs: Long): Int {
        val s = globalMs / 1000.0
        return chapters.indexOfFirst { s >= it.startSec && s < it.endSec }
    }

    /**
     * Where "previous chapter" goes from [globalMs]: the start of this chapter, or the one before
     * if that's within the first [GRACE_MS] of it (the way every player's back button works).
     */
    fun previousChapterStart(globalMs: Long): Long? {
        val c = chapterAt(globalMs).takeIf { it >= 0 } ?: return null
        val start = (chapters[c].startSec * 1000).toLong()
        return if (globalMs - start > GRACE_MS || c == 0) start else (chapters[c - 1].startSec * 1000).toLong()
    }

    fun nextChapterStart(globalMs: Long): Long? {
        val c = chapterAt(globalMs)
        return chapters.getOrNull(c + 1)?.let { (it.startSec * 1000).toLong() }
    }

    companion object {
        const val GRACE_MS = 3000L
    }
}

object BookModels {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)
    private fun JSONObject.num(k: String): Double? = if (isNull(k)) null else optDouble(k).takeUnless { it.isNaN() }

    /** The ONE door a `book_ref` comes through: a number, or the numeric TEXT a ref column holds. */
    fun ref(v: Any?): Long? = when (v) {
        is Number -> v.toLong().takeIf { it >= 0 && v.toDouble() == it.toDouble() }
        is String -> v.toLongOrNull()?.takeIf { it >= 0 }
        else -> null
    }

    private inline fun <T> list(json: String, item: (JSONObject) -> T?): List<T> {
        val a = JSONArray(json)
        return (0 until a.length()).mapNotNull { item(a.getJSONObject(it)) }
    }

    private fun book(o: JSONObject) = Book(
        id = o.getLong("id"),
        title = o.str("title") ?: "",
        subtitle = o.str("subtitle"),
        author = o.str("author"),
        narrator = o.str("narrator"),
        series = o.str("series"),
        seriesSeq = o.num("series_seq"),
        year = if (o.isNull("year")) null else o.optInt("year"),
        durationSec = o.num("duration") ?: 0.0,
        hasCover = o.str("cover_path") != null,
    )

    fun books(json: String): List<Book> = list(json, ::book)

    fun detail(json: String): BookDetail {
        val o = JSONObject(json)
        val files = o.optJSONArray("files") ?: JSONArray()
        val chapters = o.optJSONArray("chapters") ?: JSONArray()
        return BookDetail(
            book = book(o),
            description = o.str("description"),
            files = (0 until files.length()).mapNotNull { i ->
                val f = files.optJSONObject(i) ?: return@mapNotNull null
                if (f.isNull("index")) null else BookFile(f.optInt("index"), f.num("duration") ?: 0.0)
            },
            chapters = (0 until chapters.length()).mapNotNull { i ->
                val c = chapters.optJSONObject(i) ?: return@mapNotNull null
                val start = c.num("start") ?: return@mapNotNull null
                val end = c.num("end") ?: return@mapNotNull null
                Chapter(start, end, c.str("title")?.takeIf { it.isNotBlank() } ?: "Chapter ${i + 1}")
            },
        )
    }

    fun progress(json: String): List<Progress> = list(json) { o ->
        val book = ref(o.opt("book_ref")) ?: return@list null
        Progress(o.getLong("id"), book, o.num("position") ?: 0.0, o.num("duration") ?: 0.0, o.optBoolean("finished"), o.str("last_played"))
    }

    fun bookmarks(json: String): List<Bookmark> = list(json) { o ->
        val book = ref(o.opt("book_ref")) ?: return@list null
        Bookmark(o.getLong("id"), book, o.num("position") ?: 0.0, o.str("title"))
    }

    /** The /api/progress body, for a PATCH of the row or the POST that makes it. */
    fun progressBody(bookId: Long, positionMs: Long, durationMs: Long, finished: Boolean, at: String): String = JSONObject().apply {
        put("book_ref", bookId)
        put("position", positionMs / 1000.0)
        put("duration", durationMs / 1000.0)
        put("finished", finished)
        put("last_played", at)
    }.toString()

    fun bookmarkBody(bookId: Long, positionMs: Long, title: String?): String = JSONObject().apply {
        put("book_ref", bookId)
        put("position", positionMs / 1000.0)
        if (!title.isNullOrBlank()) put("title", title.trim().take(200))
    }.toString()

    /** The POST /api/book_history body. A book listen IS its book: there is no context column. */
    fun bookListenBody(l: Listen): String = JSONObject().apply {
        put("item_ref", l.itemRef)
        put("started_at", l.startedAt)
        put("ms_played", l.msPlayed)
        put("completed", l.completed)
    }.toString()

    /** "Unknown author · read by X", as the web's book byline. */
    fun byline(b: Book): String = listOfNotNull(b.author ?: "Unknown author", b.narrator?.let { "read by $it" }).joinToString(" · ")

    /** A description is third-party HTML: flattened to text, never rendered (the web's plainDescription). */
    fun plain(description: String?): String? {
        if (description.isNullOrBlank()) return null
        val text = description
            .replace(Regex("(?i)<br\\s*/?>|</p>"), "\n")
            .replace(Regex("<[^>]*>"), "")
            .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'")
            .lines().joinToString("\n") { it.trim() }
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
        return text.ifEmpty { null }
    }
}

/** The playback rate, for books only (the web's rateAppliesTo): a 1.5× habit must not speed up a song. */
object Rates {
    /** packages/player/src/engine/rate.ts RATE_PRESETS. */
    val PRESETS = listOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f)

    fun next(current: Float): Float = PRESETS.firstOrNull { it > current + 0.001f } ?: PRESETS.first()

    fun label(rate: Float): String {
        val digits = if (rate % 1f == 0f) 0 else if ((rate * 10) % 1f == 0f) 1 else 2
        return String.format(java.util.Locale.ROOT, "%.${digits}f×", rate)
    }
}
