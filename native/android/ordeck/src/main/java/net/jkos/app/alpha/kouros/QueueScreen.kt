package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import androidx.media3.session.MediaController
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

/**
 * The queue, as the player holds it (apps/kouros/src/views/Queue.tsx). Drag a row's grip to
 * reorder, tap a row to play it, × to take it out. Every edit is a Media3 call on the one
 * player, so the notification, the lock screen and this list can't disagree. Rows already
 * played stay above the current one, dimmed, as on the web.
 */
@Composable
fun QueueScreen(controller: MediaController?, onBack: () -> Unit) {
    val queue = rememberQueue(controller)
    if (rememberIsRemote()) {
        // Another device is the output: its queue, edited from here by command.
        Column(Modifier.fillMaxSize()) { QueueHead("Another device is playing", onBack); RemoteQueue() }
        return
    }
    QueueBody(
        queue, onBack, live = controller != null,
        onMove = { from, to -> controller?.moveMediaItem(from, to) },
        onPlay = { i -> controller?.let { it.seekTo(i, 0L); it.play() } },
        onRemove = { i -> controller?.removeMediaItem(i) },
    )
}

/** The web's queue head: back, "Queue" in the serif, and what's left in mono under it. */
@Composable
private fun QueueHead(sub: String, onBack: () -> Unit) {
    val face = Jk.face
    Row(Modifier.fillMaxWidth().mastheadRule(face.ink).padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Glyphs.Back, contentDescription = "Back", tint = face.muted) }
        Column {
            Text("Queue", style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = face.ink))
            Text(sub, style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 11.5.sp, letterSpacing = 0.04.em, color = face.faint))
        }
    }
}

/**
 * The queue's list over [queue]: drag a row's grip to reorder, tap a row to play it, × to take
 * it out. The lifted row rides on paper with a shadow; rows already played recede (0.42, as the
 * web's `.is-past`) rather than disappear.
 */
@Composable
internal fun QueueBody(
    queue: QueueState, onBack: () -> Unit, live: Boolean = true,
    onMove: (Int, Int) -> Unit, onPlay: (Int) -> Unit, onRemove: (Int) -> Unit,
) {
    val face = Jk.face
    Column(Modifier.fillMaxSize()) {
        QueueHead(if (queue.upNext > 0) "${queue.upNext} up next · ${formatTime(queue.remainingMs)} left" else "Nothing up next", onBack)
        if (!live || queue.entries.isEmpty()) {
            Text("The queue is empty. Play something from the library.", Modifier.fillMaxWidth().padding(32.dp),
                style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 12.sp, color = face.faint, textAlign = androidx.compose.ui.text.style.TextAlign.Center))
            return@Column
        }
        ReorderList(
            items = queue.entries,
            key = { i, e -> "${e.mediaId}:$i" },
            onMove = onMove,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 8.dp),
        ) { i, e, grip, lifted ->
            TrackRow(
                title = e.title.ifEmpty { e.mediaId },
                subtitle = e.artist,
                durationMs = e.durationMs,
                playing = i == queue.current,
                showCover = true,
                coverId = e.coverId.takeIf { e.hasArtwork },
                coverIsBook = e.isBook,
                onClick = { onPlay(i) },
                modifier = Modifier
                    .then(if (lifted) Modifier.drawBehind { boxShadow(face.ink.copy(alpha = 0.22f), JkRadius.base, 14.dp, dy = 4.dp) } else Modifier)
                    .clip(RoundedCornerShape(JkRadius.base))
                    .background(if (lifted) face.paper else Color.Transparent)
                    .alpha(if (i < queue.current) 0.42f else 1f),
                start = {
                    Box(grip.width(34.dp).heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
                        Icon(Glyphs.Grip, contentDescription = "Reorder ${e.title}", tint = if (lifted) face.accent else face.faint, modifier = Modifier.size(18.dp))
                    }
                },
                end = {
                    IconButton(onClick = { onRemove(i) }, modifier = Modifier.alpha(0.5f)) {
                        Icon(Glyphs.Close, contentDescription = "Remove ${e.title} from the queue", tint = face.ink)
                    }
                },
            )
        }
    }
}
