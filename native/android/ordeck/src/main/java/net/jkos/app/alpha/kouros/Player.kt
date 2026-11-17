package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.delay
import java.util.concurrent.Executor

/** What the UI shows of the player, as one immutable snapshot. */
data class NowPlaying(
    /** The track playing, or null while a book plays. */
    val trackId: Long?,
    /** The book playing ([trackId] is then null): its id, where this file starts, its chapters. */
    val book: BookInfo?,
    val rate: Float,
    val title: String,
    val artist: String,
    val album: String,
    val hasArtwork: Boolean,
    val isPlaying: Boolean,
    val durationMs: Long,
    val hasNext: Boolean,
    val hasPrevious: Boolean,
)

/** The cover to draw: the track's, or the book's (Cover's `book`), or none. */
val NowPlaying.coverId: Long? get() = if (!hasArtwork) null else trackId ?: book?.bookId

private val mainExecutor = Executor { Handler(Looper.getMainLooper()).post(it) }

/** A MediaController bound to PlaybackService for as long as the caller is composed. */
@Composable
fun rememberController(): MediaController? {
    val context: Context = LocalContext.current
    var controller by remember { mutableStateOf<MediaController?>(null) }
    DisposableEffect(Unit) {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({ controller = runCatching { future.get() }.getOrNull() }, mainExecutor)
        onDispose {
            controller = null
            MediaController.releaseFuture(future)
        }
    }
    return controller
}

private fun Player.snapshot(): NowPlaying? {
    val item = currentMediaItem ?: return null
    val md = item.mediaMetadata
    val ref = MediaRef.parse(item.mediaId) ?: return null
    return NowPlaying(
        trackId = (ref as? MediaRef.TrackRef)?.id,
        book = item.bookInfo(),
        rate = playbackParameters.speed,
        title = md.title?.toString() ?: "",
        artist = md.artist?.toString() ?: "",
        album = md.albumTitle?.toString() ?: "",
        hasArtwork = md.artworkUri != null,
        isPlaying = isPlaying,
        durationMs = duration.takeIf { it != C.TIME_UNSET } ?: 0L,
        hasNext = hasNextMediaItem(),
        hasPrevious = hasPreviousMediaItem() || currentPosition > 3000,
    )
}

/** The player's state, kept current by its own events. */
@Composable
fun rememberNowPlaying(controller: MediaController?): NowPlaying? {
    var now by remember(controller) { mutableStateOf(controller?.snapshot()) }
    DisposableEffect(controller) {
        val c = controller ?: return@DisposableEffect onDispose { }
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                now = player.snapshot()
            }
        }
        c.addListener(listener)
        now = c.snapshot()
        onDispose { c.removeListener(listener) }
    }
    return now
}

/** The playback position, polled twice a second while playing (the player has no event for it). */
@Composable
fun rememberPosition(controller: MediaController?, playing: Boolean): Long {
    var position by remember(controller) { mutableLongStateOf(controller?.currentPosition ?: 0L) }
    LaunchedEffect(controller, playing) {
        val c = controller ?: return@LaunchedEffect
        position = c.currentPosition
        while (playing) {
            delay(500)
            position = c.currentPosition
        }
    }
    return position
}

/** One row of the queue, as the player holds it: a track, or one file of a book. */
data class QueueEntry(
    val mediaId: String,
    /** The cover's id: the track's, or the book's when [isBook]. */
    val coverId: Long,
    val isBook: Boolean,
    val title: String,
    val artist: String,
    val hasArtwork: Boolean,
    val durationMs: Long,
)

/** The queue in the player's own order, and which entry is current (-1: none). */
data class QueueState(val entries: List<QueueEntry>, val current: Int) {
    val upNext: Int get() = if (current < 0) entries.size else entries.size - current - 1
    /** What is left to hear, from the current entry on. */
    val remainingMs: Long get() = entries.drop(current.coerceAtLeast(0)).sumOf { it.durationMs }

    companion object { val Empty = QueueState(emptyList(), -1) }
}

private fun Player.queueSnapshot(): QueueState {
    val entries = (0 until mediaItemCount).mapNotNull { i ->
        val item = getMediaItemAt(i)
        val md = item.mediaMetadata
        val ref = MediaRef.parse(item.mediaId) ?: return@mapNotNull null
        QueueEntry(
            mediaId = item.mediaId,
            coverId = when (ref) { is MediaRef.TrackRef -> ref.id; is MediaRef.BookFileRef -> ref.bookId },
            isBook = ref is MediaRef.BookFileRef,
            title = md.title?.toString() ?: "",
            artist = listOfNotNull((md.artist ?: md.albumArtist)?.toString(), md.albumTitle?.toString().takeIf { ref is MediaRef.BookFileRef })
                .filter { it.isNotEmpty() }.joinToString(" · "),
            hasArtwork = md.artworkUri != null,
            durationMs = md.extras?.getLong(EXTRA_DURATION_MS) ?: 0L,
        )
    }
    return QueueState(entries, if (entries.isEmpty()) -1 else currentMediaItemIndex)
}

/** The queue, kept current by the player's own events. */
@Composable
fun rememberQueue(controller: MediaController?): QueueState {
    var queue by remember(controller) { mutableStateOf(controller?.queueSnapshot() ?: QueueState.Empty) }
    DisposableEffect(controller) {
        val c = controller ?: return@DisposableEffect onDispose { }
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION)) {
                    queue = player.queueSnapshot()
                }
            }
        }
        c.addListener(listener)
        queue = c.queueSnapshot()
        onDispose { c.removeListener(listener) }
    }
    return queue
}

/**
 * Put [tracks] in the queue without interrupting it: right after the current track ([next]),
 * or at the end. With nothing queued, they simply play.
 */
fun MediaController.enqueue(tracks: List<Track>, next: Boolean, context: String?) {
    if (tracks.isEmpty()) return
    if (mediaItemCount == 0) return playQueue(tracks, 0, context)
    val items = tracks.map { it.toMediaItem(context) }
    if (next) addMediaItems(currentMediaItemIndex + 1, items) else addMediaItems(items)
}

/** Play a station around [seed]: the seed first, then the station. */
fun MediaController.playStation(seed: Track, station: List<Track>) {
    playQueue(listOf(seed) + station.filter { it.id != seed.id }, 0, PlayContext.station(seed.id))
}

/**
 * Play [book] from [globalMs] (a position in the whole book): the queue becomes its files, the
 * player starts in the one that position falls in, and the device's book rate applies.
 */
fun MediaController.playBook(book: BookDetail, globalMs: Long, rate: Float) {
    val items = book.toMediaItems()
    if (items.isEmpty()) return
    val (pos, offset) = BookLayout(book.files, book.chapters).locate(globalMs)
    setMediaItems(items, pos, offset)
    setPlaybackSpeed(rate)
    prepare()
    play()
}

/** Seek to [globalMs] in the book now playing, across its files. */
fun MediaController.seekInBook(book: BookInfo, globalMs: Long) {
    val target = globalMs.coerceIn(0L, book.totalMs)
    // The book's files are queue entries; find the one [target] falls in by their offsets.
    var best = -1
    var bestOffset = -1L
    for (i in 0 until mediaItemCount) {
        val info = getMediaItemAt(i).bookInfo() ?: continue
        if (info.bookId != book.bookId) continue
        if (info.offsetMs <= target && info.offsetMs >= bestOffset) { best = i; bestOffset = info.offsetMs }
    }
    if (best >= 0) seekTo(best, target - bestOffset)
}

/** Replace the queue with [tracks] and play from [start]. */
fun MediaController.playQueue(tracks: List<Track>, start: Int, context: String?) {
    if (tracks.isEmpty()) return
    setMediaItems(tracks.map { it.toMediaItem(context) }, start.coerceIn(0, tracks.lastIndex), 0L)
    prepare()
    play()
}

/** Keep the current track playing and make a station around it the rest of the queue. */
fun MediaController.continueAsStation(seedTrackId: Long, station: List<Track>) {
    val rest = station.filter { it.id != seedTrackId }
    if (rest.isEmpty()) return
    val idx = currentMediaItemIndex
    if (idx + 1 < mediaItemCount) removeMediaItems(idx + 1, mediaItemCount)
    if (idx > 0) removeMediaItems(0, idx)
    addMediaItems(rest.map { it.toMediaItem(PlayContext.station(seedTrackId)) })
    if (!isPlaying) play()
}

fun formatTime(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}
