package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.auth.Auth

import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.random.Random

// What the player does beyond plain ExoPlayer, in one place:
//  · a book is navigated by CHAPTER: "next" and "previous" from a headset, a car, the lock screen
//    or this app's own mini player move to a chapter boundary, never to the start of a
//    twelve-hour file (the web's nextSegment / prevSegment);
//  · shuffle and repeat are the person's standing choice (the web's queuePrefs), kept in the
//    sealed prefs, and a book never shuffles or loops;
//  · a stream that drops (a lift, a tunnel, Wi-Fi to mobile) is picked up again where it was.
// The pure halves (Shuffles, PlayOrder, Recovery.isTransient) carry no Android type, so the JVM
// test holds them.

/** Shuffle orders, pure. */
object Shuffles {
    /**
     * A random order of [count] queue entries that starts at [current]: turning shuffle on mid-queue
     * plays everything else next, in a random order, instead of whatever happened to follow the
     * current entry in a random permutation (which can be nothing at all).
     */
    fun currentFirst(count: Int, current: Int, random: Random): IntArray {
        if (count <= 0) return IntArray(0)
        val rest = (0 until count).filter { it != current }.toMutableList()
        for (i in rest.lastIndex downTo 1) {
            val j = random.nextInt(i + 1)
            val t = rest[i]; rest[i] = rest[j]; rest[j] = t
        }
        return (if (current in 0 until count) listOf(current) + rest else rest).toIntArray()
    }

    /** True when [order] is a permutation of 0 until [count]: what the session requires while shuffle is on. */
    fun isPermutation(order: List<Int>, count: Int): Boolean =
        order.size == count && order.toSet() == (0 until count).toSet()
}

/** The person's standing shuffle and repeat, kept on the device like the web keeps them per browser. */
object PlayPolicy {
    private const val SHUFFLE = "kouros.shuffle"
    private const val REPEAT = "kouros.repeat"

    @Volatile private var shuffle: Boolean? = null
    @Volatile private var repeat: Int? = null

    fun shuffle(): Boolean = shuffle ?: (Auth.pref(SHUFFLE) == "1").also { shuffle = it }

    fun repeat(): Int = repeat ?: (Auth.pref(REPEAT)?.toIntOrNull()?.takeIf { it in REPEAT_MODES } ?: Player.REPEAT_MODE_OFF).also { repeat = it }

    fun setShuffle(on: Boolean) { shuffle = on; Auth.setPref(SHUFFLE, if (on) "1" else "0") }

    fun setRepeat(mode: Int) {
        val m = mode.takeIf { it in REPEAT_MODES } ?: Player.REPEAT_MODE_OFF
        repeat = m; Auth.setPref(REPEAT, m.toString())
    }

    /** Off → all → one → off: the web's repeat button. */
    fun nextRepeat(mode: Int): Int = when (mode) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    fun repeatName(mode: Int): String = when (mode) { Player.REPEAT_MODE_ALL -> "all"; Player.REPEAT_MODE_ONE -> "one"; else -> "off" }

    fun repeatOf(name: String?): Int = when (name) { "all" -> Player.REPEAT_MODE_ALL; "one" -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }

    private val REPEAT_MODES = setOf(Player.REPEAT_MODE_OFF, Player.REPEAT_MODE_ALL, Player.REPEAT_MODE_ONE)
}

/** True when any entry of the queue is a book's file. A book plays in order and never loops. */
fun Player.queuesABook(): Boolean = (0 until mediaItemCount).any { MediaRef.parse(getMediaItemAt(it).mediaId) is MediaRef.BookFileRef }

/**
 * The queue's entries in the order they will play: the shuffle order while shuffle is on, the
 * queue's own order otherwise. Index i of the result is the entry played i-th.
 */
fun Player.playOrder(): List<Int> {
    val t = currentTimeline
    if (t.isEmpty) return emptyList()
    val out = ArrayList<Int>(t.windowCount)
    var i = t.getFirstWindowIndex(shuffleModeEnabled)
    while (i != C.INDEX_UNSET && out.size < t.windowCount) {
        out += i
        i = t.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, shuffleModeEnabled)
    }
    return out
}

/** Applying the policy to the one ExoPlayer: the service's wrapper, and the session's commands. */
@OptIn(UnstableApi::class)
internal object Policy {
    /**
     * Shuffle on or off as the person wants it. On, it starts from the current entry (a fresh
     * random order every time it is switched on or the queue is replaced). With a book in the
     * queue it stays off.
     */
    fun shuffle(exo: ExoPlayer, on: Boolean) {
        if (!on || exo.queuesABook() || exo.mediaItemCount < 2) {
            if (exo.shuffleModeEnabled) exo.shuffleModeEnabled = false
            return
        }
        val seed = System.nanoTime()
        exo.setShuffleOrder(DefaultShuffleOrder(Shuffles.currentFirst(exo.mediaItemCount, exo.currentMediaItemIndex, Random(seed)), seed))
        exo.shuffleModeEnabled = true
    }

    /** Repeat as the person wants it, except that a book never loops. */
    fun repeat(exo: Player) {
        val want = if (exo.queuesABook()) Player.REPEAT_MODE_OFF else PlayPolicy.repeat()
        if (exo.repeatMode != want) exo.repeatMode = want
    }

    /** After the queue was replaced: the standing shuffle with a fresh order, and repeat. */
    fun queueReplaced(exo: ExoPlayer) {
        shuffle(exo, PlayPolicy.shuffle())
        repeat(exo)
    }
}

/**
 * The player the media session exposes (and so the notification, the lock screen, Bluetooth, a
 * car and this app's UI). It is the service's ExoPlayer with three changes:
 *  · while a book plays, next and previous are chapter moves, and they are offered even when the
 *    book is a single file (ExoPlayer would offer neither, or jump to its start);
 *  · switching shuffle on starts the order at the current entry, and is the person's standing
 *    choice; so is repeat;
 *  · a replaced queue keeps that choice, with a fresh order.
 */
@OptIn(UnstableApi::class)
internal class KourosPlayer(private val exo: ExoPlayer) : ForwardingSimpleBasePlayer(exo) {
    override fun getState(): State {
        val s = super.getState()
        if (exo.currentMediaItem?.bookInfo() == null) return s
        val commands = s.availableCommands.buildUpon()
            .addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .build()
        return s.buildUpon().setAvailableCommands(commands).build()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val book = exo.currentMediaItem?.bookInfo()
        val next = when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> true
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> false
            else -> null
        }
        if (book != null && next != null) {
            exo.chapterStep(book, next)
            return Futures.immediateVoidFuture()
        }
        return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
    }

    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
        PlayPolicy.setShuffle(shuffleModeEnabled)
        Policy.shuffle(exo, shuffleModeEnabled)
        return Futures.immediateVoidFuture()
    }

    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
        PlayPolicy.setRepeat(repeatMode)
        Policy.repeat(exo)
        return Futures.immediateVoidFuture()
    }

    override fun handleSetMediaItems(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> {
        val done = super.handleSetMediaItems(mediaItems, startIndex, startPositionMs)
        Policy.queueReplaced(exo)
        return done
    }
}

/** Where a position in the book falls among the queue's entries of that book: the entry and the offset into it. */
fun Player.bookEntryAt(book: BookInfo, globalMs: Long): Pair<Int, Long>? {
    val target = globalMs.coerceIn(0L, book.totalMs)
    var best = -1
    var bestOffset = -1L
    for (i in 0 until mediaItemCount) {
        val info = getMediaItemAt(i).bookInfo() ?: continue
        if (info.bookId == book.bookId && info.offsetMs <= target && info.offsetMs >= bestOffset) { best = i; bestOffset = info.offsetMs }
    }
    return if (best >= 0) best to (target - bestOffset) else null
}

/** Seek to [globalMs] in the book now playing, across its files. */
fun Player.seekBook(book: BookInfo, globalMs: Long) {
    bookEntryAt(book, globalMs)?.let { (entry, offset) -> seekTo(entry, offset) }
}

/**
 * One chapter on ([next]) or back: the start of the next chapter; back is the start of this one,
 * or of the one before within its first seconds (BookLayout.previousChapterStart). A book without
 * chapters steps by its files' boundaries the same way.
 */
fun Player.chapterStep(book: BookInfo, next: Boolean) {
    val at = book.offsetMs + currentPosition
    val target = BookNav.step(book, at, next) ?: return
    seekBook(book, target)
}

/** Chapter arithmetic over a queued book, pure. */
object BookNav {
    /** Where one step [next] or back from [globalMs] lands, or null for nowhere (past the last chapter). */
    fun step(book: BookInfo, globalMs: Long, next: Boolean): Long? {
        val layout = BookLayout(listOf(BookFile(0, book.totalMs / 1000.0)), book.chapters)
        if (book.chapters.isNotEmpty()) {
            return if (next) layout.nextChapterStart(globalMs) else layout.previousChapterStart(globalMs) ?: 0L
        }
        // No chapters: a restart, or the very start.
        return if (next) null else 0L
    }
}

/**
 * Picks a dropped stream up again. ExoPlayer already retries a failing load (more times than
 * its default here, see PlaybackService); when it gives up, the player stops with an error and
 * would stay stopped. This re-prepares it — at the same position, still playing if it was —
 * after a growing pause, a few times, and starts counting again once it plays.
 */
internal class Recovery(private val player: Player, private val scope: CoroutineScope) : Player.Listener {
    private var attempts = 0
    private var job: Job? = null

    override fun onPlayerError(error: PlaybackException) {
        if (!isTransient(error.errorCode) || attempts >= DELAYS_MS.size || player.mediaItemCount == 0) return
        val wait = DELAYS_MS[attempts++]
        Log.w("KourOS", "playback stopped (${error.errorCodeName}); trying again in ${wait / 1000} s")
        job?.cancel()
        job = scope.launch {
            delay(wait)
            if (player.playerError != null && player.mediaItemCount > 0) player.prepare()
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) attempts = 0 }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { attempts = 0 }

    fun cancel() { job?.cancel() }

    companion object {
        val DELAYS_MS = longArrayOf(2_000, 6_000, 15_000)

        /** The network, a timeout, or a server's bad moment: worth another try. A file the server can't decode isn't. */
        fun isTransient(code: Int): Boolean = code in setOf(
            PlaybackException.ERROR_CODE_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        )

        /** What the listener reads when playback stopped on [code]. */
        fun message(code: Int): String = when (code) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED -> "Lost the connection to KourOS."
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "KourOS couldn't send this file."
            PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE -> "KourOS answered with something that isn't audio. Sign in again if this keeps happening."
            else -> if (code in 3000..4999) "This file can't be played on this phone." else "Playback stopped."
        }
    }
}
