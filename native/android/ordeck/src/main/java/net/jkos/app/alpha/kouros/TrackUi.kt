package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.window.Dialog
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// What every list of tracks shares: the row, and the one action sheet a row's ⋮ opens.

/** One row of a track list. [lead] is the track number or the position; a cover replaces it when [coverId] is given. */
@Composable
fun TrackRow(
    title: String,
    subtitle: String?,
    durationMs: Long,
    playing: Boolean,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    lead: String? = null,
    coverId: Long? = null,
    coverIsBook: Boolean = false,
    showCover: Boolean = false,
    onMenu: (() -> Unit)? = null,
    start: @Composable () -> Unit = {},
    end: @Composable () -> Unit = {},
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = onClick != null) { onClick?.invoke() }
            .padding(start = 4.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        start()
        if (showCover) {
            Spacer(Modifier.width(8.dp))
            Cover(coverId, 40.dp, Modifier.size(40.dp), book = coverIsBook, title = title)
            Spacer(Modifier.width(12.dp))
        } else {
            Eyebrow(lead ?: "·", Modifier.width(40.dp).padding(start = 12.dp), color = if (playing) Jk.face.accent else Jk.face.faint)
        }
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(
                title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall.copy(
                    color = if (playing) Jk.face.accent else Jk.face.ink,
                    shadow = if (playing) haloText(Jk.face.accent) else null,
                ),
            )
            if (!subtitle.isNullOrEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Jk.face.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (durationMs > 0) {
            Eyebrow(formatTime(durationMs), size = 9.sp)
        }
        if (onMenu != null) {
            IconButton(onClick = onMenu) { Icon(Glyphs.More, contentDescription = "More for $title") }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        end()
    }
}

val Track.durationMs: Long get() = (durationSec * 1000).toLong()

/** "Artist — Album", or whichever of the two the track has. */
fun Track.byline(): String = listOfNotNull(artist ?: albumArtist, album).filter { it.isNotEmpty() }.joinToString(" — ")

/** What a ⋮ acts on: one track, or a whole album. [context] is where "Play now" plays from. */
data class TrackTarget(
    val tracks: List<Track>,
    val title: String,
    val subtitle: String? = null,
    val context: String? = null,
    val artist: String? = null,
    val album: String? = null,
) {
    companion object {
        fun of(t: Track) = TrackTarget(listOf(t), t.title, t.byline(), null, t.albumArtist ?: t.artist, t.album)
    }
}

/**
 * The one action surface, as on the web (apps/kouros/src/components/ActionSheet.tsx).
 * "Play next" and "Add to queue" are two separate, equally visible rows, each with its own
 * glyph: the more common intent must not be the harder one to reach.
 */
@Composable
fun TrackActions(target: TrackTarget?, controller: MediaController?, push: (Screen) -> Unit, onDismiss: () -> Unit) {
    if (target == null) return
    var picking by remember(target) { mutableStateOf(false) }
    var note by remember(target) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val count = target.tracks.size
    SheetDialog(onDismiss, title = target.title, sub = target.subtitle ?: if (count > 1) "$count tracks" else null) {
        if (picking) {
            PlaylistPicker(target.tracks.map { it.id }, onDone = onDismiss, onBack = { picking = false })
            return@SheetDialog
        }
        Rule()
        val c = controller
        fun act(fn: (MediaController) -> Unit) { if (c != null) fn(c); onDismiss() }
        Action(Glyphs.Play, "Play now", null, enabled = c != null) { act { it.playQueue(target.tracks, 0, target.context) } }
        Action(Glyphs.PlayNext, "Play next", "after this track", enabled = c != null) { act { it.enqueue(target.tracks, next = true, context = target.context) } }
        Action(Glyphs.AddQueue, "Add to queue", "at the end", enabled = c != null) { act { it.enqueue(target.tracks, next = false, context = target.context) } }
        Action(Glyphs.Playlist, "Add to playlist", null) { picking = true }
        val seed = target.tracks.firstOrNull()
        if (seed != null) {
            Action(Glyphs.Radio, "Start a station", "similar tracks", enabled = c != null) {
                note = "Building a station…"
                scope.launch {
                    when (val r = attempt { KourosApi.radio(seed.id) }) {
                        is Load.Ready -> if (r.value.isEmpty()) note = "No station for this track yet." else act { it.playStation(seed, r.value) }
                        is Load.Failed -> note = r.message
                        Load.Loading -> Unit
                    }
                }
            }
        }
        note?.let { Hush(it, Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        if (target.artist != null) {
            Rule(Modifier.padding(top = 4.dp))
            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (target.album != null) {
                    TButton(quiet = true, onClick = { onDismiss(); push(KourosScreen.AlbumPage(target.album, target.artist)) }) { Text("Go to album") }
                }
                TButton(quiet = true, onClick = { onDismiss(); push(KourosScreen.ArtistPage(target.artist)) }) { Text("Go to artist") }
            }
        }
    }
}

@Composable
private fun Action(glyph: ImageVector, label: String, note: String?, enabled: Boolean = true, onClick: () -> Unit) {
    val f = Jk.face
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(glyph, contentDescription = null, modifier = Modifier.size(20.dp), tint = if (enabled) f.accent else f.ghost)
        Spacer(Modifier.width(16.dp))
        Text(label, Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = if (enabled) f.ink else f.ghost))
        note?.let { Eyebrow(it, size = 9.sp) }
    }
}

/**
 * Add [trackIds] to one of the person's playlists, or to a new one. A track already in the
 * playlist isn't added twice (the web's AddToPlaylistMenu does the same).
 */
@Composable
private fun PlaylistPicker(trackIds: List<Long>, onDone: () -> Unit, onBack: () -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<Playlist>>>(Load.Loading) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val f = Jk.face
    LaunchedEffect(attemptNo) { state = Load.Loading; state = attempt { KourosApi.playlists() } }

    fun run(block: suspend () -> String) {
        busy = true
        note = null
        scope.launch {
            when (val r = attempt { block() }) {
                is Load.Ready -> { note = r.value; attemptNo++ }
                is Load.Failed -> note = "Couldn't save: ${r.message}"
                Load.Loading -> Unit
            }
            busy = false
        }
    }

    Column(Modifier.padding(horizontal = 12.dp)) {
        Lab("Add to a playlist", Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
        note?.let { Text(it, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = f.accent)) }
        when (val s = state) {
            Load.Loading -> Lamp("Loading", Modifier.padding(12.dp))
            is Load.Failed -> {
                Hush(s.message, Modifier.padding(8.dp))
                TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry") }
            }
            is Load.Ready -> {
                if (s.value.isEmpty()) Hush("No playlists yet. Make one below.", Modifier.padding(8.dp))
                LazyColumn(Modifier.heightIn(max = 280.dp)) {
                    items(s.value, key = { it.id }) { p ->
                        val has = trackIds.all { it in p.trackRefs }
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(JkRadius.sm)).clickable(enabled = !busy) {
                                val missing = trackIds.filter { it !in p.trackRefs }
                                if (missing.isEmpty()) {
                                    note = "Already in “${p.name}”."
                                } else {
                                    run { KourosApi.updatePlaylist(p.id, trackRefs = p.trackRefs + missing); "Added to “${p.name}”." }
                                }
                            }.padding(horizontal = 8.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Glyphs.Playlist, contentDescription = null, modifier = Modifier.size(18.dp), tint = if (has) f.accent else f.faint)
                            Spacer(Modifier.width(12.dp))
                            Text(p.name, Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = f.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Eyebrow(if (has) "Added" else "${p.trackRefs.size}", color = if (has) f.accent else f.faint, size = 9.sp)
                        }
                    }
                }
            }
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(
                value = newName, onValueChange = { newName = it.take(200) }, singleLine = true,
                placeholder = { Text("New playlist") }, modifier = Modifier.weight(1f),
            )
            TButton(primary = true, enabled = newName.isNotBlank() && !busy, onClick = {
                val name = newName.trim()
                run { val p = KourosApi.createPlaylist(name, trackIds); newName = ""; "Made “${p.name}” with ${trackIds.size} track${if (trackIds.size == 1) "" else "s"}." }
            }) { Text("Create") }
        }
        Row(Modifier.padding(top = 4.dp)) {
            TButton(quiet = true, onClick = onBack) { Text("Back") }
            Spacer(Modifier.weight(1f))
            TButton(quiet = true, onClick = onDone) { Text("Done") }
        }
    }
}
