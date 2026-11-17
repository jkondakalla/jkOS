package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.session.MediaController
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

/** What one search found, in the three shapes the web's Search.tsx shows. */
private data class Found(val artists: List<Artist>, val albums: List<Album>, val tracks: List<Track>) {
    val isEmpty get() = artists.isEmpty() && albums.isEmpty() && tracks.isEmpty()
}

/** At most this many tracks are drawn, as on the web; the dataset's title filter is a prefix match. */
private const val TRACKS_SHOWN = 30
private const val DEBOUNCE_MS = 220L

/**
 * Search across artists, albums and tracks at once (apps/kouros/src/views/Search.tsx). All
 * three requests go out together. Albums and artists are the browse routes' substring match;
 * tracks are the `tracks` dataset's title prefix. One shape failing leaves the other two; all
 * three failing is an error.
 */
@Composable
fun SearchScreen(page: KourosScreen.Search, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var term by remember { mutableStateOf(page.query.trim()) }
    var state by remember { mutableStateOf<Load<Found>?>(null) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { if (page.query.isEmpty()) focus.requestFocus() }
    LaunchedEffect(page.query) {
        delay(DEBOUNCE_MS)
        term = page.query.trim()
    }
    LaunchedEffect(term) {
        if (term.isEmpty()) { state = null; return@LaunchedEffect }
        state = Load.Loading
        state = attempt {
            coroutineScope {
                val t = async { runCatching { KourosApi.searchTracks(term).take(TRACKS_SHOWN) } }
                val al = async { runCatching { KourosApi.albums(q = term, sort = "title", limit = 12) } }
                val ar = async { runCatching { KourosApi.artists(q = term, limit = 12) } }
                val (tr, alr, arr) = Triple(t.await(), al.await(), ar.await())
                if (tr.isFailure && alr.isFailure && arr.isFailure) throw tr.exceptionOrNull()!!
                Found(arr.getOrDefault(emptyList()), alr.getOrDefault(emptyList()), tr.getOrDefault(emptyList()))
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header("Search", onBack)
        OutlinedTextField(
            value = page.query, onValueChange = { page.query = it }, singleLine = true,
            placeholder = { Text("Artists, albums, tracks…") },
            trailingIcon = {
                if (page.query.isNotEmpty()) {
                    IconButton(onClick = { page.query = "" }) { Icon(Glyphs.Close, contentDescription = "Clear search") }
                }
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus),
        )
        when (val s = state) {
            null -> Hint("Search your library by artist, album or track.")
            Load.Loading -> CircularProgressIndicator(Modifier.padding(24.dp).align(Alignment.CenterHorizontally))
            is Load.Failed -> Hint("Search failed. Try again shortly.")
            is Load.Ready -> if (s.value.isEmpty) Hint("Nothing matches “$term”.") else Results(s.value, controller, now, push) { menu = it }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}

@Composable
private fun Hint(text: String) {
    Text(text, Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Results(found: Found, controller: MediaController?, now: NowPlaying?, push: (Screen) -> Unit, onMenu: (TrackTarget) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 8.dp)) {
        if (found.artists.isNotEmpty()) {
            item { Section("Artists") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(found.artists, key = { it.artist }) { a ->
                        Column(Modifier.width(104.dp).clickable { push(KourosScreen.ArtistPage(a.artist)) }) {
                            Cover(a.coverId, 104.dp, Modifier.size(104.dp))
                            Text(a.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
        if (found.albums.isNotEmpty()) {
            item { Section("Albums") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(found.albums, key = { "${it.artist}\u0000${it.album}" }) { a ->
                        Column(Modifier.width(132.dp).clickable { push(KourosScreen.AlbumPage(a.album, a.artist)) }) {
                            Cover(a.coverId, 132.dp, Modifier.size(132.dp))
                            Text(a.album, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                            Text(a.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (found.tracks.isNotEmpty()) {
            item { Section("Tracks") }
            itemsIndexed(found.tracks, key = { _, t -> t.id }) { i, t ->
                TrackRow(
                    title = t.title, subtitle = t.byline(), durationMs = t.durationMs,
                    playing = now?.trackId == t.id, showCover = true, coverId = t.id.takeIf { t.hasCover },
                    // A search result is an ad-hoc list: it plays with no context (history.context).
                    onClick = controller?.let { c -> { c.playQueue(found.tracks, i, null) } },
                    onMenu = { onMenu(TrackTarget.of(t)) },
                )
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp), style = MaterialTheme.typography.titleMedium)
}
