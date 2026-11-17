package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import androidx.media3.session.MediaController

/**
 * The queue, as the player holds it (apps/kouros/src/views/Queue.tsx). Drag a row's grip to
 * reorder, tap a row to play it, × to take it out. Every edit is a Media3 call on the one
 * player, so the notification, the lock screen and this list can't disagree. Rows already
 * played stay above the current one, dimmed, as on the web.
 */
@Composable
fun QueueScreen(controller: MediaController?, onBack: () -> Unit) {
    val queue = rememberQueue(controller)
    Column(Modifier.fillMaxSize()) {
        Header("Queue", onBack)
        Text(
            if (queue.upNext > 0) "${queue.upNext} up next · ${formatTime(queue.remainingMs)} left" else "Nothing up next",
            Modifier.padding(start = 16.dp, bottom = 8.dp),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (controller == null || queue.entries.isEmpty()) {
            Text("The queue is empty. Play something from the library.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        ReorderList(
            items = queue.entries,
            key = { i, e -> "${e.mediaId}:$i" },
            onMove = { from, to -> controller.moveMediaItem(from, to) },
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 8.dp),
        ) { i, e, grip, lifted ->
            TrackRow(
                title = e.title.ifEmpty { e.mediaId },
                subtitle = e.artist,
                durationMs = e.durationMs,
                playing = i == queue.current,
                showCover = true,
                coverId = e.coverId.takeIf { e.hasArtwork },
                coverIsBook = e.isBook,
                onClick = {
                    controller.seekTo(i, 0L)
                    controller.play()
                },
                modifier = Modifier
                    .background(if (lifted) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background)
                    .alpha(if (i < queue.current) 0.55f else 1f),
                start = { Icon(Glyphs.Grip, contentDescription = "Reorder ${e.title}", modifier = grip.padding(12.dp)) },
                end = {
                    IconButton(onClick = { controller.removeMediaItem(i) }) {
                        Icon(Glyphs.Close, contentDescription = "Remove ${e.title} from the queue")
                    }
                },
            )
        }
    }
}
