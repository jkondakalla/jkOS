package net.jkos.app.alpha.kouros

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// The sleep timer, for a book. Its modes are the suite's (packages/player engine/types.ts
// SleepMode, and the listening session's sleep_mode): off, 15/30/45/60 minutes, or the end of
// the chapter ('segment'). The screen sets it; the playback service, which keeps running with
// the screen off, checks it and pauses. Both are in this one process, so the state is held here.
// Pure apart from the flow, so the JVM test drives it with its own clock.

data class SleepState(
    val mode: String = OFF,
    /** For a timed mode: when to pause, on the device clock. */
    val deadlineMs: Long? = null,
    /** For 'segment': the end of the chapter it was set in, as a position in the book. */
    val chapterEndMs: Long? = null,
) {
    val on get() = mode != OFF

    /** Time left on a timed mode at [nowMs], or null. */
    fun remainingMs(nowMs: Long): Long? = deadlineMs?.let { (it - nowMs).coerceAtLeast(0) }

    /** Whether the player should pause at [nowMs], playing at [globalMs] in the book. */
    fun due(nowMs: Long, globalMs: Long): Boolean = when {
        deadlineMs != null -> nowMs >= deadlineMs
        chapterEndMs != null -> globalMs >= chapterEndMs - END_SLACK_MS
        else -> false
    }

    companion object {
        const val OFF = "off"
        const val CHAPTER = "segment"
        val TIMED = listOf("15", "30", "45", "60")

        /** The engine pauses a quarter second before the chapter ends, so the next one never starts. */
        const val END_SLACK_MS = 250L
    }
}

object SleepTimer {
    private val _state = MutableStateFlow(SleepState())
    val state: StateFlow<SleepState> = _state

    /**
     * Set [mode] at [nowMs]. 'segment' needs [chapterEndMs]: without a chapter to end, it is
     * refused (off), as an unknown mode is.
     */
    fun set(mode: String, nowMs: Long, chapterEndMs: Long?) {
        _state.value = plan(mode, nowMs, chapterEndMs)
    }

    fun clear() { _state.value = SleepState() }

    fun plan(mode: String, nowMs: Long, chapterEndMs: Long?): SleepState = when (mode) {
        in SleepState.TIMED -> SleepState(mode, deadlineMs = nowMs + mode.toLong() * 60_000)
        SleepState.CHAPTER -> if (chapterEndMs != null) SleepState(mode, chapterEndMs = chapterEndMs) else SleepState()
        else -> SleepState()
    }
}
