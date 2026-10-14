package net.jkos.kouros

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

/** The app's own back stack: a list of screens, Back pops it (no navigation library). */
sealed interface Screen {
    data object Library : Screen
    data class ArtistPage(val artist: String) : Screen
    data class AlbumPage(val album: String, val artist: String) : Screen
    data object NowPlayingPage : Screen
    data object Account : Screen
}

private fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** "ALPHA · staging · 0.1.0-alpha-staging" — always visible, so a tester knows what they hold. */
private fun buildLabel() = with(Auth.config) { "${channel.uppercase()} · $environment · $versionName" }

@Composable
fun KourosRoot() {
    val auth by Auth.state.collectAsState()
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        when (val a = auth) {
            is AuthState.SignedIn -> SignedIn(a.user)
            AuthState.SignedOut -> SignInScreen()
        }
    }
}

// ── sign-in ────────────────────────────────────────────────────────────────────

@Composable
private fun SignInScreen() {
    val context = LocalContext.current
    val message by Auth.message.collectAsState()
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("KourOS", style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(8.dp))
        BuildBadge()
        Spacer(Modifier.height(40.dp))
        Button(onClick = { context.activity()?.let { Auth.beginSignIn(it) } }) {
            Text("Sign in with jkOS")
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Opens ${Auth.config.authOrigin} in your browser. Your password never enters this app.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        message?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.secondary)
        }
    }
}

@Composable
private fun BuildBadge() {
    Text(
        buildLabel(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSecondary,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.secondary)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

// ── signed in: the back stack, the screens, the mini player ────────────────────

@Composable
private fun SignedIn(user: User) {
    val stack = remember { mutableStateListOf<Screen>(Screen.Library) }
    val push = { s: Screen -> stack.add(s); Unit }
    val pop = { if (stack.size > 1) stack.removeAt(stack.lastIndex); Unit }
    BackHandler(enabled = stack.size > 1) { pop() }

    val controller = rememberController()
    val now = rememberNowPlaying(controller)

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (val s = stack.last()) {
                Screen.Library -> LibraryScreen(push)
                is Screen.ArtistPage -> ArtistScreen(s.artist, pop, push)
                is Screen.AlbumPage -> AlbumScreen(s.album, s.artist, controller, pop)
                Screen.NowPlayingPage -> NowPlayingScreen(controller, now, pop)
                Screen.Account -> AccountScreen(user, pop)
            }
        }
        if (now != null && stack.last() != Screen.NowPlayingPage) {
            MiniPlayer(now, controller) { push(Screen.NowPlayingPage) }
        }
    }
}

@Composable
private fun Header(title: String, onBack: (() -> Unit)?, actions: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Glyphs.Back, contentDescription = "Back") }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        Text(
            title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        actions()
    }
}

/** Something to load, with its loading and failed states drawn the same way everywhere. */
private sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

private suspend fun <T> attempt(block: suspend () -> T): Load<T> = try {
    Load.Ready(block())
} catch (e: CancellationException) {
    throw e
} catch (e: SignedOutException) {
    Load.Failed("Signed out.")
} catch (e: Exception) {
    Load.Failed(e.message ?: "Something went wrong.")
}

@Composable
private fun <T> Loaded(state: Load<T>, retry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(state.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = retry) { Text("Retry") }
        }
        is Load.Ready -> content(state.value)
    }
}

@Composable
fun Cover(trackId: Long?, size: Dp, modifier: Modifier = Modifier) {
    val px = with(LocalDensity.current) { size.roundToPx() }
    val bitmap by produceState<ImageBitmap?>(null, trackId, px) {
        value = trackId?.let { Covers.load(it, px)?.asImageBitmap() }
    }
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        bitmap?.let {
            Image(bitmap = it, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        )
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
            IconButton(onClick = { push(Screen.Account) }) { Icon(Glyphs.Account, contentDescription = "Account") }
        }
        Row(Modifier.padding(horizontal = 16.dp)) { BuildBadge() }
        Row(Modifier.padding(horizontal = 8.dp)) {
            Choice("Albums", tab == 0) { tab = 0 }
            Choice("Artists", tab == 1) { tab = 1 }
        }
        OutlinedTextField(
            value = query, onValueChange = { query = it }, singleLine = true,
            placeholder = { Text(if (tab == 0) "Search albums" else "Search artists") },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        if (tab == 0) {
            Row(Modifier.padding(horizontal = 8.dp)) {
                for ((key, label) in listOf("added" to "Added", "title" to "Title", "artist" to "Artist", "year" to "Year")) {
                    Choice(label, sort == key) { sort = key }
                }
            }
            AlbumGrid(query = query, artist = null, sort = sort, push = push)
        } else {
            ArtistList(query, push)
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
            val page = Api.albums(q = query, artist = artist, sort = sort, limit = PAGE)
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
                Column(Modifier.clickable { push(Screen.AlbumPage(a.album, a.artist)) }) {
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
                            val next = attempt { Api.albums(q = query, artist = artist, sort = sort, limit = PAGE, offset = albums.size) }
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
        value = attempt { Api.artists(q = query) }
    }
    Loaded(state, retry = { attemptNo++ }) { artists ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(artists, key = { it.artist }) { a ->
                Row(
                    Modifier.fillMaxWidth().clickable { push(Screen.ArtistPage(a.artist)) }.padding(horizontal = 16.dp, vertical = 8.dp),
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
private fun AlbumScreen(album: String, artist: String, controller: MediaController?, onBack: () -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    val state by produceState<Load<List<Track>>>(Load.Loading, album, artist, attemptNo) {
        value = attempt { Api.albumTracks(album, artist) }
    }
    Column(Modifier.fillMaxSize()) {
        Header(album, onBack)
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
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable(enabled = controller != null) { controller?.playQueue(tracks, i, PlayContext.album(artist, album)) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            t.trackNo?.toString() ?: "·", modifier = Modifier.width(32.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                        )
                        Column(Modifier.weight(1f)) {
                            Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (t.artist != null && t.artist != artist) {
                                Text(t.artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            }
                        }
                        Text(formatTime((t.durationSec * 1000).toLong()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
            }
        }
    }
}

// ── the player: a bar at the bottom, and a full screen ─────────────────────────

@Composable
private fun TransportButton(glyph: ImageVector, label: String, enabled: Boolean = true, size: Dp = 48.dp, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(size)) {
        Icon(glyph, contentDescription = label, modifier = Modifier.size(size * 0.6f))
    }
}

@Composable
private fun MiniPlayer(now: NowPlaying, controller: MediaController?, open: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).clickable(onClick = open).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(now.trackId.takeIf { now.hasArtwork }, 44.dp, Modifier.size(44.dp))
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
private fun NowPlayingScreen(controller: MediaController?, now: NowPlaying?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var radioNote by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize()) {
        Header("Now playing", onBack)
        if (now == null || controller == null) {
            Text("Nothing is playing.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        val position = rememberPosition(controller, now.isPlaying)
        var dragging by remember { mutableStateOf<Float?>(null) }
        Column(
            Modifier.fillMaxSize().padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Cover(now.trackId.takeIf { now.hasArtwork }, 320.dp, Modifier.fillMaxWidth().aspectRatio(1f))
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
                val seed = now.trackId
                radioNote = "Building a station…"
                scope.launch {
                    when (val r = attempt { Api.radio(seed) }) {
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

// ── Account ────────────────────────────────────────────────────────────────────

@Composable
private fun AccountScreen(user: User, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var signingOut by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Header("Account", onBack)
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(user.name ?: user.email, style = MaterialTheme.typography.titleLarge)
            Text(user.email, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Role: ${user.role}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Text("Environment: ${Auth.config.environment}")
            Text("KourOS: ${Auth.config.apiBase}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Signed in by: ${Auth.config.authOrigin}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            BuildBadge()
            Spacer(Modifier.height(24.dp))
            Button(enabled = !signingOut, onClick = {
                signingOut = true
                scope.launch { Auth.signOut() }
            }) { Text(if (signingOut) "Signing out…" else "Sign out") }
            Text(
                "Signing out also ends this phone's session on jkOS.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
