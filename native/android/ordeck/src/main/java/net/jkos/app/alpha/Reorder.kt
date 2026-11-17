package net.jkos.app.alpha

import kotlin.math.roundToInt

// The arithmetic under a drag-to-reorder list (the queue, a playlist). Pure: no Android
// import, so the JVM test holds it. The gesture is bound to a grip, never the whole row, so
// a row can still be scrolled past and tapped (apps/kouros/src/views/Queue.tsx says why).

object Reorder {
    /**
     * Where the row picked up at [from] would land after the finger travelled [dy] pixels over
     * rows [rowPx] tall, in a list of [size]: the nearest whole row, kept inside the list.
     */
    fun target(from: Int, dy: Float, rowPx: Float, size: Int): Int {
        if (size <= 0) return 0
        val rows = if (rowPx > 0f) (dy / rowPx).roundToInt() else 0
        return (from + rows).coerceIn(0, size - 1)
    }

    /**
     * How far, in rows, row [i] moves aside while [from] is held over [to], so the gap under
     * the finger is where it would drop. The held row itself follows the finger instead.
     */
    fun shift(i: Int, from: Int, to: Int): Int = when {
        i == from -> 0
        from < to && i in (from + 1)..to -> -1
        from > to && i in to until from -> 1
        else -> 0
    }

    /** Remove the item at [from] and insert it at [to], the way Media3's moveMediaItem does. */
    fun <T> move(list: List<T>, from: Int, to: Int): List<T> {
        if (from == to || from !in list.indices || to !in list.indices) return list.toList()
        val out = list.toMutableList()
        out.add(to, out.removeAt(from))
        return out
    }
}
