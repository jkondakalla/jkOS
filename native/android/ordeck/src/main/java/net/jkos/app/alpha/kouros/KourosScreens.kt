package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.session.MediaController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A track's cover ([id] is a track id), or a book's when [book]. No id: the empty tile. */
@Composable
fun Cover(id: Long?, size: Dp, modifier: Modifier = Modifier, book: Boolean = false) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val bitmap by produceState<ImageBitmap?>(null, id, px, book) {
        value = id?.let { Covers.load(it, px, book)?.asImageBitmap() }
    }
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        bitmap?.let {
            Image(bitmap = it, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

/** KourOS's screens, as entries of its tab's back stack. */
sealed interface KourosScreen : Screen {
    data object Library : KourosScreen
    data class ArtistPage(val artist: String) : KourosScreen
    data class AlbumPage(val album: String, val artist: String) : KourosScreen
    data object NowPlayingPage : KourosScreen
    data object QueuePage : KourosScreen
    data object PlaylistsPage : KourosScreen
    data class PlaylistPage(val id: Long, val name: String) : KourosScreen
    data class BookPage(val id: Long, val title: String) : KourosScreen

    /** A search keeps what was typed while an album or artist opened from it is on top. */
    class Search : KourosScreen {
        var query by mutableStateOf("")
    }
}

/** The KourOS tab: whichever of its screens is on top of the tab's stack. */
@Composable
fun KourosTab(screen: Screen, nav: Nav, controller: MediaController?, now: NowPlaying?) {
    when (screen) {
        is KourosScreen.ArtistPage -> ArtistScreen(screen.artist, nav::pop, nav::push)
        is KourosScreen.AlbumPage -> AlbumScreen(screen.album, screen.artist, controller, now, nav::pop, nav::push)
        KourosScreen.NowPlayingPage -> NowPlayingScreen(controller, now, nav::pop, nav::push)
        KourosScreen.QueuePage -> QueueScreen(controller, nav::pop)
        KourosScreen.PlaylistsPage -> PlaylistsScreen(nav::pop, nav::push)
        is KourosScreen.PlaylistPage -> PlaylistScreen(screen, controller, now, nav::pop, nav::push)
        is KourosScreen.Search -> SearchScreen(screen, controller, now, nav::pop, nav::push)
        is KourosScreen.BookPage -> BookScreen(screen, controller, now, nav::pop)
        else -> LibraryScreen(nav::push)
    }
}

// ── Library: Albums | Artists ──────────────────────────────────────────────────

private const val PAGE = 120

@Composable
private fun LibraryScreen(push: (Screen) -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("added") }

    Column(Modifier.fillMaxSize()) {
        Header("KourOS", onBack = null) {
            IconButton(onClick = { push(KourosScreen.Search()) }) { Icon(Glyphs.Search, contentDescription = "Search") }
            IconButton(onClick = { push(KourosScreen.PlaylistsPage) }) { Icon(Glyphs.Playlist, contentDescription = "Playlists") }
            IconButton(onClick = { push(KourosScreen.QueuePage) }) { Icon(Glyphs.Queue, contentDescription = "Queue") }
        }
        Row(Modifier.padding(horizontal = 8.dp)) {
            Choice("Albums", tab == 0) { tab = 0 }
            Choice("Artists", tab == 1) { tab = 1 }
            Choice("Books", tab == 2) { tab = 2 }
        }
        OutlinedTextField(
            value = query, onValueChange = { query = it }, singleLine = true,
            placeholder = { Text(when (tab) { 0 -> "Search albums"; 1 -> "Search artists"; else -> "Search books by title" }) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        if (tab == 0) {
            Row(Modifier.padding(horizontal = 8.dp)) {
                for ((key, label) in listOf("added" to "Added", "title" to "Title", "artist" to "Artist", "year" to "Year")) {
                    Choice(label, sort == key) { sort = key }
                }
            }
            AlbumGrid(query = query, artist = null, sort = sort, push = push)
        } else if (tab == 1) {
            ArtistList(query, push)
        } else {
            BooksPane(query, push)
        }
    }
}

@Composable
private fun AlbumGrid(query: String, artist: String?, sort: String, push: (Screen) -> Unit) {
    val albums = remember(query, artist, sort) { mutableStateListOf<Album>() }
    var state by remember(query, artist, sort) { mutableStateOf<Load<Unit>>(Load.Loading) }
    var more by remember(query, artist, sort) { mutableStateOf(false) }
    var attemptNo by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(query, artist, sort, attemptNo) {
        if (query.isNotEmpty()) delay(300) // typing: wait for a pause
        state = Load.Loading
        state = attempt {
            val page = KourosApi.albums(q = query, artist = artist, sort = sort, limit = PAGE)
            albums.clear()
            albums.addAll(page)
            more = page.size == PAGE
        }
    }
    Loaded(state, retry = { attemptNo++ }) {
        if (albums.isEmpty()) {
            Text("No albums.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Loaded
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(albums, key = { "${it.artist}\u0000${it.album}" }) { a ->
                Column(Modifier.clickable { push(KourosScreen.AlbumPage(a.album, a.artist)) }) {
                    Cover(a.coverId, 150.dp, Modifier.fillMaxWidth().aspectRatio(1f))
                    Spacer(Modifier.height(6.dp))
                    Text(a.album, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(a.artist.takeIf { artist == null }, a.year?.toString()).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (more) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    TextButton(onClick = {
                        scope.launch {
                            val next = attempt { KourosApi.albums(q = query, artist = artist, sort = sort, limit = PAGE, offset = albums.size) }
                            if (next is Load.Ready) {
                                albums.addAll(next.value)
                                more = next.value.size == PAGE
                            }
                        }
                    }) { Text("Load more") }
                }
            }
        }
    }
}

@Composable
private fun ArtistList(query: String, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    val state by produceState<Load<List<Artist>>>(Load.Loading, query, attemptNo) {
        if (query.isNotEmpty()) delay(300)
        value = Load.Loading
        value = attempt { KourosApi.artists(q = query) }
    }
    Loaded(state, retry = { attemptNo++ }) { artists ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(artists, key = { it.artist }) { a ->
                Row(
                    Modifier.fillMaxWidth().clickable { push(KourosScreen.ArtistPage(a.artist)) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(a.coverId, 48.dp, Modifier.size(48.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.artist, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${a.albums} album${if (a.albums == 1) "" else "s"} · ${a.tracks} tracks",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// ── Artist: their albums ───────────────────────────────────────────────────────

@Composable
private fun ArtistScreen(artist: String, onBack: () -> Unit, push: (Screen) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Header(artist, onBack)
        AlbumGrid(query = "", artist = artist, sort = "year", push = push)
    }
}

// ── Album: its tracks; a tap plays the album from there ────────────────────────

@Composable
private fun AlbumScreen(album: String, artist: String, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    val state by produceState<Load<List<Track>>>(Load.Loading, album, artist, attemptNo) {
        value = attempt { KourosApi.albumTracks(album, artist) }
    }
    val context = PlayContext.album(artist, album)
    Column(Modifier.fillMaxSize()) {
        Header(album, onBack) {
            (state as? Load.Ready)?.value?.takeIf { it.isNotEmpty() }?.let { tracks ->
                IconButton(onClick = { menu = TrackTarget(tracks, album, artist, context, artist, null) }) {
                    Icon(Glyphs.More, contentDescription = "More for $album")
                }
            }
        }
        Loaded(state, retry = { attemptNo++ }) { tracks ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 8.dp)) {
                item {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(tracks.firstOrNull { it.hasCover }?.id, 120.dp, Modifier.size(120.dp))
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(artist, style = MaterialTheme.typography.titleMedium)
                            Text(
                                listOfNotNull(tracks.firstNotNullOfOrNull { it.year }?.toString(), "${tracks.size} tracks").joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                itemsIndexed(tracks, key = { _, t -> t.id }) { i, t ->
                    TrackRow(
                        title = t.title,
                        subtitle = t.artist?.takeIf { it != artist },
                        durationMs = t.durationMs,
                        playing = now?.trackId == t.id,
                        lead = t.trackNo?.toString(),
                        onClick = controller?.let { c -> { c.playQueue(tracks, i, context) } },
                        onMenu = { menu = TrackTarget(listOf(t), t.title, t.byline(), null, artist, null) },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
            }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}

// ── the player: a bar at the bottom, and a full screen ─────────────────────────

@Composable
private fun TransportButton(glyph: ImageVector, label: String, enabled: Boolean = true, size: Dp = 48.dp, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(size)) {
        Icon(glyph, contentDescription = label, modifier = Modifier.size(size * 0.6f))
    }
}

@Composable
fun MiniPlayer(now: NowPlaying, controller: MediaController?, open: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).clickable(onClick = open).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(now.coverId, 44.dp, Modifier.size(44.dp), book = now.book != null)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(now.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            Text(now.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TransportButton(if (now.isPlaying) Glyphs.Pause else Glyphs.Play, if (now.isPlaying) "Pause" else "Play") {
            controller?.let { if (it.isPlaying) it.pause() else it.play() }
        }
        TransportButton(Glyphs.Next, "Next", enabled = now.hasNext) { controller?.seekToNextMediaItem() }
    }
}

@Composable
private fun NowPlayingScreen(controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    val scope = rememberCoroutineScope()
    var radioNote by remember { mutableStateOf<String?>(null) }
    var devices by remember { mutableStateOf(false) }
    val remote = rememberIsRemote()
    if (devices) DevicesDialog { devices = false }
    Column(Modifier.fillMaxSize()) {
        Header("Now playing", onBack) {
            TextButton(onClick = { devices = true }) { Text("Devices") }
            IconButton(onClick = { push(KourosScreen.QueuePage) }) { Icon(Glyphs.Queue, contentDescription = "Queue") }
        }
        if (remote) {
            RemoteNowPlaying()
            return@Column
        }
        if (now == null || controller == null) {
            Text("Nothing is playing.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        if (now.book != null) {
            BookNowPlaying(controller, now, now.book)
            return@Column
        }
        val position = rememberPosition(controller, now.isPlaying)
        var dragging by remember { mutableStateOf<Float?>(null) }
        Column(
            Modifier.fillMaxSize().padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Cover(now.coverId, 320.dp, Modifier.fillMaxWidth().aspectRatio(1f))
            Spacer(Modifier.height(20.dp))
            Text(now.title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(now.artist, now.album).filter { it.isNotEmpty() }.joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            val duration = now.durationMs.coerceAtLeast(1L)
            Slider(
                value = dragging ?: (position.toFloat() / duration).coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    dragging?.let { controller.seekTo((it * duration).toLong()) }
                    dragging = null
                },
                enabled = now.durationMs > 0,
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatTime(dragging?.let { (it * duration).toLong() } ?: position), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.weight(1f))
                Text(formatTime(now.durationMs), style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                TransportButton(Glyphs.Previous, "Previous", enabled = now.hasPrevious, size = 56.dp) { controller.seekToPrevious() }
                TransportButton(if (now.isPlaying) Glyphs.Pause else Glyphs.Play, if (now.isPlaying) "Pause" else "Play", size = 72.dp) {
                    if (controller.isPlaying) controller.pause() else controller.play()
                }
                TransportButton(Glyphs.Next, "Next", enabled = now.hasNext, size = 56.dp) { controller.seekToNextMediaItem() }
            }
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = {
                val seed = now.trackId ?: return@OutlinedButton
                radioNote = "Building a station…"
                scope.launch {
                    when (val r = attempt { KourosApi.radio(seed) }) {
                        is Load.Ready -> {
                            controller.continueAsStation(seed, r.value)
                            radioNote = if (r.value.isEmpty()) "No station for this track yet." else "Station: ${r.value.size} tracks queued."
                        }
                        is Load.Failed -> radioNote = r.message
                        Load.Loading -> Unit
                    }
                }
            }) {
                Icon(Glyphs.Radio, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Start radio")
            }
            radioNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

