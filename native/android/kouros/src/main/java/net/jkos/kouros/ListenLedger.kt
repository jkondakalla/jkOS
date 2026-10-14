package net.jkos.kouros

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** One history row: POST /api/history. */
data class Listen(
    val itemRef: Long,
    val startedAt: String,
    val msPlayed: Long,
    val completed: Boolean,
    val context: String?,
)

/**
 * The listening ledger's bookkeeping — the web player's flushSession
 * (apps/kouros/src/player/usePlayerEngine.ts), with the clock passed in so the JVM test can
 * drive it. One row per track per PLAYING STRETCH: a stretch opens when a track starts
 * playing, and closes on a pause, a track change, or the app going to the background (which
 * then reopens it, so a long screen-locked listen is banked as it goes rather than lost if the
 * process is killed). A stretch under [MIN_MS] is not a listen.
 *
 * Not thread-safe: the playback service drives it from the player's (main) thread only.
 */
class ListenLedger(private val clock: () -> Long) {
    private class Stretch(val itemRef: Long, val context: String?, val startedAt: String, val startedAtMs: Long)

    private var open: Stretch? = null

    val isOpen get() = open != null
    val openItem get() = open?.itemRef

    /** Open a stretch for [itemRef] unless one is already open for it. */
    fun start(itemRef: Long, context: String?) {
        if (open?.itemRef == itemRef) return
        val now = clock()
        open = Stretch(itemRef, context, iso(now), now)
    }

    /**
     * Close the open stretch and return its row, or null (nothing open, or under [MIN_MS]).
     * [forcedCompleted] is "the player moved on by itself at the end of the track".
     */
    fun close(positionMs: Long, durationMs: Long, forcedCompleted: Boolean = false): Listen? {
        val s = open ?: return null
        open = null
        val played = (clock() - s.startedAtMs).coerceAtLeast(0)
        if (played < MIN_MS) return null
        val completed = forcedCompleted || (durationMs > 0 && positionMs >= durationMs - 1000)
        return Listen(s.itemRef, s.startedAt, played, completed, s.context)
    }

    companion object {
        const val MIN_MS = 1000L

        private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        /** JavaScript's Date.prototype.toISOString(): the suite's one wire format. */
        fun iso(epochMs: Long): String = ISO.format(Instant.ofEpochMilli(epochMs))
    }
}
