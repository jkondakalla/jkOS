package net.jkos.app.alpha.kouros

import org.json.JSONArray
import org.json.JSONObject

// The listening session's pure half (TODO §10 G3): which role this device plays, and the state
// body it reports when it is the output. The protocol is apps/kouros/backend/src/session/
// routes.js; the server validates every body with session/validate.js. Pure, so the JVM test
// holds it, and two shared case files hold it to the other side:
//   native/session-mode-cases.json    the role decision, which the web's route.ts also passes
//   native/session-state-cases.json   player states and the bodies they report, each of which
//                                     validate.js's stateReport accepts (check:native runs it)

/** This device's part in the session: the web's SessionMode (apps/kouros/src/session/route.ts). */
enum class SessionMode(val wire: String) { LOCAL("local"), REMOTE("remote"), IDLE("idle"), SOLO("solo") }

/** The facts the role is decided from, named as route.ts names them. */
data class ModeFacts(
    /** False until the session is reachable at all. */
    val available: Boolean,
    /** The session's output device id, or null. */
    val active: String?,
    /** This device's id. */
    val me: String,
    /** Does the output device hold at least one open stream? */
    val activeOnline: Boolean,
    /** Does this device's player hold the output? On a phone one install is one device, so
     *  this is the playback service having claimed it, and [lockElsewhere] is always false. */
    val holdsLock: Boolean,
    val lockElsewhere: Boolean = false,
)

object SessionCore {
    /** route.ts modeOf, line for line. */
    fun modeOf(f: ModeFacts): SessionMode {
        if (!f.available) return SessionMode.SOLO
        if (f.active == f.me) {
            if (f.holdsLock) return SessionMode.LOCAL
            if (f.lockElsewhere) return SessionMode.REMOTE
            return SessionMode.IDLE
        }
        if (f.active != null && f.activeOnline) return SessionMode.REMOTE
        return SessionMode.IDLE
    }

    /**
     * The player's queue as the session's: Media3 holds a book as one entry per file, the
     * session as ONE item, `book:<id>`. A track is `kouros:<id>` (the web's encodeRef). [ranges]
     * maps each session item back to the player entries it stands for, so a remote's "jump to 3"
     * or "remove 2" lands on the right files.
     */
    data class View(val items: List<String>, val cursor: Int, val ranges: List<IntRange>) {
        val itemRef: String? get() = items.getOrNull(cursor)

        /** The first player entry of session item [index], or -1. */
        fun entryOf(index: Int): Int = ranges.getOrNull(index)?.first ?: -1

        /**
         * A remote's "reorder from → to" (session items, remove-then-insert) as Media3's
         * moveMediaItems(first, lastExclusive, newIndex) over the entries, or null when it moves
         * nothing. A book moves with all its files.
         */
        fun move(from: Int, to: Int): Triple<Int, Int, Int>? {
            val a = ranges.getOrNull(from) ?: return null
            if (to !in items.indices || to == from) return null
            val len = a.last - a.first + 1
            val total = ranges.last().last + 1
            val rest = ranges.filterIndexed { i, _ -> i != from }
            val newIndex = if (to < rest.size) rest[to].first.let { if (it > a.last) it - len else it } else total - len
            return Triple(a.first, a.last + 1, newIndex)
        }
    }

    fun collapse(mediaIds: List<String>, current: Int): View {
        val items = mutableListOf<String>()
        val ranges = mutableListOf<IntRange>()
        var cursor = -1
        for ((i, id) in mediaIds.withIndex()) {
            val ref = MediaRef.parse(id) ?: continue
            val key = when (ref) {
                is MediaRef.TrackRef -> "kouros:${ref.id}"
                is MediaRef.BookFileRef -> "book:${ref.bookId}"
            }
            // The next file of the book that is the last item continues it.
            if (ref is MediaRef.BookFileRef && items.lastOrNull() == key && ranges.last().last == i - 1) {
                ranges[ranges.lastIndex] = ranges.last().first..i
            } else {
                items += key
                ranges += i..i
            }
            if (i == current) cursor = items.lastIndex
        }
        if (items.isEmpty()) cursor = -1 else if (cursor < 0) cursor = 0
        return View(items, cursor, ranges)
    }

    /** What the output is doing, as the report needs it. */
    data class PlayerState(
        val mediaIds: List<String>,
        val current: Int,
        /** Where in the current item: for a book, in the whole book. */
        val positionMs: Long,
        val playing: Boolean,
        val rate: Float,
        /** "off" | "all" | "one" (Media3's repeat mode). */
        val repeat: String,
        val context: String?,
        val volume: Float,
        val muted: Boolean,
        val sleep: SleepState,
        val nowMs: Long,
    )

    const val MAX_POSITION_MS = 7L * 24 * 3600 * 1000

    /** validate.js MAX_QUEUE: a load or an enqueue carries at most this many items. */
    const val MAX_QUEUE = 5000

    // ── the commands a remote sends (validate.js `command`); native/session-command-cases.json ──

    /** A command's `args`, as the server's COMMANDS table reads them. */
    object Commands {
        fun simple(): JSONObject = JSONObject()

        fun load(items: List<String>, start: Int, positionMs: Long?, context: String?): JSONObject = JSONObject().apply {
            val kept = items.take(MAX_QUEUE)
            put("items", JSONArray(kept))
            put("startIndex", start.coerceIn(0, (kept.size - 1).coerceAtLeast(0)))
            if (positionMs != null) put("position_ms", positionMs.coerceIn(0, MAX_POSITION_MS))
            put("context", context ?: JSONObject.NULL)
        }

        fun enqueue(items: List<String>, next: Boolean): JSONObject =
            JSONObject().put("items", JSONArray(items.take(MAX_QUEUE))).put("where", if (next) "next" else "end")

        fun seek(ms: Long): JSONObject = JSONObject().put("position_ms", ms.coerceIn(0, MAX_POSITION_MS))

        fun skip(deltaMs: Long): JSONObject = JSONObject().put("delta_ms", deltaMs.coerceIn(-3_600_000, 3_600_000))

        fun segment(next: Boolean): JSONObject = JSONObject().put("dir", if (next) "next" else "prev")

        fun volume(device: String, level: Float): JSONObject = JSONObject().put("device", device).put("level", level.coerceIn(0f, 1f).toDouble())
    }

    /** The POST /api/session/commands body: the op, its args, the sender, and the suite's idempotency key. */
    fun commandBody(op: String, args: JSONObject, from: String, idempotencyKey: String): JSONObject =
        JSONObject().put("op", op).put("args", args).put("from", from).put("idempotency_key", idempotencyKey)

    /**
     * The POST /api/session/state body (validate.js stateReport). The queue is @jkos/player's
     * Queue: this player doesn't shuffle, so its policy is shuffle off with no order.
     */
    fun reportBody(deviceId: String, p: PlayerState): JSONObject {
        val view = collapse(p.mediaIds, p.current)
        val sleepMode = p.sleep.mode.takeIf { it != SleepState.OFF }
        return JSONObject().apply {
            put("deviceId", deviceId)
            put("queue", JSONObject().apply {
                put("items", JSONArray(view.items))
                put("cursor", view.cursor)
                put("policy", JSONObject().apply {
                    put("shuffle", false)
                    put("repeat", p.repeat.takeIf { it in setOf("off", "all", "one") } ?: "off")
                    put("shuffleSeed", 0)
                    put("shuffleOrder", JSONArray())
                })
            })
            put("item_ref", view.itemRef ?: JSONObject.NULL)
            put("context", if (view.itemRef == null) JSONObject.NULL else (p.context ?: JSONObject.NULL))
            put("position_ms", if (view.itemRef == null) 0 else p.positionMs.coerceIn(0, MAX_POSITION_MS))
            put("playing", p.playing && view.itemRef != null)
            put("rate", p.rate.coerceIn(0.5f, 3f).toDouble())
            put("volume", p.volume.coerceIn(0f, 1f).toDouble())
            put("muted", p.muted)
            put("sleep_mode", sleepMode ?: JSONObject.NULL)
            put("sleep_remaining_ms", if (sleepMode != null && sleepMode != SleepState.CHAPTER) p.sleep.remainingMs(p.nowMs) ?: 0 else JSONObject.NULL)
        }
    }
}
