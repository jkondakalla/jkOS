package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import net.jkos.app.alpha.look.*
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextStyle
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.Field
import net.jkos.app.alpha.look.TButton

private fun count(n: Int) = "$n track${if (n == 1) "" else "s"}"

// ── the person's playlists: make, rename, delete ───────────────────────────────

/** Playlists (apps/kouros/src/views/playlists/Playlists.tsx): every write reloads the list. [pre] draws without the network (the renders). */
@Composable
fun PlaylistsScreen(onBack: () -> Unit, push: (Screen) -> Unit, pre: List<Playlist>? = null) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<Playlist>>>(pre?.let { Load.Ready(it) } ?: Load.Loading) }
    var creating by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf<Playlist?>(null) }
    var deleting by remember { mutableStateOf<Playlist?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(attemptNo) { if (pre == null || attemptNo > 0) state = attempt { KourosApi.playlists() } }

    fun write(after: () -> Unit = {}, block: suspend () -> Unit) {
        busy = true
        note = null
        scope.launch {
            when (val r = attempt { block() }) {
                is Load.Ready -> { after(); attemptNo++ }
                is Load.Failed -> note = "Couldn't save: ${r.message}"
                Load.Loading -> Unit
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header("Playlists", onBack) {
            TButton(primary = !creating, quiet = creating, onClick = { creating = !creating }) {
                if (!creating) Icon(Glyphs.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                Text(if (creating) "Cancel" else "New")
            }
        }
        if (creating) {
            Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field(
                    value = newName, onValueChange = { newName = it.take(200) }, singleLine = true,
                    placeholder = { Text("Playlist name") }, modifier = Modifier.weight(1f),
                )
                TButton(primary = true, enabled = newName.isNotBlank() && !busy, onClick = {
                    val name = newName.trim()
                    write(after = { newName = ""; creating = false }) { KourosApi.createPlaylist(name) }
                }) { Text("Create") }
            }
        }
        note?.let { Text(it, Modifier.padding(16.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = Jk.face.secondary)) }
        Loaded(state, retry = { attemptNo++ }) { playlists ->
            if (playlists.isEmpty()) {
                Hush("No playlists yet. Make one with New, or add a track to one from its ⋮.", Modifier.padding(24.dp))
                return@Loaded
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(playlists, key = { it.id }) { p ->
                    PlaylistRow(p, open = { push(KourosScreen.PlaylistPage(p.id, p.name)) }, rename = { renaming = p }, delete = { deleting = p })
                }
            }
        }
    }

    renaming?.let { p ->
        var name by remember(p.id) { mutableStateOf(p.name) }
        SheetDialog({ renaming = null }, title = "Rename playlist") {
            Field(value = name, onValueChange = { name = it.take(200) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp))
            DialogActions {
                TButton(quiet = true, onClick = { renaming = null }) { Text("Cancel") }
                TButton(primary = true, enabled = name.isNotBlank() && !busy, onClick = {
                    val n = name.trim()
                    write(after = { renaming = null }) { KourosApi.updatePlaylist(p.id, name = n) }
                }) { Text("Save") }
            }
        }
    }
    deleting?.let { p ->
        SheetDialog({ deleting = null }, title = "Delete “${p.name}”?") {
            Hush("The playlist goes. Its tracks stay in your library.", Modifier.padding(horizontal = 18.dp))
            DialogActions {
                TButton(quiet = true, onClick = { deleting = null }) { Text("Cancel") }
                TButton(primary = true, enabled = !busy, onClick = { write(after = { deleting = null }) { KourosApi.deletePlaylist(p.id) } }) { Text("Delete") }
            }
        }
    }
}

/** A playlist as a card: its first tracks' sleeves fanned, its name in the serif, its length. */
@Composable
private fun PlaylistRow(p: Playlist, open: () -> Unit, rename: () -> Unit, delete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val f = Jk.face
    Sheet(Modifier.fillMaxWidth(), padding = PaddingValues(0.dp)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(start = 12.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(52.dp)) {
                val ids = p.trackRefs.take(2)
                if (ids.size == 2) Cover(ids[1], 40.dp, Modifier.size(40.dp).align(Alignment.BottomEnd), title = p.name)
                Cover(ids.firstOrNull(), 40.dp, Modifier.size(40.dp).align(Alignment.TopStart), title = p.name)
            }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(p.name, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = f.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                p.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 12.5.sp, color = f.muted), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                Eyebrow(count(p.trackRefs.size), Modifier.padding(top = 2.dp), size = 9.sp)
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Glyphs.More, contentDescription = "More for ${p.name}", tint = f.muted) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename() })
                    DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; delete() })
                }
            }
        }
    }
}

// ── one playlist: play, reorder, remove ────────────────────────────────────────

/**
 * One playlist (apps/kouros/src/views/playlists/PlaylistDetail.tsx). Its track_refs are read
 * by id, not by downloading the catalog; a ref the catalog no longer has is skipped. A
 * reorder or a removal is drawn at once and saved as the whole list (the collection's one
 * reorder primitive), and put back if the save fails.
 */
@Composable
fun PlaylistScreen(page: KourosScreen.PlaylistPage, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit, pre: Pair<Playlist, List<Track>>? = null) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<Playlist, List<Track>>>>(pre?.let { Load.Ready(it) } ?: Load.Loading) }
    var rows by remember { mutableStateOf(pre?.second ?: emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    val scope = rememberCoroutineScope()
    val context = PlayContext.playlist(page.id)
    val f = Jk.face

    LaunchedEffect(page.id, attemptNo) {
        if (pre != null && attemptNo == 0) return@LaunchedEffect
        state = Load.Loading
        state = attempt {
            val p = KourosApi.playlists().firstOrNull { it.id == page.id } ?: throw NoSuchElementException("This playlist could not be found.")
            p to KourosApi.tracksByIds(p.trackRefs)
        }
        (state as? Load.Ready)?.let { rows = it.value.second }
    }

    fun save(next: List<Track>) {
        val before = rows
        rows = next
        note = null
        scope.launch {
            if (attempt { KourosApi.updatePlaylist(page.id, trackRefs = next.map { it.id }) } is Load.Failed) {
                rows = before
                note = "Couldn't save the new order. It's back as it was."
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header("", onBack)   // the head below names the playlist
        Loaded(state, retry = { attemptNo++ }) { (playlist, _) ->
            ReorderList(
                items = rows,
                key = { i, t -> "${t.id}:$i" },
                onMove = { from, to -> save(Reorder.move(rows, from, to)) },
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 8.dp),
                header = {
                    item {
                        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(120.dp)) {
                                val ids = rows.filter { it.hasCover }.take(2).map { it.id }
                                if (ids.size == 2) Cover(ids[1], 92.dp, Modifier.size(92.dp).align(Alignment.BottomEnd), title = playlist.name)
                                Cover(ids.firstOrNull(), 92.dp, Modifier.size(92.dp).align(Alignment.TopStart), title = playlist.name)
                            }
                            Spacer(Modifier.width(16.dp))
                            Column(Modifier.weight(1f)) {
                                Eyebrow("Playlist")
                                Text(playlist.name, Modifier.padding(top = 4.dp), style = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 25.sp, color = f.ink), maxLines = 3, overflow = TextOverflow.Ellipsis)
                                playlist.description?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 14.sp, color = f.muted), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                                Eyebrow("${count(rows.size)} · ${formatHM(rows.sumOf { it.durationMs })}", Modifier.padding(top = 4.dp))
                                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TButton(primary = true, enabled = rows.isNotEmpty(), onClick = { controller?.playQueue(rows, 0, context) }) {
                                        Icon(Glyphs.Play, contentDescription = null, modifier = Modifier.size(14.dp)); Text("Play")
                                    }
                                    TButton(enabled = rows.isNotEmpty(), onClick = { controller?.playQueue(rows.shuffled(), 0, context) }) {
                                        Icon(Glyphs.Shuffle, contentDescription = "Shuffle ${playlist.name}", modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                        note?.let { Text(it, Modifier.padding(horizontal = 8.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = f.secondary)) }
                        if (rows.isEmpty()) Hush("No tracks yet. Add some with ⋮ on any track.", Modifier.padding(16.dp))
                    }
                },
            ) { i, t, grip, lifted ->
                TrackRow(
                    title = t.title, subtitle = t.byline(), durationMs = t.durationMs,
                    playing = now?.trackId == t.id, showCover = true, coverId = t.id.takeIf { t.hasCover },
                    onClick = { controller?.playQueue(rows, i, context) },
                    onMenu = { menu = TrackTarget.of(t) },
                    modifier = Modifier
                        .then(if (lifted) Modifier.drawBehind { boxShadow(f.ink.copy(alpha = 0.22f), JkRadius.base, 14.dp, dy = 4.dp) } else Modifier)
                        .clip(RoundedCornerShape(JkRadius.base))
                        .background(if (lifted) f.paper else Color.Transparent),
                    start = {
                        Box(grip.width(34.dp).heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
                            Icon(Glyphs.Grip, contentDescription = "Reorder ${t.title}", tint = if (lifted) f.accent else f.faint, modifier = Modifier.size(18.dp))
                        }
                    },
                    end = {
                        IconButton(onClick = { save(rows.filterIndexed { j, _ -> j != i }) }, modifier = Modifier.alpha(0.5f)) {
                            Icon(Glyphs.Close, contentDescription = "Remove ${t.title} from the playlist", tint = f.ink)
                        }
                    },
                )
            }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}
