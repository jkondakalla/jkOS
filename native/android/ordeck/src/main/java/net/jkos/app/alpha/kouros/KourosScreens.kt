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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

/**
 * A track's cover ([id] is a track id), or a book's when [book]: a sleeve on card stock with a
 * soft shadow (the web's CoverArt). With no art, the tile shows the title's initial ([title]).
 */
@Composable
fun Cover(id: Long?, size: Dp, modifier: Modifier = Modifier, book: Boolean = false, title: String? = null) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val bitmap by produceState<ImageBitmap?>(null, id, px, book) {
        value = id?.let { Covers.load(it, px, book)?.asImageBitmap() }
    }
    val face = Jk.face
    val r = if (size >= 96.dp) 10.dp else 6.dp
    Box(
        modifier
            .drawBehind { boxShadow(Color.Black.copy(alpha = if (face.dark) 0.45f else 0.18f), r, if (size >= 96.dp) 18.dp else 6.dp, dy = if (size >= 96.dp) 6.dp else 2.dp) }
            .clip(RoundedCornerShape(r))
            .background(Brush.linearGradient(listOf(face.card2, face.card.mix(70.0, face.paper2)))),
        contentAlignment = Alignment.Center,
    ) {
        val art = bitmap
        if (art != null) {
            Image(bitmap = art, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else if (!title.isNullOrBlank() && size >= 40.dp) {
            Text(
                title.trim().take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium.copy(fontSize = (size.value * 0.16f).coerceIn(12f, 40f).sp, color = face.faint),
            )
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

/** The library. [preAlbums] draws the grid from a sample instead of asking KourOS (ScreensTest). */
@Composable
internal fun LibraryScreen(push: (Screen) -> Unit, preAlbums: List<Album>? = null) {
    var tab by remember { mutableIntStateOf(0) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("added") }

    Column(Modifier.fillMaxSize()) {
        Header("KourOS", onBack = null) {
            IconButton(onClick = { push(KourosScreen.Search()) }) { Icon(Glyphs.Search, contentDescription = "Search") }
            IconButton(onClick = { push(KourosScreen.PlaylistsPage) }) { Icon(Glyphs.Playlist, contentDescription = "Playlists") }
            IconButton(onClick = { push(KourosScreen.QueuePage) }) { Icon(Glyphs.Queue, contentDescription = "Queue") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            MastTab("Albums", tab == 0, { tab = 0 }, Modifier.weight(1f), sub = "Sleeves")
            MastTab("Artists", tab == 1, { tab = 1 }, Modifier.weight(1f), sub = "A–Z")
            MastTab("Books", tab == 2, { tab = 2 }, Modifier.weight(1f), sub = "Audiobooks")
        }
        Field(
            value = query, onValueChange = { query = it }, singleLine = true,
            placeholder = { Text(when (tab) { 0 -> "Search albums"; 1 -> "Search artists"; else -> "Search books by title" }) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        if (tab == 0) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((key, label) in listOf("added" to "Added", "title" to "Title", "artist" to "Artist", "year" to "Year")) {
                    Choice(label, sort == key) { sort = key }
                }
            }
            if (preAlbums != null) AlbumTiles(preAlbums, showArtist = true, more = false, push = push) {}
            else AlbumGrid(query = query, artist = null, sort = sort, push = push)
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
            Hush("No albums.", Modifier.padding(24.dp))
            return@Loaded
        }
        AlbumTiles(albums, showArtist = artist == null, more = more, push = push) {
            scope.launch {
                val next = attempt { KourosApi.albums(q = query, artist = artist, sort = sort, limit = PAGE, offset = albums.size) }
                if (next is Load.Ready) {
                    albums.addAll(next.value)
                    more = next.value.size == PAGE
                }
            }
        }
    }
}

/** The album grid itself: sleeves on their shadows, the title in Fraunces, artist and year under it. */
@Composable
internal fun AlbumTiles(albums: List<Album>, showArtist: Boolean, more: Boolean, push: (Screen) -> Unit, onMore: () -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(albums, key = { "${it.artist}\u0000${it.album}" }) { a ->
            Column(Modifier.clickable { push(KourosScreen.AlbumPage(a.album, a.artist)) }) {
                Cover(a.coverId, 150.dp, Modifier.fillMaxWidth().aspectRatio(1f), title = a.album)
                Spacer(Modifier.height(8.dp))
                Text(a.album, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(a.artist.takeIf { showArtist }, a.year?.toString()).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Jk.face.muted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (more) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                TButton(quiet = true, onClick = onMore) { Text("Load more") }
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
                    Cover(a.coverId, 48.dp, Modifier.size(48.dp), title = a.artist)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.artist, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Eyebrow("${a.albums} album${if (a.albums == 1) "" else "s"} · ${a.tracks} tracks", size = 9.sp)
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
                        Cover(tracks.firstOrNull { it.hasCover }?.id, 128.dp, Modifier.size(128.dp), title = album)
                        Spacer(Modifier.width(18.dp))
                        Column {
                            Eyebrow("Album")
                            Gap(4)
                            Text(artist, style = MaterialTheme.typography.headlineSmall)
                            Gap(4)
                            Eyebrow(listOfNotNull(tracks.firstNotNullOfOrNull { it.year }?.toString(), "${tracks.size} tracks").joinToString(" · "))
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
                    Rule(Modifier.padding(horizontal = 16.dp))
                }
            }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}

// ── the player: a bar at the bottom, and a full screen ─────────────────────────

@Composable
internal fun TransportButton(glyph: ImageVector, label: String, enabled: Boolean = true, size: Dp = 48.dp, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(size)) {
        Icon(glyph, contentDescription = label, modifier = Modifier.size(size * 0.5f), tint = if (enabled) Jk.face.ink else Jk.face.ghost)
    }
}

@Composable
fun MiniPlayer(now: NowPlaying, controller: MediaController?, open: () -> Unit) {
    // The web's now card: a sheet with the sleeve, the title in Fraunces and the artist under it.
    Sheet(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), padding = PaddingValues(0.dp)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(now.coverId, 44.dp, Modifier.size(44.dp), book = now.book != null, title = now.title)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(now.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                Text(now.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = Jk.face.muted)
            }
            Knob({ controller?.let { if (it.isPlaying) it.pause() else it.play() } }, if (now.isPlaying) "Pause" else "Play", size = 40.dp) {
                Icon(if (now.isPlaying) Glyphs.Pause else Glyphs.Play, contentDescription = null, modifier = Modifier.size(18.dp))
            }
            TransportButton(Glyphs.Next, "Next", enabled = now.hasNext) { controller?.seekToNextMediaItem() }
        }
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
            TButton(quiet = true, onClick = { devices = true }) { Text("Devices") }
            IconButton(onClick = { push(KourosScreen.QueuePage) }) { Icon(Glyphs.Queue, contentDescription = "Queue") }
        }
        if (remote) {
            RemoteNowPlaying()
            return@Column
        }
        if (now == null || controller == null) {
            Hush("Nothing is playing.", Modifier.padding(24.dp))
            return@Column
        }
        if (now.book != null) {
            BookNowPlaying(controller, now, now.book)
            return@Column
        }
        val position = rememberPosition(controller, now.isPlaying)
        NowPlayingBody(
            now, position, radioNote,
            onSeek = { controller.seekTo(it) },
            onToggle = { if (controller.isPlaying) controller.pause() else controller.play() },
            onPrevious = { controller.seekToPrevious() },
            onNext = { controller.seekToNextMediaItem() },
            onRadio = {
                val seed = now.trackId
                if (seed != null) {
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
                }
            },
        )
    }
}

/**
 * The player's face (the web's kouros-now page): the sleeve large on its shadow, the title in
 * Fraunces over the artist and album, the fader with mono times, the transport with the lit knob
 * at its centre, and "start a station" in tracked caps. Plain values in, so it can be drawn
 * without a player (ScreensTest).
 */
@Composable
internal fun NowPlayingBody(
    now: NowPlaying, position: Long, radioNote: String?,
    onSeek: (Long) -> Unit, onToggle: () -> Unit, onPrevious: () -> Unit, onNext: () -> Unit, onRadio: () -> Unit,
) {
    val face = Jk.face
    var dragging by remember { mutableStateOf<Float?>(null) }
    Column(
        Modifier.fillMaxSize().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Gap(8)
        Cover(now.coverId, 320.dp, Modifier.fillMaxWidth().aspectRatio(1f), book = now.book != null, title = now.title)
        Gap(22)
        Text(now.title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Gap(2)
        Text(
            listOf(now.artist, now.album).filter { it.isNotEmpty() }.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium, color = face.muted,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Gap(14)
        val duration = now.durationMs.coerceAtLeast(1L)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(formatTime(dragging?.let { (it * duration).toLong() } ?: position), size = 9.sp)
            JkSlider(
                value = dragging ?: (position.toFloat() / duration).coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    dragging?.let { onSeek((it * duration).toLong()) }
                    dragging = null
                },
                enabled = now.durationMs > 0,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
            )
            Eyebrow(formatTime(now.durationMs), size = 9.sp)
        }
        Gap(6)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
            TransportButton(Glyphs.Previous, "Previous", enabled = now.hasPrevious, size = 56.dp, onClick = onPrevious)
            Knob(onToggle, if (now.isPlaying) "Pause" else "Play", size = 68.dp) {
                Icon(if (now.isPlaying) Glyphs.Pause else Glyphs.Play, contentDescription = null, modifier = Modifier.size(28.dp))
            }
            TransportButton(Glyphs.Next, "Next", enabled = now.hasNext, size = 56.dp, onClick = onNext)
        }
        Gap(14)
        Row(
            Modifier.clip(RoundedCornerShape(JkRadius.sm)).clickable(enabled = now.trackId != null, onClick = onRadio).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Glyphs.Radio, contentDescription = null, modifier = Modifier.size(18.dp), tint = face.muted)
            Spacer(Modifier.width(10.dp))
            Text("START A STATION FROM THIS", style = MaterialTheme.typography.labelMedium.copy(color = face.ink, fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium))
        }
        radioNote?.let { Hush(it) }
    }
}

