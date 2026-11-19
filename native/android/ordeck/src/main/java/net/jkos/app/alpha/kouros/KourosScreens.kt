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
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
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
    /**
     * The tab's first screen: Home, the albums, the artists or the books (the web's Home,
     * Library and Books). It keeps which one is up, what was typed and how the albums sort, so
     * coming back from an album finds them as they were.
     */
    class Root(section: Int = HOME) : KourosScreen {
        var section by mutableIntStateOf(section)
        var query by mutableStateOf("")
        var sort by mutableStateOf("added")
        val shelf = AlbumShelf()

        companion object {
            const val HOME = 0
            const val ALBUMS = 1
            const val ARTISTS = 2
            const val BOOKS = 3
        }
    }
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
        is KourosScreen.ArtistPage -> ArtistScreen(screen.artist, controller, now, nav::pop, nav::push)
        is KourosScreen.AlbumPage -> AlbumScreen(screen.album, screen.artist, controller, now, nav::pop, nav::push)
        KourosScreen.NowPlayingPage -> NowPlayingScreen(controller, now, nav::pop, nav::push)
        KourosScreen.QueuePage -> QueueScreen(controller, nav::pop)
        KourosScreen.PlaylistsPage -> PlaylistsScreen(nav::pop, nav::push)
        is KourosScreen.PlaylistPage -> PlaylistScreen(screen, controller, now, nav::pop, nav::push)
        is KourosScreen.Search -> SearchScreen(screen, controller, now, nav::pop, nav::push)
        is KourosScreen.BookPage -> BookScreen(screen, controller, now, nav::pop)
        is KourosScreen.Root -> LibraryScreen(screen, controller, now, nav::push, onBack = if (nav.canPop) nav::pop else null)
        else -> LibraryScreen(KourosScreen.Root(), controller, now, nav::push)
    }
}

// ── the tab's first screen: Home | Albums | Artists | Books ────────────────────

private const val PAGE = 120

/**
 * KourOS's first screen: the masthead's four sections over the one that's up. [preAlbums] and
 * [preHome] draw from a sample instead of asking KourOS (ScreensTest).
 */
@Composable
internal fun LibraryScreen(
    root: KourosScreen.Root, controller: MediaController?, now: NowPlaying?, push: (Screen) -> Unit,
    onBack: (() -> Unit)? = null, preAlbums: List<Album>? = null, preHome: DiscoverHome? = null,
) {
    val tab = root.section
    Column(Modifier.fillMaxSize()) {
        Header("KourOS", onBack = onBack) {
            IconButton(onClick = { push(KourosScreen.Search()) }) { Icon(Glyphs.Search, contentDescription = "Search") }
            IconButton(onClick = { push(KourosScreen.PlaylistsPage) }) { Icon(Glyphs.Playlist, contentDescription = "Playlists") }
            IconButton(onClick = { push(KourosScreen.QueuePage) }) { Icon(Glyphs.Queue, contentDescription = "Queue") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            MastTab("Home", tab == KourosScreen.Root.HOME, { root.section = KourosScreen.Root.HOME }, Modifier.weight(1f), sub = "For you")
            MastTab("Albums", tab == KourosScreen.Root.ALBUMS, { root.section = KourosScreen.Root.ALBUMS }, Modifier.weight(1f), sub = "Sleeves")
            MastTab("Artists", tab == KourosScreen.Root.ARTISTS, { root.section = KourosScreen.Root.ARTISTS }, Modifier.weight(1f), sub = "A–Z")
            MastTab("Books", tab == KourosScreen.Root.BOOKS, { root.section = KourosScreen.Root.BOOKS }, Modifier.weight(1f), sub = "Audio")
        }
        if (tab == KourosScreen.Root.HOME) {
            HomePane(controller, now, push, pre = preHome)
            return@Column
        }
        Field(
            value = root.query, onValueChange = { root.query = it }, singleLine = true,
            placeholder = { Text(when (tab) { KourosScreen.Root.ALBUMS -> "Search albums"; KourosScreen.Root.ARTISTS -> "Search artists"; else -> "Search books by title" }) },
            trailingIcon = {
                if (root.query.isNotEmpty()) IconButton(onClick = { root.query = "" }) { Icon(Glyphs.Close, contentDescription = "Clear") }
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        when (tab) {
            KourosScreen.Root.ALBUMS -> {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((key, label) in listOf("added" to "Added", "title" to "Title", "artist" to "Artist", "year" to "Year")) {
                        Choice(label, root.sort == key) { root.sort = key }
                    }
                }
                if (preAlbums != null) AlbumTiles(preAlbums, showArtist = true, more = false, push = push) {}
                else AlbumGrid(query = root.query, artist = null, sort = root.sort, push = push, shelf = root.shelf)
            }
            KourosScreen.Root.ARTISTS -> ArtistList(root.query, push)
            else -> BooksPane(root.query, push)
        }
    }
}

/**
 * The albums a screen has read and where its grid is scrolled, kept on the screen (the tab's
 * root keeps one) so coming back from an album finds the grid where it was, without a reload.
 */
class AlbumShelf {
    val albums = mutableStateListOf<Album>()
    var key by mutableStateOf<String?>(null)
    var more by mutableStateOf(false)
    val grid = LazyGridState()
}

@Composable
private fun AlbumGrid(query: String, artist: String?, sort: String, push: (Screen) -> Unit, shelf: AlbumShelf = remember { AlbumShelf() }, header: (@Composable () -> Unit)? = null) {
    val key = "$query\u0000$artist\u0000$sort"
    var state by remember(key) { mutableStateOf<Load<Unit>>(if (shelf.key == key && shelf.albums.isNotEmpty()) Load.Ready(Unit) else Load.Loading) }
    var attemptNo by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(key, attemptNo) {
        if (attemptNo == 0 && shelf.key == key && shelf.albums.isNotEmpty()) return@LaunchedEffect   // held: draw it as it was
        if (query.isNotEmpty()) delay(300) // typing: wait for a pause
        state = Load.Loading
        state = attempt {
            val page = KourosApi.albums(q = query, artist = artist, sort = sort, limit = PAGE)
            shelf.albums.clear()
            shelf.albums.addAll(page)
            shelf.more = page.size == PAGE
            shelf.key = key
            shelf.grid.scrollToItem(0)
        }
    }
    Loaded(state, retry = { attemptNo++ }) {
        if (shelf.albums.isEmpty()) {
            Hush("No albums.", Modifier.padding(24.dp))
            return@Loaded
        }
        AlbumTiles(shelf.albums, showArtist = artist == null, more = shelf.more, push = push, grid = shelf.grid, header = header) {
            scope.launch {
                val next = attempt { KourosApi.albums(q = query, artist = artist, sort = sort, limit = PAGE, offset = shelf.albums.size) }
                if (next is Load.Ready) {
                    shelf.albums.addAll(next.value)
                    shelf.more = next.value.size == PAGE
                }
            }
        }
    }
}

/** The album grid itself: sleeves on their shadows, the title in Fraunces, artist and year under it. */
@Composable
internal fun AlbumTiles(
    albums: List<Album>, showArtist: Boolean, more: Boolean, push: (Screen) -> Unit,
    grid: LazyGridState = rememberLazyGridState(), header: (@Composable () -> Unit)? = null, onMore: () -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp),
        state = grid,
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        if (header != null) item(span = { GridItemSpan(maxLineSpan) }) { header() }
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

/**
 * An artist (the web's Artist.tsx): their sleeve in a round frame, how much of them the library
 * holds, Play and Shuffle across every album (read when pressed, not before), and the albums.
 */
@Composable
private fun ArtistScreen(artist: String, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val state by produceState<Load<List<Album>>>(Load.Loading, artist, attemptNo) {
        value = attempt { KourosApi.albums(artist = artist, sort = "year", limit = 500) }
    }
    fun playAll(albums: List<Album>, shuffled: Boolean) {
        val c = controller ?: return
        if (busy) return
        busy = true; note = null
        scope.launch {
            val r = attempt { albums.flatMap { a -> runCatching { KourosApi.albumTracks(a.album, a.artist) }.getOrDefault(emptyList()) } }
            busy = false
            when (r) {
                is Load.Ready -> if (r.value.isEmpty()) note = "No tracks to play." else c.playQueue(if (shuffled) r.value.shuffled() else r.value, 0, PlayContext.artist(artist))
                is Load.Failed -> note = r.message
                Load.Loading -> Unit
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Header("", onBack)   // the head below names the artist
        Loaded(state, retry = { attemptNo++ }) { albums ->
            if (albums.isEmpty()) { Hush("No albums for this artist.", Modifier.padding(24.dp)); return@Loaded }
            AlbumTiles(albums, showArtist = false, more = false, push = push, header = {
                Column {
                    DetailHead(
                        coverId = albums.firstNotNullOfOrNull { it.coverId }, round = true, kind = "Artist", title = artist, sub = null, onSub = null,
                        facts = listOf(count(albums.size, "album"), count(albums.sumOf { it.tracks }, "track"), formatHM(albums.sumOf { it.duration } * 1000)).joinToString(" · "),
                        busy = busy, onPlay = { playAll(albums, false) }, onShuffle = { playAll(albums, true) }, onMore = null,
                    )
                    note?.let { Hush(it) }
                }
            }) {}
        }
    }
}

private fun count(n: Int, noun: String) = "$n $noun${if (n == 1) "" else "s"}"

/**
 * A record's or an artist's head (the web's kr-detail-head): the sleeve, what it is in mono, its
 * name in the display serif, the artist (a link), the facts, and the actions — Play, Shuffle
 * (this record in a random order once, not the standing shuffle), and more.
 */
@Composable
private fun DetailHead(
    coverId: Long?, round: Boolean, kind: String, title: String, sub: String?, onSub: (() -> Unit)?, facts: String,
    busy: Boolean = false, onPlay: (() -> Unit)?, onShuffle: (() -> Unit)?, onMore: (() -> Unit)?,
) {
    val f = Jk.face
    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Cover(coverId, 128.dp, Modifier.size(128.dp).then(if (round) Modifier.clip(RoundedCornerShape(50)) else Modifier), title = title)
        Spacer(Modifier.width(18.dp))
        Column(Modifier.weight(1f)) {
            Eyebrow(kind)
            Gap(4)
            Text(title, style = androidx.compose.ui.text.TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 25.sp, color = f.ink), maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (sub != null) {
                Text(sub, Modifier.padding(top = 2.dp).clip(RoundedCornerShape(4.dp)).then(if (onSub != null) Modifier.clickable(onClick = onSub) else Modifier),
                    style = androidx.compose.ui.text.TextStyle(fontFamily = JkFonts.Sans, fontSize = 15.sp, color = f.accent), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Gap(4)
            Eyebrow(facts, maxLines = 2)
            Gap(10)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onPlay != null) TButton(primary = true, enabled = !busy, onClick = onPlay) {
                    Icon(Glyphs.Play, contentDescription = null, modifier = Modifier.size(14.dp)); Text(if (busy) "Loading…" else "Play")
                }
                if (onShuffle != null) TButton(enabled = !busy, onClick = onShuffle) { Icon(Glyphs.Shuffle, contentDescription = "Shuffle $title", modifier = Modifier.size(18.dp)) }
                if (onMore != null) TButton(onClick = onMore) { Icon(Glyphs.More, contentDescription = "More for $title", modifier = Modifier.size(18.dp)) }
            }
        }
    }
}

// ── Album: its tracks; a tap plays the album from there ────────────────────────

/**
 * One record (the web's Album.tsx): its head, the tracks (by disc when there's more than one),
 * and where the embedder has reached it, "If you like this" — what else in the library sounds
 * like its longest track (an intro is a poor stand-in for a record).
 */
@Composable
private fun AlbumScreen(album: String, artist: String, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    val state by produceState<Load<List<Track>>>(Load.Loading, album, artist, attemptNo) {
        value = attempt { KourosApi.albumTracks(album, artist) }
    }
    val tracks = (state as? Load.Ready)?.value
    val similar by produceState<Similar?>(null, tracks) {
        val seed = tracks?.maxByOrNull { it.durationSec } ?: return@produceState
        value = runCatching { KourosApi.similar(seed.id, 12) }.getOrNull()
    }
    val context = PlayContext.album(artist, album)
    Column(Modifier.fillMaxSize()) {
        Header("", onBack)   // the head below names the record
        Loaded(state, retry = { attemptNo++ }) { tracks ->
            AlbumBody(album, artist, tracks, similar, controller, now, context, push) { menu = it }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}

/** The album's page under its header, from plain values (ScreensTest draws it). */
@Composable
internal fun AlbumBody(
    album: String, artist: String, tracks: List<Track>, similar: Similar?, controller: MediaController?, now: NowPlaying?, context: String?,
    push: (Screen) -> Unit, onMenu: (TrackTarget) -> Unit,
) {
    if (tracks.isEmpty()) { Hush("This album has no tracks.", Modifier.padding(24.dp)); return }
    val discs = tracks.mapNotNull { it.discNo }.toSet().size > 1
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item {
            DetailHead(
                coverId = tracks.firstOrNull { it.hasCover }?.id, round = false, kind = "Album", title = album,
                sub = artist, onSub = { push(KourosScreen.ArtistPage(artist)) },
                facts = listOfNotNull(tracks.firstNotNullOfOrNull { it.year }?.toString(), count(tracks.size, "track"), formatHM(tracks.sumOf { it.durationMs })).joinToString(" · "),
                onPlay = { controller?.playQueue(tracks, 0, context) },
                onShuffle = { controller?.playQueue(tracks.shuffled(), 0, context) },
                onMore = { onMenu(TrackTarget(tracks, album, artist, context, artist, null)) },
            )
        }
        itemsIndexed(tracks, key = { _, t -> t.id }) { i, t ->
            if (discs && (i == 0 || tracks[i - 1].discNo != t.discNo)) {
                Lab("Disc ${t.discNo ?: 1}", Modifier.padding(start = 16.dp, top = if (i == 0) 0.dp else 14.dp, bottom = 4.dp))
            }
            TrackRow(
                title = t.title,
                subtitle = t.artist?.takeIf { it != artist },
                durationMs = t.durationMs,
                playing = now?.trackId == t.id,
                lead = t.trackNo?.toString(),
                onClick = controller?.let { c -> { c.playQueue(tracks, i, context) } },
                onMenu = { onMenu(TrackTarget(listOf(t), t.title, t.byline(), null, artist, null)) },
            )
            Rule(Modifier.padding(horizontal = 16.dp))
        }
        val alike = similar?.tracks?.filter { s -> tracks.none { it.id == s.id } }?.take(8).orEmpty()
        if (alike.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Glyphs.Radio, contentDescription = null, modifier = Modifier.size(16.dp), tint = Jk.face.muted)
                    Spacer(Modifier.width(8.dp))
                    Text("If you like this", Modifier.weight(1f), style = androidx.compose.ui.text.TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Jk.face.ink))
                    Eyebrow(if (similar?.bySound == true) "Matched by sound" else "Matched by tags", size = 9.sp)
                }
            }
            itemsIndexed(alike, key = { _, t -> "like-${t.id}" }) { i, t ->
                TrackRow(
                    title = t.title, subtitle = t.byline(), durationMs = t.durationMs, playing = now?.trackId == t.id,
                    showCover = true, coverId = t.id.takeIf { t.hasCover },
                    onClick = controller?.let { c -> { c.playQueue(alike, i, null) } },
                    onMenu = { onMenu(TrackTarget.of(t)) },
                )
            }
        }
    }
}
