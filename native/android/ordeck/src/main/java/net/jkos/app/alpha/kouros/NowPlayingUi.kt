package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.*

// Now Playing and the mini player (the web's kouros-now page and MiniPlayer.tsx). ONE face draws
// both this phone's playback and, while the phone is a remote, another device's: the face is
// plain values (PlayerFace) and every verb goes through PlayerControls, which either drives the
// player here or sends the session a command. So the two can't drift apart, and the renders draw
// the real screens from sample values.

/** A sleep timer as the face shows it: its mode, and for a timed one what's left. */
data class SleepView(val mode: String = SleepState.OFF, val remainingMs: Long? = null) {
    val on get() = mode != SleepState.OFF
    val label get() = when {
        mode == SleepState.CHAPTER -> "End of chapter"
        on -> formatTime(remainingMs ?: 0)
        else -> "Sleep"
    }
}

/** What the player's face shows, local or remote. A book's times are the whole book's. */
data class PlayerFace(
    val title: String,
    val artist: String,
    val album: String,
    /** The album's artist: the album page is found by it. */
    val albumArtist: String,
    val coverId: Long?,
    val trackId: Long?,
    /** The book playing (null: a track): its id, chapters and length. */
    val book: BookInfo?,
    val playing: Boolean,
    val buffering: Boolean,
    val durationMs: Long,
    val hasNext: Boolean,
    val hasPrevious: Boolean,
    val shuffle: Boolean,
    val canShuffle: Boolean,
    /** Player.REPEAT_MODE_*. */
    val repeat: Int,
    /** "3 of 14" for a track; a book shows its chapter instead. */
    val place: String,
    val upNext: QueueEntry?,
    val rate: Float,
    val sleep: SleepView,
    val error: String?,
    /** The other device's name while this phone is its remote; null when this phone plays. */
    val output: String?,
)

/** Every verb of the face. Local: the player here. Remote: a command to the session's output. */
interface PlayerControls {
    fun toggle()
    /** For a book, a position in the whole book. */
    fun seek(ms: Long)
    fun next()
    fun previous()
    /** A book's ±30 s. */
    fun skip(deltaMs: Long)
    /** A book's chapter on or back. */
    fun chapter(next: Boolean)
    fun shuffle(on: Boolean)
    fun repeat(mode: Int)
    /** A book's rate, one preset on. */
    fun rate()
    fun sleep(mode: String)
    fun retry()
    /** Keep this track playing and make a station around it the rest of the queue. A note for the listener. */
    suspend fun station(seedTrackId: Long): String
}

/** Draws a face without a player (the renders). */
object NoControls : PlayerControls {
    override fun toggle() {}
    override fun seek(ms: Long) {}
    override fun next() {}
    override fun previous() {}
    override fun skip(deltaMs: Long) {}
    override fun chapter(next: Boolean) {}
    override fun shuffle(on: Boolean) {}
    override fun repeat(mode: Int) {}
    override fun rate() {}
    override fun sleep(mode: String) {}
    override fun retry() {}
    override suspend fun station(seedTrackId: Long) = ""
}

/** The player here, through its MediaController. Reads the player's live state at each call. */
class LocalControls(private val c: MediaController) : PlayerControls {
    private fun book() = c.currentMediaItem?.bookInfo()
    private fun global(b: BookInfo) = b.offsetMs + c.currentPosition

    override fun toggle() { if (c.isPlaying) c.pause() else { if (c.playerError != null) c.prepare(); c.play() } }
    override fun seek(ms: Long) { val b = book(); if (b != null) c.seekBook(b, ms) else c.seekTo(ms.coerceAtLeast(0)) }
    // Through the session's player, so a book's next is its next chapter here exactly as on a headset.
    override fun next() { c.seekToNext() }
    override fun previous() { c.seekToPrevious() }
    override fun skip(deltaMs: Long) { book()?.let { b -> c.seekBook(b, global(b) + deltaMs) } ?: c.seekTo((c.currentPosition + deltaMs).coerceAtLeast(0)) }
    override fun chapter(next: Boolean) { book()?.let { c.chapterStep(it, next) } }
    override fun shuffle(on: Boolean) { c.shuffleModeEnabled = on }
    override fun repeat(mode: Int) { c.repeatMode = mode }
    override fun rate() { val r = Rates.next(c.playbackParameters.speed); BookRate.set(r); c.setPlaybackSpeed(r) }
    override fun sleep(mode: String) { val b = book(); SleepTimer.set(mode, System.currentTimeMillis(), b?.layoutChapterEnd(global(b))) }
    override fun retry() { c.prepare(); c.play() }
    override suspend fun station(seedTrackId: Long): String = when (val r = attempt { KourosApi.radio(seedTrackId) }) {
        is Load.Ready -> { c.continueAsStation(seedTrackId, r.value); if (r.value.isEmpty()) "No station for this track yet." else "Station: ${r.value.size} tracks queued." }
        is Load.Failed -> r.message
        Load.Loading -> ""
    }
}

/** This phone's player as a face. */
fun localFace(now: NowPlaying, sleep: SleepState, nowMs: Long): PlayerFace = PlayerFace(
    title = now.title,
    artist = now.artist,
    album = now.album.takeIf { now.book == null } ?: "",
    albumArtist = now.albumArtist,
    coverId = now.coverId,
    trackId = now.trackId,
    book = now.book,
    playing = now.isPlaying,
    buffering = now.buffering,
    durationMs = now.book?.totalMs ?: now.durationMs,
    hasNext = now.hasNext,
    hasPrevious = now.hasPrevious,
    shuffle = now.shuffle,
    canShuffle = now.canShuffle,
    repeat = now.repeat,
    place = now.place,
    upNext = now.upNext,
    rate = now.rate,
    sleep = SleepView(sleep.mode, sleep.remainingMs(nowMs)),
    error = now.error,
    output = null,
)

/** The phone's own player, ticking: the face, where it is, and its controls; null while nothing is queued. */
@Composable
private fun rememberLocal(controller: MediaController?, now: NowPlaying?): Triple<PlayerFace, Long, PlayerControls>? {
    val sleep by SleepTimer.state.collectAsState()
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sleep) { while (sleep.deadlineMs != null) { clock = System.currentTimeMillis(); delay(1000) } }
    val position = rememberPosition(controller, now?.isPlaying == true)
    if (now == null || controller == null) return null
    val controls = remember(controller) { LocalControls(controller) }
    return Triple(localFace(now, sleep, clock), (now.book?.offsetMs ?: 0L) + position, controls)
}

// ── Now Playing ────────────────────────────────────────────────────────────────

@Composable
fun NowPlayingScreen(controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var devices by remember { mutableStateOf(false) }
    if (devices) DevicesDialog { devices = false }
    val remote = rememberIsRemote()
    val playing = if (remote) rememberRemote() else rememberLocal(controller, now)
    Column(Modifier.fillMaxSize()) {
        if (playing == null) {
            PlayerTop(null, onBack, onQueue = { push(KourosScreen.QueuePage) }, onBook = null)
            Hush(if (remote) "Waiting for the other device…" else "Nothing is playing.", Modifier.padding(24.dp))
            return@Column
        }
        val (face, position, controls) = playing
        PlayerTop(
            face, onBack,
            onQueue = { push(KourosScreen.QueuePage) },
            onBook = face.book?.let { b -> { push(KourosScreen.BookPage(b.bookId, face.title)) } },
        )
        if (face.book != null) {
            BookFace(face, face.book, position, controls, onDevices = { devices = true })
        } else {
            TrackFace(
                face, position, controls,
                onDevices = { devices = true },
                onQueue = { push(KourosScreen.QueuePage) },
                onArtist = face.albumArtist.takeIf { it.isNotEmpty() }?.let { a -> { push(KourosScreen.ArtistPage(a)) } },
                onAlbum = face.album.takeIf { it.isNotEmpty() && face.albumArtist.isNotEmpty() }?.let { al -> { push(KourosScreen.AlbumPage(al, face.albumArtist)) } },
            )
        }
    }
}

/**
 * The web's top row: close (it collapses the page, like the back gesture), where this is — the
 * place in the queue, or which device plays it — and the queue, or for a book "open this book".
 */
@Composable
internal fun PlayerTop(face: PlayerFace?, onBack: () -> Unit, onQueue: () -> Unit, onBook: (() -> Unit)?) {
    val f = Jk.face
    Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Glyphs.ChevronDown, contentDescription = "Close now playing", tint = f.muted) }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            val label = when {
                face == null -> ""
                face.output != null -> "${if (face.playing) "Playing" else "Paused"} on ${face.output}"
                face.book != null -> "Audiobook"
                else -> face.place
            }
            Eyebrow(label, color = if (face?.output != null) f.accent else f.faint, size = 10.sp)
        }
        if (onBook != null) IconButton(onClick = onBook) { Icon(Glyphs.Book, contentDescription = "Open this book", tint = f.muted) }
        else IconButton(onClick = onQueue) { Icon(Glyphs.Queue, contentDescription = "Open queue", tint = f.muted) }
    }
}

/**
 * A track's face (the web's kouros-now): the sleeve, the title in Fraunces over the artist and the
 * album (each opens its page), the fader with mono times, the transport with the lit knob at its
 * centre between shuffle and repeat, the device picker and "start a station", and what's up next.
 */
@Composable
internal fun TrackFace(
    face: PlayerFace, position: Long, controls: PlayerControls,
    onDevices: () -> Unit, onQueue: () -> Unit, onArtist: (() -> Unit)?, onAlbum: (() -> Unit)?,
    note: String? = null,
) {
    val f = Jk.face
    val scope = rememberCoroutineScope()
    var stationNote by remember(face.trackId) { mutableStateOf(note) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Gap(4)
        Cover(face.coverId, 320.dp, Modifier.widthIn(max = 380.dp).fillMaxWidth().aspectRatio(1f), title = face.title)
        Gap(22)
        Text(face.title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Gap(4)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val link = TextStyle(fontFamily = JkFonts.Sans, fontSize = 15.sp, color = f.muted)
            if (face.artist.isNotEmpty()) {
                Text(face.artist, Modifier.weight(1f, fill = false).clip(RoundedCornerShape(4.dp)).then(if (onArtist != null) Modifier.clickable(onClick = onArtist) else Modifier).padding(horizontal = 2.dp),
                    style = link, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (face.artist.isNotEmpty() && face.album.isNotEmpty()) Text(" · ", style = link)
            if (face.album.isNotEmpty()) {
                Text(face.album, Modifier.weight(1f, fill = false).clip(RoundedCornerShape(4.dp)).then(if (onAlbum != null) Modifier.clickable(onClick = onAlbum) else Modifier).padding(horizontal = 2.dp),
                    style = link.copy(fontStyle = FontStyle.Italic, fontFamily = JkFonts.Serif), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Gap(16)
        Scrubber(position, face.durationMs, controls::seek, remaining = false)
        Gap(6)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            ModeButton(Glyphs.Shuffle, if (face.shuffle) "Shuffle is on" else "Shuffle", on = face.shuffle, enabled = face.canShuffle) { controls.shuffle(!face.shuffle) }
            TransportButton(Glyphs.Previous, "Previous track", enabled = face.hasPrevious, size = 56.dp, onClick = controls::previous)
            PlayKnob(face, controls, 72.dp)
            TransportButton(Glyphs.Next, "Next track", enabled = face.hasNext, size = 56.dp, onClick = controls::next)
            ModeButton(
                if (face.repeat == Player.REPEAT_MODE_ONE) Glyphs.RepeatOne else Glyphs.Repeat,
                when (face.repeat) { Player.REPEAT_MODE_ALL -> "Repeat all"; Player.REPEAT_MODE_ONE -> "Repeat this track"; else -> "Repeat" },
                on = face.repeat != Player.REPEAT_MODE_OFF,
            ) { controls.repeat(PlayPolicy.nextRepeat(face.repeat)) }
        }
        Gap(12)
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onDevices) { Icon(Glyphs.Devices, contentDescription = "Choose where to listen", tint = if (face.output != null) f.accent else f.muted, modifier = Modifier.size(22.dp)) }
            Row(
                Modifier.clip(RoundedCornerShape(JkRadius.sm)).clickable(enabled = face.trackId != null) {
                    val seed = face.trackId ?: return@clickable
                    stationNote = "Building a station…"
                    scope.launch { stationNote = controls.station(seed).ifEmpty { null } }
                }.padding(horizontal = 10.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Glyphs.Radio, contentDescription = null, modifier = Modifier.size(18.dp), tint = f.muted)
                Spacer(Modifier.width(10.dp))
                Text("START A STATION FROM THIS", style = MaterialTheme.typography.labelMedium.copy(color = f.ink, fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium))
            }
        }
        stationNote?.let { Hush(it) }
        face.error?.let { PlayerError(it, controls) }
        face.upNext?.let { UpNext(it, onQueue) }
        Gap(16)
    }
}

/** The knob: pause or play, a spinner in it while the stream catches up. */
@Composable
private fun PlayKnob(face: PlayerFace, controls: PlayerControls, size: Dp) {
    Knob(controls::toggle, if (face.playing) "Pause" else "Play", size = size) {
        // A render holds still (LocalStill): the endless spinner would never let it settle.
        if (face.buffering && LocalStill.current) CircularProgressIndicator(progress = { 0.3f }, modifier = Modifier.size(size * 0.36f), strokeWidth = 2.5.dp, color = Color(0xFF2A1C0E))
        else if (face.buffering) CircularProgressIndicator(Modifier.size(size * 0.36f), strokeWidth = 2.5.dp, color = Color(0xFF2A1C0E))
        else Icon(if (face.playing) Glyphs.Pause else Glyphs.Play, contentDescription = null, modifier = Modifier.size(size * 0.4f))
    }
}

/** Shuffle or repeat: the glyph in the accent and lit while on, faint while off (the web's kr-ghost). */
@Composable
private fun ModeButton(glyph: ImageVector, label: String, on: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val f = Jk.face
    Box(
        Modifier.size(48.dp).clip(RoundedCornerShape(50)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, contentDescription = null, modifier = Modifier.size(22.dp), tint = when { !enabled -> f.ghost; on -> f.accent; else -> f.faint })
        if (on) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp).size(4.dp).clip(RoundedCornerShape(50)).background(f.accent))
    }
}

@Composable
internal fun TransportButton(glyph: ImageVector, label: String, enabled: Boolean = true, size: Dp = 48.dp, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(size)) {
        Icon(glyph, contentDescription = label, modifier = Modifier.size(size * 0.5f), tint = if (enabled) Jk.face.ink else Jk.face.ghost)
    }
}

/** "UP NEXT  Blue Light  Mazzy Star": one line, and a tap opens the queue. */
@Composable
private fun UpNext(next: QueueEntry, onQueue: () -> Unit) {
    val f = Jk.face
    Row(
        Modifier.fillMaxWidth().padding(top = 14.dp).clip(RoundedCornerShape(JkRadius.sm)).clickable(onClick = onQueue).padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Eyebrow("Up next", size = 9.sp)
        Spacer(Modifier.width(10.dp))
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(next.title, Modifier.weight(1f, fill = false), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.sp, color = f.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (next.artist.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Text(next.artist, Modifier.weight(1f, fill = false), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 12.sp, color = f.faint), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(Glyphs.Chevron, contentDescription = null, tint = f.faint, modifier = Modifier.size(16.dp))
    }
}

/** Playback stopped, and why, with the one thing to do about it. */
@Composable
private fun PlayerError(message: String, controls: PlayerControls) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(message, Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = Jk.face.secondary))
        TButton(onClick = controls::retry) { Text("Try again") }
    }
}

/**
 * The fader with mono times either side: elapsed, and the length (a track) or what's left (a
 * book, [remaining]). A book's chapters are ticks along it ([points], positions in ms).
 */
@Composable
internal fun Scrubber(position: Long, durationMs: Long, onSeek: (Long) -> Unit, remaining: Boolean, points: List<Long> = emptyList()) {
    val f = Jk.face
    var dragging by remember { mutableStateOf<Float?>(null) }
    val total = durationMs.coerceAtLeast(1L)
    val shown = dragging?.let { (it * total).toLong() } ?: position
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Eyebrow(formatTime(shown), Modifier.widthIn(min = 44.dp), size = 9.sp)
        Box(Modifier.weight(1f).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
            if (points.isNotEmpty() && durationMs > 0) {
                // Under the fader: a short hairline at each chapter's start, inset by half the cap.
                Canvas(Modifier.fillMaxWidth().height(14.dp).padding(horizontal = 6.dp)) {
                    for (p in points) {
                        if (p <= 0 || p >= durationMs) continue
                        val x = size.width * (p.toFloat() / durationMs)
                        drawLine(f.faint.copy(alpha = 0.55f), Offset(x, 0f), Offset(x, size.height), strokeWidth = 1.dp.toPx())
                    }
                }
            }
            JkSlider(
                value = dragging ?: (position.toFloat() / total).coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = { dragging?.let { onSeek((it * total).toLong()) }; dragging = null },
                enabled = durationMs > 0,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Eyebrow(if (remaining) "−" + formatTime(durationMs - shown) else formatTime(durationMs), Modifier.widthIn(min = 44.dp), size = 9.sp)
    }
}

// ── a book ─────────────────────────────────────────────────────────────────────

/**
 * A book's face (the web's audiobook kouros-now): the cover, the title over the author, the
 * chapter it's in, the whole book on one fader with its chapters as ticks and what's left of it,
 * the transport (chapter back, −30, the knob, +30, chapter on), the rate, the sleep timer and the
 * device picker, and the bookmarks of this book.
 */
@Composable
internal fun BookFace(face: PlayerFace, book: BookInfo, position: Long, controls: PlayerControls, onDevices: () -> Unit, preBookmarks: List<Bookmark>? = null) {
    val f = Jk.face
    val layout = remember(book) { BookLayout(listOf(BookFile(0, book.totalMs / 1000.0)), book.chapters) }
    val chapterIndex = layout.chapterAt(position)
    val chapter = chapterIndex.takeIf { it >= 0 }?.let { book.chapters[it] }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Gap(4)
        Cover(face.coverId, 280.dp, Modifier.widthIn(max = 320.dp).fillMaxWidth(0.78f).aspectRatio(1f), book = true, title = face.title)
        Gap(20)
        Text(face.title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        if (face.artist.isNotEmpty()) {
            Text(face.artist, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.sp, color = f.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Gap(8)
        if (chapter != null) {
            Eyebrow("Chapter ${chapterIndex + 1} of ${book.chapters.size}", color = f.accent)
            Text(chapter.title, style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 15.sp, color = f.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Gap(12)
        Scrubber(position, book.totalMs, controls::seek, remaining = true, points = book.chapters.map { (it.startSec * 1000).toLong() })
        Eyebrow("${formatHM(book.totalMs - position)} left in the book", Modifier.padding(top = 2.dp), size = 9.sp)
        Gap(10)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            TransportButton(Glyphs.Previous, "Previous chapter", enabled = layout.previousChapterStart(position) != null || position > 0, size = 48.dp) { controls.chapter(next = false) }
            SkipButton("−30", "Back 30 seconds") { controls.skip(-PlaybackService.SKIP_MS) }
            PlayKnob(face, controls, 72.dp)
            SkipButton("+30", "Forward 30 seconds") { controls.skip(PlaybackService.SKIP_MS) }
            TransportButton(Glyphs.Next, "Next chapter", enabled = layout.nextChapterStart(position) != null, size = 48.dp) { controls.chapter(next = true) }
        }
        Gap(16)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TButton(onClick = controls::rate) { Seg(Rates.label(face.rate), size = 14.sp) }
            SleepButton(face.sleep, chapterKnown = chapter != null, onPick = controls::sleep)
            TButton(onClick = onDevices) { Icon(Glyphs.Devices, contentDescription = "Choose where to listen", modifier = Modifier.size(18.dp), tint = if (face.output != null) f.accent else f.muted) }
        }
        face.error?.let { PlayerError(it, controls) }
        Gap(18)
        Bookmarks(book.bookId, position, onJump = controls::seek, pre = preBookmarks)
        Gap(16)
    }
}

/** ±30 s: a ring with its seconds in mono, the size of the transport's other buttons. */
@Composable
private fun SkipButton(text: String, label: String, onClick: () -> Unit) {
    val f = Jk.face
    Box(
        Modifier.size(52.dp).clip(RoundedCornerShape(50)).border(1.5.dp, f.ink.copy(alpha = 0.5f), RoundedCornerShape(50))
            .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(text, style = TextStyle(fontFamily = JkFonts.Mono, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = f.ink)) }
}

/** The sleep timer: Off, 15–60 minutes, or the end of the chapter (the web's menu), counting down while set. */
@Composable
private fun SleepButton(sleep: SleepView, chapterKnown: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val f = Jk.face
    Box {
        TButton(onClick = { open = true }) {
            Icon(Glyphs.Moon, contentDescription = null, modifier = Modifier.size(16.dp), tint = if (sleep.on) f.accent else f.muted)
            Text(sleep.label, style = if (sleep.on) TextStyle(fontFamily = JkFonts.Mono, fontSize = 13.sp, color = f.accent) else MaterialTheme.typography.labelLarge)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            fun pick(mode: String) { onPick(mode); open = false }
            DropdownMenuItem(text = { Text("Off") }, onClick = { pick(SleepState.OFF) })
            for (m in SleepState.TIMED) DropdownMenuItem(text = { Text("$m min") }, onClick = { pick(m) })
            DropdownMenuItem(text = { Text("End of chapter") }, enabled = chapterKnown, onClick = { pick(SleepState.CHAPTER) })
        }
    }
}

/**
 * This book's bookmarks, under the player as on the web: "+ add a bookmark here", then each one
 * — tap to go there, × to delete. They are the listener's on every device.
 */
@Composable
private fun Bookmarks(bookId: Long, position: Long, onJump: (Long) -> Unit, pre: List<Bookmark>? = null) {
    val f = Jk.face
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember(bookId) { mutableStateOf<Load<List<Bookmark>>>(pre?.let { Load.Ready(it) } ?: Load.Loading) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(bookId, attemptNo) {
        if (pre != null && attemptNo == 0) return@LaunchedEffect
        state = attempt { KourosApi.bookmarks(bookId) }
    }
    fun write(block: suspend () -> Unit) {
        note = null
        scope.launch {
            when (val r = attempt { block() }) {
                is Load.Failed -> note = "Couldn't save: ${r.message}"
                else -> attemptNo++
            }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Lab("Bookmarks", Modifier.weight(1f))
            Row(
                Modifier.clip(RoundedCornerShape(JkRadius.sm)).clickable { val at = position; write { KourosApi.addBookmark(bookId, at, null) } }.padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Glyphs.Bookmark, contentDescription = null, modifier = Modifier.size(15.dp), tint = f.accent)
                Spacer(Modifier.width(6.dp))
                Text("ADD A BOOKMARK HERE", style = MaterialTheme.typography.labelMedium.copy(color = f.accent, fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, letterSpacing = 0.08.em))
            }
        }
        note?.let { Text(it, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = f.secondary)) }
        when (val s = state) {
            Load.Loading -> Eyebrow("Loading", Modifier.padding(vertical = 8.dp))
            is Load.Failed -> TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry: ${s.message}") }
            is Load.Ready -> if (s.value.isEmpty()) {
                Hush("No bookmarks yet.", Modifier.padding(vertical = 6.dp))
            } else {
                for (bm in s.value) {
                    val ms = (bm.positionSec * 1000).toLong()
                    val shape = RoundedCornerShape(JkRadius.base)
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(shape).background(f.paper2).border(1.dp, f.line, shape)
                            .clickable { onJump(ms) }.heightIn(min = 46.dp).padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(formatTime(ms), Modifier.width(72.dp), style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 12.5.sp, color = f.faint))
                        Text(bm.title ?: "Bookmark", Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.sp, color = f.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        IconButton(onClick = { write { KourosApi.deleteBookmark(bm.id) } }) {
                            Icon(Glyphs.Close, contentDescription = "Delete the bookmark at ${formatTime(ms)}", tint = f.faint, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

// ── the mini player ────────────────────────────────────────────────────────────

/** The bar above the tabs for this phone's player. */
@Composable
fun MiniPlayer(now: NowPlaying, controller: MediaController?, open: () -> Unit) {
    val local = rememberLocal(controller, now)
    if (local != null) MiniBar(local.first, local.second, local.third, open)
    else MiniBar(localFace(now, SleepState(), 0L), 0L, NoControls, open)
}

/** The bar while this phone is a remote: the output's item, on its clock. */
@Composable
fun RemoteMiniPlayer(open: () -> Unit) {
    val remote = rememberRemote() ?: return
    MiniBar(remote.first, remote.second, remote.third, open)
}

/**
 * The web's mini bar: a sheet with the sleeve, the title in Fraunces over the artist (a book: the
 * author and the chapter; another device: where it plays), the knob, next (a book: the next
 * chapter), and the progress as the bar's own bottom edge — a scrubber is one tap away.
 */
@Composable
fun MiniBar(face: PlayerFace, position: Long, controls: PlayerControls, open: () -> Unit) {
    val f = Jk.face
    val book = face.book
    val chapter = book?.chapters?.firstOrNull { position / 1000.0 >= it.startSec && position / 1000.0 < it.endSec }
    val sub = when {
        face.output != null -> "On ${face.output} · ${face.artist}"
        book != null -> listOfNotNull(face.artist.takeIf { it.isNotEmpty() }, chapter?.title).joinToString(" · ")
        else -> face.artist
    }
    val progress = if (face.durationMs > 0) (position.toFloat() / face.durationMs).coerceIn(0f, 1f) else 0f
    Sheet(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), padding = PaddingValues(0.dp)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(face.coverId, 44.dp, Modifier.size(44.dp), book = book != null, title = face.title)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(face.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                Text(
                    face.error ?: sub, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall, color = if (face.error != null) f.secondary else if (face.output != null) f.accent else f.muted,
                )
            }
            PlayKnob(face, controls, 40.dp)
            if (book != null) TransportButton(Glyphs.Next, "Next chapter", enabled = chapter != null && chapter != book.chapters.lastOrNull()) { controls.chapter(next = true) }
            else TransportButton(Glyphs.Next, "Next track", enabled = face.hasNext, onClick = controls::next)
        }
        Box(Modifier.fillMaxWidth().height(2.dp).background(f.line.copy(alpha = 0.5f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(f.accent))
        }
    }
}
