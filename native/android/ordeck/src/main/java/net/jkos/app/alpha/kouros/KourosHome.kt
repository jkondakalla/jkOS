package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.media3.session.MediaController
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.*
import java.time.LocalTime

// The KourOS Home (apps/kouros/widgets/kouros-home.json, where the web's KourOS opens): the
// greeting and the library's size, then the rails — the books under way, what was played
// lately, the runs built from the sound, this hour's picks, the artists the listener keeps
// returning to, and what's new in the library. One request (discoverHome) draws all of it.
// Every tap does what the web's does: a book carries on playing, a recent context opens its
// page (a station, which has no page, plays again), a run or a pick plays.

/** The last Home drawn, so coming back to it draws at once while it refreshes behind. */
private object HomeCache { @Volatile var last: DiscoverHome? = null }

@Composable
internal fun HomePane(controller: MediaController?, now: NowPlaying?, push: (Screen) -> Unit, pre: DiscoverHome? = null) {
    var attemptNo by remember { mutableIntStateOf(0) }
    val cached = pre ?: HomeCache.last
    var state by remember { mutableStateOf<Load<DiscoverHome>>(cached?.let { Load.Ready(it) } ?: Load.Loading) }
    var menu by remember { mutableStateOf<TrackTarget?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(attemptNo) {
        if (pre != null) return@LaunchedEffect
        val r = attempt { KourosApi.home(LocalTime.now().hour) }
        // A refresh that fails keeps what's drawn; only a first load shows the failure.
        if (r is Load.Ready) { HomeCache.last = r.value; state = r } else if (state !is Load.Ready) state = r
    }
    fun resume(b: HomeBook) {
        val c = controller ?: return
        note = null
        scope.launch {
            when (val d = attempt { KourosApi.book(b.id) }) {
                is Load.Ready -> c.playBook(d.value, (b.positionSec * 1000).toLong(), BookRate.get())
                is Load.Failed -> note = "Couldn't open “${b.title}”: ${d.message}"
                Load.Loading -> Unit
            }
        }
    }
    fun open(r: HomeRecent) {
        when (val place = PlayContext.parse(r.route)) {
            is PlayContext.Place.Album -> push(KourosScreen.AlbumPage(place.album, place.artist))
            is PlayContext.Place.Artist -> push(KourosScreen.ArtistPage(place.artist))
            is PlayContext.Place.Playlist -> push(KourosScreen.PlaylistPage(place.id, r.title))
            is PlayContext.Place.Book -> push(KourosScreen.BookPage(place.id, r.title))
            is PlayContext.Place.Station -> {
                val c = controller ?: return
                note = "Building a station…"
                scope.launch {
                    note = when (val s = attempt { KourosApi.radio(place.seed) to KourosApi.tracksByIds(listOf(place.seed)).firstOrNull() }) {
                        is Load.Ready -> {
                            val (station, seed) = s.value
                            if (seed == null || station.isEmpty()) "No station for this track yet." else { c.playStation(seed, station); null }
                        }
                        is Load.Failed -> s.message
                        Load.Loading -> null
                    }
                }
            }
            null -> Unit
        }
    }
    Loaded(state, retry = { attemptNo++ }) { home ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 20.dp)) {
            item {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 4.dp)) {
                    Text(home.greeting, style = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, fontSize = 28.sp, letterSpacing = (-0.015).em, color = Jk.face.ink))
                    if (home.libraryLabel.isNotEmpty()) Eyebrow(home.libraryLabel, Modifier.padding(top = 2.dp))
                    note?.let { Hush(it, Modifier.padding(top = 6.dp)) }
                }
            }
            if (home.tracks == 0) {
                item { Hush("The library is empty. An admin points KourOS at the music and rescans it on the web.", Modifier.padding(16.dp)) }
            }
            if (home.continueBooks.isNotEmpty()) {
                item { RailHead("Continue listening", "Audiobooks") }
                item { Rail(home.continueBooks, key = { it.id }) { b -> BookTile(b, onPlay = { resume(b) }, onOpen = { push(KourosScreen.BookPage(b.id, b.title)) }) } }
            }
            if (home.recent.isNotEmpty()) {
                item { RailHead("Recently played") }
                item { Rail(home.recent, key = { it.route }) { r -> Tile(r.coverId, r.title, r.subtitle, book = r.coverIsBook, round = r.kind == "artist") { open(r) } } }
            }
            if (home.runs.isNotEmpty()) {
                item { RailHead("Runs", "Built from the sound") }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(home.runs, key = { it.id }) { run ->
                            RunCard(run,
                                onPlay = { controller?.playQueue(run.tracks, 0, null) },
                                onMore = { menu = TrackTarget(run.tracks, run.title, run.seedTitle) })
                        }
                    }
                }
            }
            if (home.timeOfDay.isNotEmpty()) {
                item { RailHead(home.picksTitle, home.picksBasis) }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        itemsIndexed(home.timeOfDay, key = { _, t -> t.id }) { i, t ->
                            Tile(t.id.takeIf { t.hasCover }, t.title, t.artist, size = 120.dp, playing = now?.trackId == t.id) {
                                controller?.playQueue(home.timeOfDay, i, null)
                            }
                        }
                    }
                }
            }
            if (home.deepIn.isNotEmpty()) {
                item { RailHead("You’re deep in", "Lately") }
                item { Rail(home.deepIn, key = { it.artist }) { a -> Tile(a.anchorId.takeIf { a.hasCover }, a.artist, a.meta, round = true, size = 112.dp) { push(KourosScreen.ArtistPage(a.artist)) } } }
            }
            if (home.freshAlbums.isNotEmpty()) {
                item { RailHead("New in the library", "All", onMeta = { push(KourosScreen.Root(KourosScreen.Root.ALBUMS)) }) }
                item { Rail(home.freshAlbums, key = { "${it.artist}\u0000${it.album}" }) { a -> Tile(a.anchorId.takeIf { a.hasCover }, a.album, listOf(a.artist, a.meta).filter { it.isNotEmpty() }.joinToString(" · ")) { push(KourosScreen.AlbumPage(a.album, a.artist)) } } }
            }
            home.coverageLabel?.let { item { Eyebrow(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 22.dp), maxLines = 2) } }
        }
    }
    TrackActions(menu, controller, push) { menu = null }
}

/** A rail's head: its name in the serif, and a mono note (or a link) at the right. */
@Composable
private fun RailHead(title: String, meta: String? = null, onMeta: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 22.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Jk.face.ink))
        if (meta != null) {
            Eyebrow(
                meta,
                if (onMeta != null) Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = onMeta).padding(horizontal = 6.dp, vertical = 4.dp) else Modifier,
                color = if (onMeta != null) Jk.face.accent else Jk.face.faint, size = 9.sp,
            )
        }
    }
}

@Composable
private fun <T> Rail(rows: List<T>, key: (T) -> Any, tile: @Composable (T) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(rows, key = key) { tile(it) }
    }
}

/** A tile on a rail: the sleeve (round for an artist), its name in the serif, a line under it. */
@Composable
private fun Tile(coverId: Long?, title: String, sub: String?, book: Boolean = false, round: Boolean = false, size: Dp = 132.dp, playing: Boolean = false, onClick: () -> Unit) {
    val f = Jk.face
    Column(Modifier.width(size).clip(RoundedCornerShape(JkRadius.base)).clickable(onClick = onClick)) {
        Cover(coverId, size, Modifier.size(size).then(if (round) Modifier.clip(RoundedCornerShape(50)) else Modifier), book = book, title = title)
        Spacer(Modifier.size(8.dp))
        Text(title, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = if (playing) f.accent else f.ink, shadow = if (playing) haloText(f.accent) else null), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!sub.isNullOrEmpty()) Text(sub, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 12.5.sp, color = f.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A book under way: tap carries on playing it where this listener left it; hold opens its page. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookTile(b: HomeBook, onPlay: () -> Unit, onOpen: () -> Unit) {
    val f = Jk.face
    Column(Modifier.width(132.dp).clip(RoundedCornerShape(JkRadius.base)).combinedClickable(onClick = onPlay, onLongClick = onOpen, onLongClickLabel = "Open the book", onClickLabel = "Carry on listening")) {
        Cover(b.id.takeIf { b.hasCover }, 132.dp, Modifier.size(132.dp), book = true, title = b.title)
        Bar(if (b.durationSec > 0) (b.positionSec / b.durationSec).toFloat() else 0f, Modifier.padding(vertical = 7.dp), height = 4.dp, radius = 2.dp)
        Text(b.title, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = f.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
        b.author?.let { Text(it, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 12.5.sp, color = f.muted), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        if (b.remainingLabel.isNotEmpty()) Eyebrow(b.remainingLabel, Modifier.padding(top = 2.dp), size = 9.sp)
    }
}

/**
 * A run (the web's run card): what it is, how it moves (its energy, step by step, as a row of
 * bars when the space has features), how long, and Play; More opens the actions for its tracks.
 */
@Composable
private fun RunCard(run: HomeRun, onPlay: () -> Unit, onMore: () -> Unit) {
    val f = Jk.face
    Sheet(Modifier.width(264.dp), padding = PaddingValues(14.dp)) {
        Text(run.title, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = f.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (run.blurb.isNotEmpty()) Text(run.blurb, style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 13.5.sp, color = f.muted), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.size(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (t in run.tracks.take(5)) Cover(t.id.takeIf { t.hasCover }, 40.dp, Modifier.size(40.dp), title = t.title)
        }
        Spacer(Modifier.size(10.dp))
        Eyebrow(run.meta, size = 9.sp)
        Spacer(Modifier.size(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TButton(primary = true, onClick = onPlay) {
                Icon(Glyphs.Play, contentDescription = null, modifier = Modifier.size(14.dp))
                Text("PLAY")
            }
            TButton(quiet = true, onClick = onMore) { Text("MORE…") }
        }
    }
}
