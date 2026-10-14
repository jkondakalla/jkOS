package net.jkos.kouros

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.Executors

/** The MediaMetadata extra a queued track carries its play context in (PlayContext). */
const val EXTRA_CONTEXT = "net.jkos.kouros.context"

/** A track as a queue entry. The URI is rebuilt by the service from the id (onAddMediaItems). */
fun Track.toMediaItem(context: String?): MediaItem = MediaItem.Builder()
    .setMediaId(id.toString())
    .setUri(Api.streamUrl(id))
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setAlbumArtist(albumArtist)
            .setArtworkUri(if (hasCover) Uri.parse(Api.coverUrl(id)) else null)
            .setExtras(Bundle().apply { putString(EXTRA_CONTEXT, context) })
            .build(),
    )
    .build()

/**
 * Playback: ExoPlayer inside a MediaSessionService, so it keeps going with the screen off and
 * the lock screen, the notification, Bluetooth and the system's media controls all drive it.
 *
 *  · Music audio attributes with audio focus handled (a call or another player pauses it),
 *    pause when the headphones are pulled (becoming noisy), and the network wake mode so a
 *    stream doesn't stall when the screen goes off.
 *  · Every HTTP request — the stream's range requests AND the artwork the notification and
 *    lock screen draw — goes through one ResolvingDataSource that adds `Authorization: Bearer`
 *    per request, and only to URLs under apiBase (Api.authorized).
 *  · The history ledger is recorded HERE (HistoryRecorder), from the player's own events, so a
 *    listen counts whether the app's UI is open or not.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private var recorder: HistoryRecorder? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("KourOS-Alpha")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setAllowCrossProtocolRedirects(false)
        val authed = ResolvingDataSource.Factory(http) { spec -> withBearer(spec) }

        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(authed))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        val rec = HistoryRecorder(player)
        player.addListener(rec)
        recorder = rec
        current = rec

        val artwork = DataSourceBitmapLoader(MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()), authed)
        session = MediaSession.Builder(this, player)
            .setCallback(QueueCallback())
            .setBitmapLoader(artwork)
            .setSessionActivity(
                PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()

        // Signed out (here, or by the server): stop, and forget the queue — its URLs are ours.
        scope.launch {
            Auth.state.collect { s ->
                if (s is AuthState.SignedOut) {
                    rec.flush()
                    player.stop()
                    player.clearMediaItems()
                }
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiped away from recents while paused or empty: nothing to keep a service up for. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        recorder?.flush()
        if (current === recorder) current = null
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Queue entries arrive from a controller (this app's UI, or the system's) over IPC. Each is
     * rebuilt from its id here — the stream URL is ours to decide, never the controller's — and
     * anything that is not a KourOS track id is dropped.
     */
    private inner class QueueCallback : MediaSession.Callback {
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> {
            val resolved = mediaItems.mapNotNull { item ->
                val id = item.mediaId.toLongOrNull() ?: return@mapNotNull null
                item.buildUpon().setUri(Api.streamUrl(id)).build()
            }
            return Futures.immediateFuture(resolved.toMutableList())
        }
    }

    companion object {
        private const val TAG = "KourOS"

        /** The running service's recorder; touched on the main thread only. */
        private var current: HistoryRecorder? = null

        /** The app went to the background: bank the listen so far (see ListenLedger). */
        fun checkpoint() {
            current?.checkpoint()
        }

        /** Runs on a loader thread, once per request — so each range request gets a fresh token. */
        private fun withBearer(spec: DataSpec): DataSpec {
            if (!Api.authorized(spec.uri.toString())) return spec
            val token = try {
                runBlocking { Auth.accessToken() }
            } catch (e: Exception) {
                Log.w(TAG, "no token for a media request: ${e.message}")
                return spec
            }
            return spec.withAdditionalHeaders(mapOf("Authorization" to "Bearer $token"))
        }
    }
}

/**
 * Turns the player's events into history rows (ListenLedger) and posts them. Mirrors the web
 * player: a stretch opens when a track starts playing and closes on pause, on a track change
 * (completed when the player moved on by itself), or at a background checkpoint.
 */
@OptIn(UnstableApi::class)
internal class HistoryRecorder(private val player: Player) : Player.Listener {
    private val ledger = ListenLedger { System.currentTimeMillis() }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) open() else close(forced = false)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // The open stretch belongs to the PREVIOUS item. An automatic transition is its end.
        close(forced = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        if (player.isPlaying) open()
    }

    fun checkpoint() {
        close(forced = false)
        if (player.isPlaying) open()
    }

    fun flush() = close(forced = false)

    private fun open() {
        val item = player.currentMediaItem ?: return
        val id = item.mediaId.toLongOrNull() ?: return
        ledger.start(id, item.mediaMetadata.extras?.getString(EXTRA_CONTEXT))
    }

    private fun close(forced: Boolean) {
        val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        val row = ledger.close(player.currentPosition, duration, forced) ?: return
        KourosApp.scope.launch {
            try {
                Api.recordListen(row)
            } catch (e: Exception) {
                Log.w("KourOS", "failed to record a listen: ${e.message}")
            }
        }
    }
}
