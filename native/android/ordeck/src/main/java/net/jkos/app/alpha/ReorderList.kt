package net.jkos.app.alpha

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.zIndex

/** A row picked up by its grip: where it started, and how far the finger has moved since. */
private data class Lift(val from: Int, val dy: Float)

/**
 * A list whose rows are reordered by dragging a grip. The grip lifts at once (it is
 * unambiguous, so there is nothing to wait for), the other rows slide aside to show where the
 * row would land, and [onMove] is called once, on release, with Media3's remove-then-insert
 * indices ([Reorder.move]). Nothing moves in [items] until the caller applies it.
 *
 * Each grip also carries "Move up" and "Move down" as accessibility actions, so a screen
 * reader (or anyone who can't drag) can reorder too.
 *
 * [row] draws one item; it puts the `grip` modifier on whatever it draws as the handle.
 */
@Composable
fun <T> ReorderList(
    items: List<T>,
    key: (Int, T) -> Any,
    onMove: (from: Int, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: LazyListScope.() -> Unit = {},
    row: @Composable (index: Int, item: T, grip: Modifier, lifted: Boolean) -> Unit,
) {
    var lift by remember { mutableStateOf<Lift?>(null) }
    var rowPx by remember { mutableFloatStateOf(0f) }
    val move by rememberUpdatedState(onMove)
    val size = items.size

    LazyColumn(modifier, contentPadding = contentPadding) {
        header()
        itemsIndexed(items, key = { i, item -> key(i, item) }) { i, item ->
            val held = lift
            val lifted = held?.from == i
            val offset = when {
                held == null -> 0f
                lifted -> held.dy
                else -> Reorder.shift(i, held.from, Reorder.target(held.from, held.dy, rowPx, size)) * rowPx
            }
            val grip = Modifier
                .pointerInput(i, size) {
                    detectDragGestures(
                        onDragStart = { lift = Lift(i, 0f) },
                        onDrag = { change, amount ->
                            change.consume()
                            lift = lift?.let { it.copy(dy = it.dy + amount.y) }
                        },
                        onDragEnd = {
                            val l = lift
                            lift = null
                            if (l != null) {
                                val to = Reorder.target(l.from, l.dy, rowPx, size)
                                if (to != l.from) move(l.from, to)
                            }
                        },
                        onDragCancel = { lift = null },
                    )
                }
                .semantics {
                    customActions = buildList {
                        if (i > 0) add(CustomAccessibilityAction("Move up") { move(i, i - 1); true })
                        if (i < size - 1) add(CustomAccessibilityAction("Move down") { move(i, i + 1); true })
                    }
                }
            Box(
                Modifier
                    .zIndex(if (lifted) 1f else 0f)
                    .graphicsLayer { translationY = offset }
                    .onSizeChanged { if (it.height > 0) rowPx = it.height.toFloat() },
            ) {
                row(i, item, grip, lifted)
            }
        }
    }
}
