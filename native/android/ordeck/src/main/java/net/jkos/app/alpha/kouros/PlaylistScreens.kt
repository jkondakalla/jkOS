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
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.Field
import net.jkos.app.alpha.look.TButton

private fun count(n: Int) = "$n track${if (n == 1) "" else "s"}"

// ── the person's playlists: make, rename, delete ───────────────────────────────

/** Playlists (apps/kouros/src/views/playlists/Playlists.tsx): every write reloads the list. */
@Composable
fun PlaylistsScreen(onBack: () -> Unit, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<Playlist>>>(Load.Loading) }
    var creating by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf<Playlist?>(null) }
    var deleting by remember { mutableStateOf<Playlist?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(attemptNo) { state = attempt { KourosApi.playlists() } }

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
            TButton(quiet = true, onClick = { creating = !creating }) { Text(if (creating) "Cancel" else "New") }
        }
        if (creating) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
        note?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.secondary) }
        Loaded(state, retry = { attemptNo++ }) { playlists ->
            if (playlists.isEmpty()) {
                Text("No playlists yet. Make one with New.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Loaded
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                items(playlists, key = { it.id }) { p ->
                    PlaylistRow(p, open = { push(KourosScreen.PlaylistPage(p.id, p.name)) }, rename = { renaming = p }, delete = { deleting = p })
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
            }
        }
    }

    renaming?.let { p ->
        var name by remember(p.id) { mutableStateOf(p.name) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Rename playlist") },
            text = { Field(value = name, onValueChange = { name = it.take(200) }, singleLine = true) },
            confirmButton = {
                TButton(quiet = true, enabled = name.isNotBlank() && !busy, onClick = {
                    val n = name.trim()
                    write(after = { renaming = null }) { KourosApi.updatePlaylist(p.id, name = n) }
                }) { Text("Save") }
            },
            dismissButton = { TButton(quiet = true, onClick = { renaming = null }) { Text("Cancel") } },
        )
    }
    deleting?.let { p ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete “${p.name}”?") },
            text = { Text("The playlist goes. Its tracks stay in your library.") },
            confirmButton = {
                TButton(quiet = true, enabled = !busy, onClick = { write(after = { deleting = null }) { KourosApi.deletePlaylist(p.id) } }) { Text("Delete") }
            },
            dismissButton = { TButton(quiet = true, onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PlaylistRow(p: Playlist, open: () -> Unit, rename: () -> Unit, delete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = open).padding(start = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Glyphs.Playlist, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(p.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(count(p.trackRefs.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Glyphs.More, contentDescription = "More for ${p.name}") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename() })
                DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; delete() })
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
fun PlaylistScreen(page: KourosScreen.PlaylistPage, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<Playlist, List<Track>>>>(Load.Loading) }
    var rows by remember { mutableStateOf<List<Track>>(emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    val scope = rememberCoroutineScope()
    val context = PlayContext.playlist(page.id)

    LaunchedEffect(page.id, attemptNo) {
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

    val title = (state as? Load.Ready)?.value?.first?.name ?: page.name
    Column(Modifier.fillMaxSize()) {
        Header(title, onBack)
        Loaded(state, retry = { attemptNo++ }) { (playlist, _) ->
            ReorderList(
                items = rows,
                key = { i, t -> "${t.id}:$i" },
                onMove = { from, to -> save(Reorder.move(rows, from, to)) },
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 8.dp),
                header = {
                    item {
                        Column(Modifier.padding(16.dp)) {
                            playlist.description?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(
                                "${count(rows.size)} · ${formatTime(rows.sumOf { it.durationMs })}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            TButton(primary = true, enabled = rows.isNotEmpty() && controller != null, onClick = { controller?.playQueue(rows, 0, context) }) {
                                Icon(Glyphs.Play, contentDescription = null)
                                Text("Play")
                            }
                            note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                            if (rows.isEmpty()) {
                                Text("No tracks yet. Add some with ⋮ on any track.", Modifier.padding(top = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                },
            ) { i, t, grip, lifted ->
                TrackRow(
                    title = t.title, subtitle = t.byline(), durationMs = t.durationMs,
                    playing = now?.trackId == t.id, lead = "${i + 1}",
                    onClick = controller?.let { c -> { c.playQueue(rows, i, context) } },
                    onMenu = { menu = TrackTarget.of(t) },
                    modifier = Modifier.background(if (lifted) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background),
                    start = { Icon(Glyphs.Grip, contentDescription = "Reorder ${t.title}", modifier = grip.padding(12.dp)) },
                    end = {
                        IconButton(onClick = { save(rows.filterIndexed { j, _ -> j != i }) }) {
                            Icon(Glyphs.Close, contentDescription = "Remove ${t.title} from the playlist")
                        }
                    },
                )
            }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}
