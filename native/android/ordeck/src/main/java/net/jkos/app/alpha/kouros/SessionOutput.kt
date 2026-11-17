package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * This phone as the listening session's OUTPUT (TODO §10 G3; the web's half is
 * apps/kouros/src/session/usePlayerSession.ts). It lives in the playback service, so it reports
 * and takes commands with the screen off.
 *
 *  · The role is SessionCore.modeOf over what SessionLink last heard. On a phone one install is
 *    one device, so "this device holds the output" is "the session names it and the player has
 *    something queued".
 *  · As the output (LOCAL) it reports what the player is doing: on every change (coalesced),
 *    every [HEARTBEAT_MS] while playing, and after a seek. The server keeps exactly that.
 *  · Starting playback here while another device is the output, or none is, CLAIMS it
 *    (Spotify: the device you touch is the one that plays). When another device takes it,
 *    this one pauses.
 *  · Commands from remotes are applied through this player, and their indices are the
 *    session's (a book is one item there, its files here: SessionCore.View maps them).
 *  · A session this device was the output of, when the player is empty (the app was killed), is
 *    cued: loaded paused at its second, so pressing play carries on where it was.
 */
internal class SessionOutput(private val player: Player, private val scope: CoroutineScope) : Player.Listener {
    private val me get() = SessionLink.deviceId

    private val _mode = MutableStateFlow(SessionMode.SOLO)
    val mode: StateFlow<SessionMode> = _mode

    private var reportJob: Job? = null
    /** While an adopted queue loads, the player says "nothing": reporting then would erase the session. */
    private var loadingUntil = 0L
    /** A claim or takeover under way: its own playing edge is not a new claim. */
    private var selfClaimUntil = 0L
    private var cuedRev = -1L
    private var muted = false
    private var level = 1f

    fun start() {
        scope.launch { SessionLink.state.collect { onLink(it) } }
        scope.launch { SessionLink.commands.collect { runCatching { onCommand(it) }.onFailure { e -> Log.w(TAG, "session command ${it.op}: ${e.message}") } } }
        scope.launch {
            while (true) {
                delay(HEARTBEAT_MS)
                if (_mode.value == SessionMode.LOCAL && player.isPlaying) reportNow()
            }
        }
    }

    // ── the role ──

    private fun onLink(st: LinkState) {
        val s = st.session
        val active = s?.activeDevice
        val next = SessionCore.modeOf(
            ModeFacts(
                available = st.status == LinkStatus.LIVE || st.status == LinkStatus.RECONNECTING,
                active = active, me = me,
                activeOnline = st.devices.firstOrNull { it.id == active }?.online == true,
                holdsLock = active == me && player.mediaItemCount > 0,
            ),
        )
        val was = _mode.value
        _mode.value = next
        when {
            next == SessionMode.REMOTE && was != SessionMode.REMOTE -> player.pause()   // another device plays
            next == SessionMode.LOCAL && was != SessionMode.LOCAL -> scheduleReport()
        }
        // Cue: the session names this device, the player is empty, and it has something to show.
        if (next == SessionMode.IDLE && s != null && active == me && player.mediaItemCount == 0 && s.itemRef != null && s.rev != cuedRev) {
            cuedRev = s.rev
            scope.launch { adopt(s.items, s.cursor, s.positionAt(SessionLink.serverNow()), s.context, play = false) }
        }
    }

    // ── the player's own events ──

    override fun onEvents(p: Player, events: Player.Events) {
        if (events.containsAny(
                Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_TIMELINE_CHANGED,
                Player.EVENT_PLAYBACK_PARAMETERS_CHANGED, Player.EVENT_POSITION_DISCONTINUITY, Player.EVENT_REPEAT_MODE_CHANGED,
                Player.EVENT_VOLUME_CHANGED,
            )
        ) {
            if (_mode.value == SessionMode.LOCAL) scheduleReport()
            // The queue went from empty to something: the role may change with it.
            onLink(SessionLink.state.value)
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!isPlaying || System.currentTimeMillis() < selfClaimUntil) return
        val m = _mode.value
        if (m == SessionMode.IDLE || m == SessionMode.REMOTE) claim()
    }

    private fun claim() {
        selfClaimUntil = System.currentTimeMillis() + SELF_CLAIM_MS
        scope.launch {
            if (SessionLink.transfer(me, play = true)) {
                onLink(SessionLink.state.value)
                reportNow()
            }
        }
    }

    // ── reporting ──

    private fun scheduleReport() {
        if (reportJob?.isActive == true) return
        reportJob = scope.launch {
            delay(REPORT_COALESCE_MS)
            reportNow()
        }
    }

    private suspend fun reportNow() {
        if (_mode.value != SessionMode.LOCAL) return
        val hold = loadingUntil - System.currentTimeMillis()
        if (hold > 0) { delay(hold); if (_mode.value != SessionMode.LOCAL) return }
        val code = SessionLink.report(SessionCore.reportBody(me, playerState()))
        // 409 NOT_ACTIVE: another device became the output since; the snapshot says which.
        if (code == 409) SessionLink.refreshSnapshot()
    }

    /** The service is going: tell the session this output stopped, so no remote shows it playing. */
    fun goingAway() {
        if (_mode.value != SessionMode.LOCAL) return
        val body = SessionCore.reportBody(me, playerState().copy(playing = false))
        JkosApp.scope.launch { SessionLink.report(body) }
    }

    private fun playerState(): SessionCore.PlayerState {
        val ids = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        val item = player.currentMediaItem
        val book = item?.bookInfo()
        return SessionCore.PlayerState(
            mediaIds = ids,
            current = player.currentMediaItemIndex,
            positionMs = (book?.offsetMs ?: 0L) + player.currentPosition,
            playing = player.isPlaying || (player.playWhenReady && player.playbackState == Player.STATE_BUFFERING),
            rate = player.playbackParameters.speed,
            repeat = when (player.repeatMode) { Player.REPEAT_MODE_ALL -> "all"; Player.REPEAT_MODE_ONE -> "one"; else -> "off" },
            context = item?.mediaMetadata?.extras?.getString(EXTRA_CONTEXT),
            volume = level,
            muted = muted,
            sleep = SleepTimer.state.value,
            nowMs = System.currentTimeMillis(),
        )
    }

    private fun view() = SessionCore.collapse((0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }, player.currentMediaItemIndex)

    // ── commands ──

    private suspend fun onCommand(cmd: SessionCommand) {
        val a = cmd.args
        when (cmd.op) {
            // Every device keeps its own volume: this one is addressed by name, output or not.
            "volume" -> {
                if (a.optString("device") != me) return
                if (a.has("level") && !a.isNull("level")) level = a.getDouble("level").toFloat().coerceIn(0f, 1f)
                if (a.has("muted") && !a.isNull("muted")) muted = a.getBoolean("muted")
                player.volume = if (muted) 0f else level
                scheduleReport()
                return
            }
            "takeover" -> { takeOver(a); return }
            "release" -> { player.pause(); return }
        }
        if (_mode.value != SessionMode.LOCAL) return
        val v = view()
        when (cmd.op) {
            "play" -> player.play()
            "pause" -> player.pause()
            "seek" -> seekInItem(a.optLong("position_ms"))
            "skip" -> seekInItem(positionInItem() + a.optLong("delta_ms"))
            "next" -> v.entryOf(v.cursor + 1).takeIf { it >= 0 }?.let { player.seekTo(it, 0) }
            "prev" -> if (positionInItem() > PREV_RESTARTS_MS || v.cursor <= 0) seekInItem(0) else player.seekTo(v.entryOf(v.cursor - 1), 0)
            "segment" -> segment(a.optString("dir") == "next", v)
            "jump" -> v.entryOf(a.optInt("index", -1)).takeIf { it >= 0 }?.let { player.seekTo(it, 0); player.play() }
            "load" -> adopt(refs(a.optJSONArray("items")), a.optInt("startIndex"), if (a.isNull("position_ms")) 0 else a.optLong("position_ms"), a.optString("context").takeIf { a.has("context") && !a.isNull("context") }, play = true)
            "enqueue" -> enqueue(refs(a.optJSONArray("items")), a.optString("where") == "next", v)
            "remove" -> v.ranges.getOrNull(a.optInt("index", -1))?.let { player.removeMediaItems(it.first, it.last + 1) }
            "reorder" -> v.move(a.optInt("from", -1), a.optInt("to", -1))?.let { (f, l, n) -> player.moveMediaItems(f, l, n) }
            "repeat" -> player.repeatMode = when (a.optString("mode")) { "all" -> Player.REPEAT_MODE_ALL; "one" -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }
            "rate" -> if (player.currentMediaItem?.bookInfo() != null) Rates.next(player.playbackParameters.speed).let { BookRate.set(it); player.setPlaybackSpeed(it) }
            "sleep" -> player.currentMediaItem?.bookInfo()?.let { b ->
                SleepTimer.set(a.optString("mode"), System.currentTimeMillis(), b.layoutChapterEnd(b.offsetMs + player.currentPosition))
            }
            // "shuffle": this player doesn't shuffle, and reports shuffle off; an op this build
            // doesn't know is a newer remote's. Neither is guessed at.
            else -> return
        }
        scheduleReport()
    }

    /** The session is moving here (a transfer to this device): take its queue at its second. */
    private suspend fun takeOver(a: JSONObject) {
        if (System.currentTimeMillis() < selfClaimUntil) { reportNow(); return }
        selfClaimUntil = System.currentTimeMillis() + SELF_CLAIM_MS
        val next = SessionWire.session(a.optJSONObject("session"))
        val play = a.optBoolean("play")
        if (next == null || next.itemRef == null || next.items.isEmpty() || next.cursor < 0) { reportNow(); return }
        val at = next.positionAt(SessionLink.serverNow())
        val v = view()
        if (v.itemRef != null && v.itemRef == canonical(next.itemRef)) {
            seekInItem(at)
            if (play) player.play() else player.pause()
        } else {
            adopt(next.items, next.cursor, at, next.context, play)
        }
        scheduleReport()
    }

    private fun canonical(ref: String) = if (ref.toLongOrNull() != null) "kouros:$ref" else ref

    private fun refs(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.get(it).toString() }

    private fun positionInItem(): Long = (player.currentMediaItem?.bookInfo()?.offsetMs ?: 0L) + player.currentPosition

    /** Seek within the current item: for a book, a position in the whole book, across its files. */
    private fun seekInItem(ms: Long) {
        val book = player.currentMediaItem?.bookInfo()
        if (book == null) { player.seekTo(ms.coerceAtLeast(0)); return }
        val target = ms.coerceIn(0, book.totalMs)
        var best = -1
        var bestOffset = -1L
        for (i in 0 until player.mediaItemCount) {
            val info = player.getMediaItemAt(i).bookInfo() ?: continue
            if (info.bookId == book.bookId && info.offsetMs <= target && info.offsetMs >= bestOffset) { best = i; bestOffset = info.offsetMs }
        }
        if (best >= 0) player.seekTo(best, target - bestOffset)
    }

    private fun segment(next: Boolean, v: SessionCore.View) {
        val book = player.currentMediaItem?.bookInfo()
        if (book == null || book.chapters.isEmpty()) {
            if (next) v.entryOf(v.cursor + 1).takeIf { it >= 0 }?.let { player.seekTo(it, 0) } else seekInItem(0)
            return
        }
        val layout = BookLayout(listOf(BookFile(0, book.totalMs / 1000.0)), book.chapters)
        val at = positionInItem()
        (if (next) layout.nextChapterStart(at) else layout.previousChapterStart(at))?.let(::seekInItem)
    }

    /** Session refs as player entries, in order: tracks with their rows, books as their files. */
    private suspend fun resolve(refs: List<String>, context: String?): List<Pair<String, List<MediaItem>>> {
        val trackIds = refs.mapNotNull { trackId(it) }
        val tracks = if (trackIds.isEmpty()) emptyMap() else KourosApi.tracksByIds(trackIds).associateBy { it.id }
        val out = mutableListOf<Pair<String, List<MediaItem>>>()
        val books = HashMap<Long, List<MediaItem>>()
        for (r in refs) {
            val t = trackId(r)
            if (t != null) { tracks[t]?.let { out += canonical(r) to listOf(it.toMediaItem(context)) }; continue }
            val b = r.removePrefix("book:").toLongOrNull() ?: continue
            val files = books.getOrPut(b) { runCatching { KourosApi.book(b).toMediaItems() }.getOrDefault(emptyList()) }
            if (files.isNotEmpty()) out += r to files
        }
        return out
    }

    private fun trackId(ref: String): Long? = ref.toLongOrNull() ?: ref.takeIf { it.startsWith("kouros:") }?.removePrefix("kouros:")?.toLongOrNull()

    /** Replace the queue with the session's, at [cursor] and [positionMs] in that item. */
    private suspend fun adopt(refs: List<String>, cursor: Int, positionMs: Long, context: String?, play: Boolean) {
        loadingUntil = System.currentTimeMillis() + LOAD_HOLD_MS
        try {
            val want = refs.getOrNull(cursor)?.let(::canonical)
            val groups = try { resolve(refs, context) } catch (e: CancellationException) { throw e } catch (e: Exception) { Log.w(TAG, "session load: ${e.message}"); return }
            if (groups.isEmpty()) return
            // The item the session was at, by its place among the refs that resolved.
            val at = groups.indexOfFirst { it.first == want }.takeIf { it >= 0 } ?: 0
            val items = groups.flatMap { it.second }
            var entry = groups.take(at).sumOf { it.second.size }
            var offset = positionMs
            val first = groups[at].second.first().bookInfo()
            if (first != null) {
                // A book: the position is in the whole book; find its file.
                val files = groups[at].second
                val i = files.indexOfLast { (it.bookInfo()?.offsetMs ?: 0L) <= positionMs }.coerceAtLeast(0)
                entry += i
                offset = positionMs - (files[i].bookInfo()?.offsetMs ?: 0L)
            }
            player.setMediaItems(items, entry, offset.coerceAtLeast(0))
            player.prepare()
            selfClaimUntil = System.currentTimeMillis() + SELF_CLAIM_MS   // this playing edge is the session's, not a claim
            if (play) player.play() else player.pause()
        } finally {
            loadingUntil = 0
            scheduleReport()
        }
    }

    private suspend fun enqueue(refs: List<String>, next: Boolean, v: SessionCore.View) {
        val items = try { resolve(refs, null).flatMap { it.second } } catch (e: CancellationException) { throw e } catch (e: Exception) { return }
        if (items.isEmpty()) return
        val after = v.ranges.getOrNull(v.cursor)?.last
        if (next && after != null) player.addMediaItems(after + 1, items) else player.addMediaItems(items)
    }

    companion object {
        private const val TAG = "KourOS"
        /** usePlayerSession.ts HEARTBEAT_MS: the server presumes an output gone after three missed. */
        const val HEARTBEAT_MS = 15_000L
        const val REPORT_COALESCE_MS = 150L
        const val SELF_CLAIM_MS = 5_000L
        const val LOAD_HOLD_MS = 10_000L
        const val PREV_RESTARTS_MS = 3_000L
    }
}
