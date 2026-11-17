package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

// The phone as a REMOTE (TODO §10 G3): another device is the session's output, and this one
// draws what it is doing, on the server's clock, and sends every verb to it as a command.
// The web's half is apps/kouros/src/session/remote.ts.

/** What the output is playing, resolved for drawing. */
data class RemoteNow(
    val itemRef: String,
    val title: String,
    val subtitle: String,
    val coverId: Long?,
    val isBook: Boolean,
    val durationMs: Long,
    val chapters: List<Chapter>,
)

/** True while this phone is a remote: the screens then draw the session, not the local player. */
@Composable
fun rememberIsRemote(): Boolean = SessionLink.role.collectAsState().value == SessionMode.REMOTE

/** The session's current item, resolved (a track's row, or a book's detail), or null. */
@Composable
fun rememberRemoteNow(): RemoteNow? {
    val st by SessionLink.state.collectAsState()
    val ref = st.session?.itemRef
    val now by produceState<RemoteNow?>(null, ref) {
        value = ref?.let { r -> runCatching { resolveNow(r) }.getOrNull() }
    }
    return now?.takeIf { it.itemRef == ref }
}

private suspend fun resolveNow(ref: String): RemoteNow? {
    val book = ref.takeIf { it.startsWith("book:") }?.removePrefix("book:")?.toLongOrNull()
    if (book != null) {
        val d = KourosApi.book(book)
        return RemoteNow(ref, d.book.title, BookModels.byline(d.book), d.book.id.takeIf { d.book.hasCover }, true, BookLayout(d.files, d.chapters).totalMs, d.chapters)
    }
    val id = (ref.removePrefix("kouros:")).toLongOrNull() ?: return null
    val t = KourosApi.tracksByIds(listOf(id)).firstOrNull() ?: return null
    return RemoteNow(ref, t.title, t.byline(), t.id.takeIf { t.hasCover }, false, t.durationMs, emptyList())
}

/** The output's position now, ticking while it plays: the server's report, extrapolated on its clock. */
@Composable
fun rememberRemotePosition(): Long {
    val st by SessionLink.state.collectAsState()
    val s = st.session ?: return 0L
    var pos by remember(s.rev) { mutableLongStateOf(s.positionAt(SessionLink.serverNow())) }
    LaunchedEffect(s.rev, s.playing) {
        while (s.playing) {
            pos = s.positionAt(SessionLink.serverNow())
            delay(500)
        }
        pos = s.positionAt(SessionLink.serverNow())
    }
    return pos
}

private fun send(op: String, args: JSONObject = SessionCore.Commands.simple()) {
    JkosApp.scope.launch { SessionLink.command(op, args) }
}

private fun outputName(st: LinkState): String =
    st.devices.firstOrNull { it.id == st.session?.activeDevice }?.name ?: "another device"

@Composable
fun RemoteMiniPlayer(open: () -> Unit) {
    val st by SessionLink.state.collectAsState()
    val now = rememberRemoteNow()
    val playing = st.session?.playing == true
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).clickable(onClick = open).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(now?.coverId, 44.dp, Modifier.size(44.dp), book = now?.isBook == true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(now?.title ?: "…", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            Text("On ${outputName(st)}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
        }
        IconButton(onClick = { send(if (playing) "pause" else "play") }) {
            Icon(if (playing) Glyphs.Pause else Glyphs.Play, contentDescription = if (playing) "Pause" else "Play")
        }
        IconButton(onClick = { send("next") }) { Icon(Glyphs.Next, contentDescription = "Next") }
    }
}

/** Now Playing while another device plays: its item, its clock, and every verb a command. */
@Composable
fun RemoteNowPlaying() {
    val st by SessionLink.state.collectAsState()
    val s = st.session
    val now = rememberRemoteNow()
    val position = rememberRemotePosition()
    var dragging by remember { mutableStateOf<Float?>(null) }
    val playing = s?.playing == true
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Playing on ${outputName(st)}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(12.dp))
        Cover(now?.coverId, 280.dp, Modifier.fillMaxWidth(0.8f).aspectRatio(1f), book = now?.isBook == true)
        Spacer(Modifier.height(16.dp))
        Text(now?.title ?: "…", style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val chapter = now?.chapters?.firstOrNull { position / 1000.0 >= it.startSec && position / 1000.0 < it.endSec }
        Text(chapter?.title ?: now?.subtitle ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val total = (now?.durationMs ?: 0L).coerceAtLeast(1L)
        Slider(
            value = dragging ?: (position.toFloat() / total).coerceIn(0f, 1f),
            onValueChange = { dragging = it },
            onValueChangeFinished = { dragging?.let { send("seek", SessionCore.Commands.seek((it * total).toLong())) }; dragging = null },
            enabled = now != null && now.durationMs > 0,
        )
        Row(Modifier.fillMaxWidth()) {
            Text(formatTime(dragging?.let { (it * total).toLong() } ?: position), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.weight(1f))
            Text(formatTime(now?.durationMs ?: 0L), style = MaterialTheme.typography.bodySmall)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (now?.isBook == true) {
                IconButton(onClick = { send("segment", SessionCore.Commands.segment(next = false)) }) { Icon(Glyphs.Previous, contentDescription = "Previous chapter") }
                TextButton(onClick = { send("skip", SessionCore.Commands.skip(-30_000)) }) { Text("−30 s") }
            } else {
                IconButton(onClick = { send("prev") }) { Icon(Glyphs.Previous, contentDescription = "Previous") }
            }
            IconButton(onClick = { send(if (playing) "pause" else "play") }, modifier = Modifier.size(72.dp)) {
                Icon(if (playing) Glyphs.Pause else Glyphs.Play, contentDescription = if (playing) "Pause" else "Play", modifier = Modifier.size(44.dp))
            }
            if (now?.isBook == true) {
                TextButton(onClick = { send("skip", SessionCore.Commands.skip(30_000)) }) { Text("+30 s") }
                IconButton(onClick = { send("segment", SessionCore.Commands.segment(next = true)) }) { Icon(Glyphs.Next, contentDescription = "Next chapter") }
            } else {
                IconButton(onClick = { send("next") }) { Icon(Glyphs.Next, contentDescription = "Next") }
            }
        }
        if (now?.isBook == true && s != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { send("rate") }) { Text(Rates.label(s.rate.toFloat())) }
                Text(s.sleepMode?.let { if (it == SleepState.CHAPTER) "Sleep: chapter" else "Sleep: $it min" } ?: "", Modifier.align(Alignment.CenterVertically), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * Every device this listener has, the output marked: tap one to make it the output (this one
 * included, which plays here from the session's second), and set any online device's volume.
 */
@Composable
fun DevicesDialog(onDismiss: () -> Unit) {
    val st by SessionLink.state.collectAsState()
    val me = SessionLink.deviceId
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { SessionLink.refreshSnapshot() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Play on") },
        text = {
            Column {
                if (st.status != LinkStatus.LIVE) Text("Connecting to the session…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                LazyColumn(Modifier.heightIn(max = 400.dp)) {
                    items(st.devices.sortedWith(compareByDescending<SessionDevice> { it.online }.thenBy { it.name }), key = { it.id }) { d ->
                        val output = d.id == st.session?.activeDevice
                        Column(Modifier.fillMaxWidth().clickable(enabled = d.online && !output) {
                            scope.launch {
                                note = if (SessionLink.transfer(d.id, play = if (d.id == me) true else null)) null else "Couldn't move playback to ${d.name}."
                                if (note == null) onDismiss()
                            }
                        }.padding(vertical = 8.dp)) {
                            Text(
                                d.name + if (d.id == me) " (this phone)" else "",
                                fontWeight = if (output) FontWeight.Bold else FontWeight.Normal,
                                color = if (output) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                listOfNotNull(if (output) "Playing" else null, if (d.online) "online" else "offline", d.kind).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (d.online && d.id != me) {
                                var level by remember(d.id) { mutableFloatStateOf((d.volume ?: 1.0).toFloat()) }
                                Slider(
                                    value = level, onValueChange = { level = it },
                                    onValueChangeFinished = { send("volume", SessionCore.Commands.volume(d.id, level)) },
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}
