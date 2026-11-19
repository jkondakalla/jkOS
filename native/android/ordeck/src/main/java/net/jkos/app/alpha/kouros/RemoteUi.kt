package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.media3.common.Player
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import net.jkos.app.alpha.look.*

// The phone as a REMOTE (TODO §10 G3): another device is the session's output, and this one
// draws what it is doing, on the server's clock, and sends every verb to it as a command.
// The web's half is apps/kouros/src/session/remote.ts. The face is Now Playing's own
// (NowPlayingUi.kt): RemoteControls is the session's half of PlayerControls.

/** What the output is playing, resolved for drawing. */
data class RemoteNow(
    val itemRef: String,
    val title: String,
    /** A track's artist, a book's author. */
    val artist: String,
    val album: String,
    val albumArtist: String,
    val trackId: Long?,
    val bookId: Long?,
    val coverId: Long?,
    val durationMs: Long,
    val chapters: List<Chapter>,
) {
    val isBook get() = bookId != null
}

/** True while this phone is a remote: the screens then draw the session, not the local player. */
@Composable
fun rememberIsRemote(): Boolean = SessionLink.role.collectAsState().value == SessionMode.REMOTE

/** The session's current item, resolved (a track's row, or a book's detail), or null. */
@Composable
fun rememberRemoteNow(): RemoteNow? {
    val st by SessionLink.state.collectAsState()
    val ref = st.session?.itemRef
    val now by produceState<RemoteNow?>(null, ref) {
        value = ref?.let { r -> runCatching { resolveNow(r) }.getOrNull() }
    }
    return now?.takeIf { it.itemRef == ref }
}

private suspend fun resolveNow(ref: String): RemoteNow? {
    val book = ref.takeIf { it.startsWith("book:") }?.removePrefix("book:")?.toLongOrNull()
    if (book != null) {
        val d = KourosApi.book(book)
        return RemoteNow(ref, d.book.title, d.book.author ?: "", "", "", null, d.book.id, d.book.id.takeIf { d.book.hasCover }, BookLayout(d.files, d.chapters).totalMs, d.chapters)
    }
    val id = (ref.removePrefix("kouros:")).toLongOrNull() ?: return null
    val t = KourosApi.tracksByIds(listOf(id)).firstOrNull() ?: return null
    return RemoteNow(ref, t.title, t.artist ?: t.albumArtist ?: "", t.album ?: "", t.albumArtist ?: t.artist ?: "", t.id, null, t.id.takeIf { t.hasCover }, t.durationMs, emptyList())
}

/** The output's position now, ticking while it plays: the server's report, extrapolated on its clock. */
@Composable
fun rememberRemotePosition(): Long {
    val st by SessionLink.state.collectAsState()
    val s = st.session ?: return 0L
    var pos by remember(s.rev) { mutableLongStateOf(s.positionAt(SessionLink.serverNow())) }
    LaunchedEffect(s.rev, s.playing) {
        while (s.playing) {
            pos = s.positionAt(SessionLink.serverNow())
            delay(500)
        }
        pos = s.positionAt(SessionLink.serverNow())
    }
    return pos
}

internal fun send(op: String, args: JSONObject = SessionCore.Commands.simple()) {
    JkosApp.scope.launch { SessionLink.command(op, args) }
}

private fun outputName(st: LinkState): String =
    st.devices.firstOrNull { it.id == st.session?.activeDevice }?.name ?: "another device"

/** Every verb as a command to the output (validate.js COMMANDS). */
object RemoteControls : PlayerControls {
    override fun toggle() = send(if (SessionLink.state.value.session?.playing == true) "pause" else "play")
    override fun seek(ms: Long) = send("seek", SessionCore.Commands.seek(ms))
    override fun next() = send("next")
    override fun previous() = send("prev")
    override fun skip(deltaMs: Long) = send("skip", SessionCore.Commands.skip(deltaMs))
    override fun chapter(next: Boolean) = send("segment", SessionCore.Commands.segment(next))
    override fun shuffle(on: Boolean) = send("shuffle", SessionCore.Commands.shuffle(on))
    override fun repeat(mode: Int) = send("repeat", SessionCore.Commands.repeat(PlayPolicy.repeatName(mode)))
    override fun rate() = send("rate")
    override fun sleep(mode: String) = send("sleep", SessionCore.Commands.sleep(mode))
    override fun retry() = send("play")

    /** The station loads on the output from where the seed is now, so it carries on without a gap. */
    override suspend fun station(seedTrackId: Long): String = when (val r = attempt { KourosApi.radio(seedTrackId) }) {
        is Load.Ready -> {
            val rest = r.value.filter { it.id != seedTrackId }
            if (rest.isEmpty()) "No station for this track yet." else {
                val s = SessionLink.state.value.session
                val at = s?.positionAt(SessionLink.serverNow())
                SessionLink.command("load", SessionCore.Commands.load(listOf("kouros:$seedTrackId") + rest.map { "kouros:${it.id}" }, 0, at, PlayContext.station(seedTrackId)))
                "Station: ${rest.size} tracks queued."
            }
        }
        is Load.Failed -> r.message
        Load.Loading -> ""
    }
}

/** The session's output as a face, where it is now, and its controls; null until its item resolves. */
@Composable
fun rememberRemote(): Triple<PlayerFace, Long, PlayerControls>? {
    val st by SessionLink.state.collectAsState()
    val s = st.session
    val now = rememberRemoteNow()
    val position = rememberRemotePosition()
    if (s == null || now == null) return null
    val book = now.bookId?.let { BookInfo(it, 0L, now.durationMs, now.chapters) }
    val n = s.items.size
    val face = PlayerFace(
        title = now.title, artist = now.artist, album = now.album, albumArtist = now.albumArtist,
        coverId = now.coverId, trackId = now.trackId, book = book,
        playing = s.playing, buffering = false, durationMs = now.durationMs,
        hasNext = s.cursor in 0 until n - 1 || s.repeat == "all", hasPrevious = true,
        shuffle = s.shuffle, canShuffle = book == null && n > 1,
        repeat = PlayPolicy.repeatOf(s.repeat),
        place = if (n > 1 && s.cursor >= 0) "${s.cursor + 1} of $n" else "Now playing",
        upNext = null, rate = s.rate.toFloat(),
        sleep = SleepView(s.sleepMode ?: SleepState.OFF, s.sleepRemainingMs),
        error = null, output = outputName(st),
    )
    return Triple(face, position, RemoteControls)
}

// ── the device picker ──────────────────────────────────────────────────────────

/**
 * Every device this listener has, the output marked: tap one to make it the output (this one
 * included, which plays here from the session's second), and set any online device's volume.
 * Drawn as the web's DevicePicker: a sheet, each device a row with its lamp.
 */
@Composable
fun DevicesDialog(onDismiss: () -> Unit) {
    val st by SessionLink.state.collectAsState()
    val me = SessionLink.deviceId
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    val f = Jk.face
    LaunchedEffect(Unit) { SessionLink.refreshSnapshot() }
    Dialog(onDismissRequest = onDismiss) {
        Sheet(Modifier.fillMaxWidth()) {
            SheetHead("Choose where to listen")
            if (st.status != LinkStatus.LIVE) Hush("Connecting to the session…", Modifier.padding(bottom = 8.dp))
            note?.let { Text(it, Modifier.padding(bottom = 8.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = f.secondary)) }
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(st.devices.sortedWith(compareByDescending<SessionDevice> { it.id == st.session?.activeDevice }.thenByDescending { it.online }.thenBy { it.name }), key = { it.id }) { d ->
                    val output = d.id == st.session?.activeDevice
                    val shape = RoundedCornerShape(JkRadius.base)
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(shape)
                            .background(if (output) f.accent.mix(10.0, f.card) else Color.Transparent)
                            .border(1.dp, if (output) f.accent.mix(45.0, f.line) else f.line, shape)
                            .clickable(enabled = d.online && !output) {
                                scope.launch {
                                    note = if (SessionLink.transfer(d.id, play = if (d.id == me) true else null)) null else "Couldn't move playback to ${d.name}."
                                    if (note == null) onDismiss()
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                            .alpha(if (d.online || output) 1f else 0.55f),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(if (d.online) f.ok else f.ghost))
                            Spacer(Modifier.width(10.dp))
                            Text(
                                d.name + if (d.id == me) " · this phone" else "", Modifier.weight(1f),
                                style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = if (output) FontWeight.Bold else FontWeight.SemiBold, fontSize = 15.sp, color = if (output) f.accent else f.ink),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            Eyebrow(if (output) "Playing" else if (d.online) d.kind else "offline", color = if (output) f.accent else f.faint, size = 9.sp)
                        }
                        if (d.online && d.id != me) {
                            var level by remember(d.id) { mutableFloatStateOf((d.volume ?: 1.0).toFloat()) }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Eyebrow("Vol", size = 9.sp)
                                JkSlider(
                                    value = level, onValueChange = { level = it },
                                    onValueChangeFinished = { send("volume", SessionCore.Commands.volume(d.id, level)) },
                                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                                )
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                TButton(quiet = true, onClick = onDismiss) { Text("Done") }
            }
        }
    }
}

// ── the output's queue ─────────────────────────────────────────────────────────

/** One row of the output's queue, resolved for drawing. */
private data class RemoteRow(val ref: String, val title: String, val subtitle: String, val coverId: Long?, val isBook: Boolean, val durationMs: Long)

/** The session's refs as rows: tracks read by id (in pieces), books one detail each. A ref that no longer resolves draws as itself. */
private suspend fun resolveRows(refs: List<String>): Map<String, RemoteRow> {
    val out = HashMap<String, RemoteRow>()
    val trackIds = refs.mapNotNull { r -> (r.toLongOrNull() ?: r.takeIf { it.startsWith("kouros:") }?.removePrefix("kouros:")?.toLongOrNull()) }.distinct()
    if (trackIds.isNotEmpty()) {
        for (t in KourosApi.tracksByIds(trackIds)) {
            val row = RemoteRow("kouros:${t.id}", t.title, t.byline(), t.id.takeIf { t.hasCover }, false, t.durationMs)
            out["kouros:${t.id}"] = row
            out["${t.id}"] = row
        }
    }
    for (r in refs.filter { it.startsWith("book:") }.distinct()) {
        val id = r.removePrefix("book:").toLongOrNull() ?: continue
        runCatching { KourosApi.book(id) }.getOrNull()?.let { d ->
            out[r] = RemoteRow(r, d.book.title, BookModels.byline(d.book), d.book.id.takeIf { d.book.hasCover }, true, BookLayout(d.files, d.chapters).totalMs)
        }
    }
    return out
}

/**
 * The output's queue, edited from here (the web's Queue.tsx, as a remote): tap a row to play
 * it there, × to take it out, drag a grip to move it. Each is a command (jump, remove,
 * reorder) in the session's own indices. A move is drawn at once and gives way to the output's
 * next report, which is the truth. Drawn as this phone's own queue is.
 */
@Composable
fun RemoteQueue() {
    val st by SessionLink.state.collectAsState()
    val s = st.session
    val items = s?.items ?: emptyList()
    var moved by remember(s?.rev) { mutableStateOf<List<String>?>(null) }
    val shown = moved ?: items
    val rows by produceState<Map<String, RemoteRow>>(emptyMap(), items.toSet()) {
        value = runCatching { resolveRows(items) }.getOrDefault(emptyMap())
    }
    val cursor = s?.cursor ?: -1
    val f = Jk.face
    Column(Modifier.fillMaxSize()) {
        val upNext = if (cursor < 0) shown.size else shown.size - cursor - 1
        Eyebrow(
            "On ${outputName(st)} · " + if (upNext > 0) "$upNext up next" else "nothing up next",
            Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp), color = f.accent,
        )
        if (shown.isEmpty()) {
            Hush("Its queue is empty.", Modifier.padding(24.dp))
            return@Column
        }
        ReorderList(
            items = shown,
            key = { i, r -> "$r:$i" },
            onMove = { from, to ->
                moved = Reorder.move(shown, from, to)
                send("reorder", SessionCore.Commands.reorder(from, to))
            },
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 8.dp),
        ) { i, ref, grip, lifted ->
            val row = rows[ref]
            TrackRow(
                title = row?.title ?: ref,
                subtitle = row?.subtitle,
                durationMs = row?.durationMs ?: 0L,
                playing = i == cursor && moved == null,
                showCover = true,
                coverId = row?.coverId,
                coverIsBook = row?.isBook == true,
                onClick = { send("jump", SessionCore.Commands.jump(i)) },
                modifier = Modifier
                    .then(if (lifted) Modifier.drawBehind { boxShadow(f.ink.copy(alpha = 0.22f), JkRadius.base, 14.dp, dy = 4.dp) } else Modifier)
                    .clip(RoundedCornerShape(JkRadius.base))
                    .background(if (lifted) f.paper else Color.Transparent)
                    .alpha(if (i < cursor && moved == null) 0.42f else 1f),
                start = {
                    Box(grip.width(34.dp).heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
                        Icon(Glyphs.Grip, contentDescription = "Reorder ${row?.title ?: ref}", tint = if (lifted) f.accent else f.faint, modifier = Modifier.size(18.dp))
                    }
                },
                end = {
                    IconButton(onClick = {
                        moved = shown.filterIndexed { j, _ -> j != i }
                        send("remove", SessionCore.Commands.remove(i))
                    }, modifier = Modifier.alpha(0.5f)) { Icon(Glyphs.Close, contentDescription = "Remove ${row?.title ?: ref} from the queue", tint = f.ink) }
                },
            )
        }
    }
}
