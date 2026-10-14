package net.jkos.kouros

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
    val trackId: Long,
    val title: String,
    val artist: String,
    val album: String,
    val hasArtwork: Boolean,
    val isPlaying: Boolean,
    val durationMs: Long,
    val hasNext: Boolean,
    val hasPrevious: Boolean,
)

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
    return NowPlaying(
        trackId = item.mediaId.toLongOrNull() ?: return null,
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
