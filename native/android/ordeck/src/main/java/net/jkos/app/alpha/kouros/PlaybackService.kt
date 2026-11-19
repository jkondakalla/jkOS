package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

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
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.Executors

/** The MediaMetadata extra a queued track carries its play context in (PlayContext). */
const val EXTRA_CONTEXT = "net.jkos.app.alpha.kouros.context"

/** The MediaMetadata extra a queued track carries its catalog duration in, so the queue can
 *  show every row's length before the player has opened it. */
const val EXTRA_DURATION_MS = "net.jkos.app.alpha.kouros.duration_ms"

// A book file's queue entry carries what the service needs to know of its book without asking:
// which book, where this file starts in it, how long the whole book is, and its chapters.
const val EXTRA_BOOK_ID = "net.jkos.app.alpha.kouros.book_id"
const val EXTRA_BOOK_OFFSET_MS = "net.jkos.app.alpha.kouros.book_offset_ms"
const val EXTRA_BOOK_TOTAL_MS = "net.jkos.app.alpha.kouros.book_total_ms"
const val EXTRA_CHAPTER_STARTS = "net.jkos.app.alpha.kouros.chapter_starts"
const val EXTRA_CHAPTER_ENDS = "net.jkos.app.alpha.kouros.chapter_ends"
const val EXTRA_CHAPTER_TITLES = "net.jkos.app.alpha.kouros.chapter_titles"

/** A queue entry's book, as its extras carry it; null for a track. */
data class BookInfo(val bookId: Long, val offsetMs: Long, val totalMs: Long, val chapters: List<Chapter>) {
    fun layoutChapterEnd(globalMs: Long): Long? {
        val s = globalMs / 1000.0
        return chapters.firstOrNull { s >= it.startSec && s < it.endSec }?.let { (it.endSec * 1000).toLong() }
    }
}

fun MediaItem.bookInfo(): BookInfo? {
    if (MediaRef.parse(mediaId) !is MediaRef.BookFileRef) return null
    val x = mediaMetadata.extras ?: return null
    val starts = x.getLongArray(EXTRA_CHAPTER_STARTS) ?: LongArray(0)
    val ends = x.getLongArray(EXTRA_CHAPTER_ENDS) ?: LongArray(0)
    val titles = x.getStringArray(EXTRA_CHAPTER_TITLES) ?: emptyArray()
    val chapters = starts.indices.mapNotNull { i ->
        if (i >= ends.size || i >= titles.size) null else Chapter(starts[i] / 1000.0, ends[i] / 1000.0, titles[i])
    }
    return BookInfo(x.getLong(EXTRA_BOOK_ID), x.getLong(EXTRA_BOOK_OFFSET_MS), x.getLong(EXTRA_BOOK_TOTAL_MS), chapters)
}

/** A book as queue entries, one per file in play order. */
fun BookDetail.toMediaItems(): List<MediaItem> {
    val layout = BookLayout(files, chapters)
    val starts = chapters.map { (it.startSec * 1000).toLong() }.toLongArray()
    val ends = chapters.map { (it.endSec * 1000).toLong() }.toLongArray()
    val titles = chapters.map { it.title }.toTypedArray()
    return layout.files.mapIndexed { pos, f ->
        MediaItem.Builder()
            .setMediaId(MediaRef.of(book.id, f.index))
            .setUri(KourosApi.bookStreamUrl(book.id, f.index))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(book.title)
                    .setArtist(book.author)
                    .setAlbumTitle(book.series ?: if (layout.files.size > 1) "Part ${pos + 1} of ${layout.files.size}" else null)
                    .setArtworkUri(if (book.hasCover) Uri.parse(KourosApi.bookCoverUrl(book.id)) else null)
                    .setExtras(Bundle().apply {
                        putLong(EXTRA_DURATION_MS, (f.durationSec * 1000).toLong())
                        putString(EXTRA_CONTEXT, PlayContext.book(book.id))
                        putLong(EXTRA_BOOK_ID, book.id)
                        putLong(EXTRA_BOOK_OFFSET_MS, layout.startOf(pos))
                        putLong(EXTRA_BOOK_TOTAL_MS, layout.totalMs)
                        putLongArray(EXTRA_CHAPTER_STARTS, starts)
                        putLongArray(EXTRA_CHAPTER_ENDS, ends)
                        putStringArray(EXTRA_CHAPTER_TITLES, titles)
                    })
                    .build(),
            )
            .build()
    }
}

/** A track as a queue entry. The URI is rebuilt by the service from the id (onAddMediaItems). */
fun Track.toMediaItem(context: String?): MediaItem = MediaItem.Builder()
    .setMediaId(id.toString())
    .setUri(KourosApi.streamUrl(id))
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setAlbumArtist(albumArtist)
            .setArtworkUri(if (hasCover) Uri.parse(KourosApi.coverUrl(id)) else null)
            .setExtras(Bundle().apply {
                putString(EXTRA_CONTEXT, context)
                putLong(EXTRA_DURATION_MS, (durationSec * 1000).toLong())
            })
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
 *    per request, and only to URLs under apiBase (KourosApi.authorized).
 *  · The history ledger is recorded HERE (HistoryRecorder), from the player's own events, so a
 *    listen counts whether the app's UI is open or not.
 *  · So is a book's progress, its rate and its sleep timer (BookKeeper): a book is listened to
 *    with the screen off.
 *  · And the listening session (SessionLink, SessionOutput): this phone reports as the output
 *    and takes remotes' commands whether the UI is open or not.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private var recorder: HistoryRecorder? = null
    private var keeper: BookKeeper? = null
    private var output: SessionOutput? = null
    private var recovery: Recovery? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("jkOS-Alpha")
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setAllowCrossProtocolRedirects(false)
        val authed = ResolvingDataSource.Factory(http) { spec -> withBearer(spec) }

        val player = ExoPlayer.Builder(this)
            // A dropped connection is retried longer than ExoPlayer's default (3), so a phone
            // moving from Wi-Fi to mobile data keeps playing; past that, Recovery takes over.
            .setMediaSourceFactory(DefaultMediaSourceFactory(authed).setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(LOAD_RETRIES)))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            // A book's ±30 s (the notification's, a car's, and the book player's own).
            .setSeekBackIncrementMs(SKIP_MS)
            .setSeekForwardIncrementMs(SKIP_MS)
            .build()
        player.repeatMode = PlayPolicy.repeat()
        val again = Recovery(player, scope)
        player.addListener(again)
        recovery = again

        val rec = HistoryRecorder(player)
        player.addListener(rec)
        recorder = rec
        current = rec
        val books = BookKeeper(player) { BookRate.get() }
        player.addListener(books)
        keeper = books
        // The listening session: this phone registered, its stream open, and the output role.
        val out = SessionOutput(player, scope)
        player.addListener(out)
        output = out
        SessionLink.start(scope)
        out.start()
        scope.launch {
            while (true) {
                delay(1000)
                books.tick(System.currentTimeMillis())
            }
        }

        // Artwork goes through `authed` too, so a cover is fetched with the token only when its
        // URL is under api_base, exactly like the stream.
        val artwork = DataSourceBitmapLoader.Builder(this)
            .setExecutorService(MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()))
            .setDataSourceFactory(authed)
            .build()
        val media = MediaSession.Builder(this, KourosPlayer(player))
            .setCallback(QueueCallback())
            .setBitmapLoader(artwork)
            .setSessionActivity(
                PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java).putExtra(JkosApp.EXTRA_OPEN, JkosApp.OPEN_NOW_PLAYING),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()
        session = media

        // A book in the notification, on the lock screen and in a car: −30 s and +30 s either side
        // of play, where a track has previous and next. Its chapters stay on next and previous
        // (a headset's double and triple press). The queue never loops or shuffles a book.
        player.addListener(object : Player.Listener {
            private var bookButtons: Boolean? = null
            override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                if (reason != Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) return
                if (player.shuffleModeEnabled && player.queuesABook()) player.shuffleModeEnabled = false
                Policy.repeat(player)
            }
            override fun onEvents(p: Player, events: Player.Events) {
                if (!events.containsAny(Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_TIMELINE_CHANGED)) return
                val book = player.currentMediaItem?.bookInfo() != null
                if (book == bookButtons) return
                bookButtons = book
                media.setMediaButtonPreferences(if (book) BOOK_BUTTONS else emptyList())
            }
        })

        // Signed out (here, or by the server): stop, and forget the queue — its URLs are ours.
        scope.launch {
            Auth.state.collect { s ->
                if (s is AuthState.SignedOut) {
                    rec.flush()
                    SleepTimer.clear()
                    SessionLink.stop()
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
        recovery?.cancel()
        recorder?.flush()
        keeper?.flush()
        output?.goingAway()
        SessionLink.stop()
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
     * anything that is not a KourOS track or a book's file (MediaRef) is dropped.
     */
    private inner class QueueCallback : MediaSession.Callback {
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> {
            val resolved = mediaItems.mapNotNull { item ->
                val uri = when (val ref = MediaRef.parse(item.mediaId)) {
                    is MediaRef.TrackRef -> KourosApi.streamUrl(ref.id)
                    is MediaRef.BookFileRef -> KourosApi.bookStreamUrl(ref.bookId, ref.fileIndex)
                    null -> return@mapNotNull null
                }
                item.buildUpon().setUri(uri).build()
            }
            return Futures.immediateFuture(resolved.toMutableList())
        }
    }

    companion object {
        private const val TAG = "KourOS"
        private const val LOAD_RETRIES = 6
        const val SKIP_MS = 30_000L

        private val BOOK_BUTTONS = listOf(
            CommandButton.Builder(CommandButton.ICON_SKIP_BACK_30)
                .setPlayerCommand(Player.COMMAND_SEEK_BACK)
                .setDisplayName("Back 30 seconds")
                .setSlots(CommandButton.SLOT_BACK)
                .build(),
            CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_30)
                .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
                .setDisplayName("Forward 30 seconds")
                .setSlots(CommandButton.SLOT_FORWARD)
                .build(),
        )

        /** The running service's recorder; touched on the main thread only. */
        private var current: HistoryRecorder? = null

        /** The app went to the background: bank the listen so far (see ListenLedger). */
        fun checkpoint() {
            current?.checkpoint()
        }

        /** Runs on a loader thread, once per request — so each range request gets a fresh token. */
        private fun withBearer(spec: DataSpec): DataSpec {
            if (!KourosApi.authorized(spec.uri.toString())) return spec
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
        // From one file of a book to the next is the same listen: the book is the item.
        val next = mediaItem?.mediaId?.let(MediaRef::parse)
        if (next is MediaRef.BookFileRef && ledger.isOpenFor(next.bookId, book = true)) return
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
        when (val ref = MediaRef.parse(item.mediaId)) {
            is MediaRef.TrackRef -> ledger.start(ref.id, item.mediaMetadata.extras?.getString(EXTRA_CONTEXT))
            is MediaRef.BookFileRef -> ledger.start(ref.bookId, null, book = true)
            null -> Unit
        }
    }

    private fun close(forced: Boolean) {
        // A book's position and length are the whole book's, not this file's.
        val book = player.currentMediaItem?.bookInfo()
        val position = if (book != null) book.offsetMs + player.currentPosition else player.currentPosition
        val duration = book?.totalMs ?: (player.duration.takeIf { it != C.TIME_UNSET } ?: 0L)
        val row = ledger.close(position, duration, forced) ?: return
        JkosApp.scope.launch {
            try {
                KourosApi.recordListen(row)
            } catch (e: Exception) {
                Log.w("KourOS", "failed to record a listen: ${e.message}")
            }
        }
    }
}

/**
 * The per-device playback rate for books (rateAppliesTo: books only), kept in the app's sealed
 * preferences (Auth.pref) and in memory after the first read.
 */
object BookRate {
    private const val KEY = "kouros.book_rate"
    @Volatile private var cached: Float? = null

    fun get(): Float = cached ?: (Auth.pref(KEY)?.toFloatOrNull()?.takeIf { it in Rates.PRESETS } ?: 1f).also { cached = it }

    fun set(rate: Float) {
        cached = rate
        Auth.setPref(KEY, rate.toString())
    }
}

/**
 * What a book needs from the player while it plays, screen on or off:
 *  · its rate: the device's book rate on a book's file, 1× on anything else;
 *  · its progress: saved to the server (one row per listener and book, which every device
 *    reads) every [SAVE_EVERY_MS] of playing, on pause, when another book or a track takes
 *    over, and as finished at the end. A book merely opened, never played, writes nothing;
 *  · its sleep timer ([SleepTimer]), checked every [tick].
 */
internal class BookKeeper(private val player: Player, private val rate: () -> Float) : Player.Listener {
    private data class At(val bookId: Long, val globalMs: Long, val totalMs: Long)

    private var last: At? = null
    private var playedSinceSave = false
    private var lastSaveMs = 0L

    private fun now(): At? {
        val info = player.currentMediaItem?.bookInfo() ?: return null
        return At(info.bookId, info.offsetMs + player.currentPosition, info.totalMs)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val info = mediaItem?.bookInfo()
        val prev = last
        if (prev != null && prev.bookId != info?.bookId) {
            save(prev)
            last = null
        }
        player.setPlaybackSpeed(if (info != null) rate() else 1f)
        if (info == null) SleepTimer.clear()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) playedSinceSave = true
        else now()?.let { last = it; save(it) }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED) last?.let { save(it.copy(globalMs = it.totalMs), finished = true) }
    }

    fun tick(nowMs: Long) {
        val at = now() ?: return
        last = at
        if (SleepTimer.state.value.due(nowMs, at.globalMs)) {
            player.pause()
            SleepTimer.clear()
        }
        if (player.isPlaying) {
            playedSinceSave = true
            if (nowMs - lastSaveMs >= SAVE_EVERY_MS) save(at)
        }
    }

    fun flush() { last?.let { save(it) } }

    private fun save(at: At, finished: Boolean = false) {
        if (!playedSinceSave && !finished) return
        playedSinceSave = false
        lastSaveMs = System.currentTimeMillis()
        val done = finished || (at.totalMs > 0 && at.globalMs >= at.totalMs - FINISHED_WITHIN_MS)
        val body = BookModels.progressBody(at.bookId, at.globalMs, at.totalMs, done, ListenLedger.iso(lastSaveMs))
        JkosApp.scope.launch {
            try {
                KourosApi.saveProgress(at.bookId, body)
            } catch (e: Exception) {
                Log.w("KourOS", "failed to save a book's progress: ${e.message}")
            }
        }
    }

    companion object {
        /** The web engine schedules a progress write every ~5 s of playback. */
        const val SAVE_EVERY_MS = 5_000L
        const val FINISHED_WITHIN_MS = 2_000L
    }
}
