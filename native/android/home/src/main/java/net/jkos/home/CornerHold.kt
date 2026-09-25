package net.jkos.home

import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs

/**
 * The hidden way into the drawer: one finger held still in the top-left corner of [anchor]
 * for [HOLD_MS]. It WATCHES touches and consumes none of them, so the page underneath gets
 * every event until the hold fires. A kiosk measure against guests, not against someone
 * who knows it is there.
 */
internal class CornerHold(private val anchor: View, private val onHold: () -> Unit) {
    private val size = CORNER_DP * anchor.resources.displayMetrics.density
    private val slop = ViewConfiguration.get(anchor.context).scaledTouchSlop
    private val handler = Handler(Looper.getMainLooper())
    private var downX = 0f
    private var downY = 0f

    /** True from the moment the hold fires until the gesture ends: its remaining events
     *  belong to no one. */
    var fired = false
        private set

    private val fire = Runnable { fired = true; onHold() }

    fun watch(ev: MotionEvent) {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                fired = false
                val at = IntArray(2).also { anchor.getLocationOnScreen(it) }
                val x = ev.rawX - at[0]
                val y = ev.rawY - at[1]
                if (x in 0f..size && y in 0f..size) {
                    downX = ev.rawX
                    downY = ev.rawY
                    handler.postDelayed(fire, HOLD_MS)
                }
            }
            MotionEvent.ACTION_MOVE ->
                if (abs(ev.rawX - downX) > slop || abs(ev.rawY - downY) > slop) handler.removeCallbacks(fire)
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                handler.removeCallbacks(fire)
        }
    }

    companion object {
        const val HOLD_MS = 2000L
        const val CORNER_DP = 48
    }
}
