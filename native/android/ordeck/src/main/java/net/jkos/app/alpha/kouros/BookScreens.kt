package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.session.MediaController
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.*
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Audiobooks (TODO §10 G2): the library, a book's page with its chapters, and the book player
// with speed, sleep and bookmarks. Resume is the server's `progress` row, which BookKeeper
// writes as the book plays, so a book paused here resumes on the web and the reverse.

/** "3 h 12 min" / "47 min". */
fun formatHM(ms: Long): String {
    val m = (ms / 60_000).coerceAtLeast(0)
    return if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"
}

/** The book library, as the KourOS library's third pane: what's under way, then every book. [pre] draws without the network (the renders). */
@Composable
fun BooksPane(query: String, push: (Screen) -> Unit, pre: Pair<List<Book>, List<Progress>>? = null) {
    val face = Jk.face
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<List<Book>, List<Progress>>>>(pre?.let { Load.Ready(it) } ?: Load.Loading) }
    LaunchedEffect(query, attemptNo) {
        if (pre != null && attemptNo == 0) return@LaunchedEffect
        if (query.isNotEmpty()) delay(300)
        state = Load.Loading
        state = attempt {
            coroutineScope {
                val books = async { KourosApi.books(title = query) }
                // Non-fatal, as on the web: without it there's no shelf, and every book still plays.
                val progress = async { runCatching { KourosApi.progress(unfinished = true) }.getOrDefault(emptyList()) }
                books.await().sortedBy { it.title.lowercase() } to progress.await()
            }
        }
    }
    Loaded(state, retry = { attemptNo++ }) { (books, progress) ->
        if (books.isEmpty()) {
            Hush(if (query.isEmpty()) "No audiobooks yet. An admin rescans the library on the web." else "No books match “$query”.", Modifier.padding(24.dp))
            return@Loaded
        }
        val byId = books.associateBy { it.id }
        val shelf = if (query.isNotEmpty()) emptyList() else progress
            .sortedByDescending { it.lastPlayed ?: "" }
            .mapNotNull { p -> byId[p.bookId]?.let { it to p } }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (shelf.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column {
                        AccentLab("Continue listening")
                        Gap(10)
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(shelf, key = { it.first.id }) { (b, p) ->
                                Column(Modifier.width(128.dp).clip(RoundedCornerShape(JkRadius.base)).clickable { push(KourosScreen.BookPage(b.id, b.title)) }) {
                                    BookCover(b, 128.dp)
                                    Bar(if (p.durationSec > 0) (p.positionSec / p.durationSec).toFloat() else 0f, Modifier.padding(vertical = 7.dp), height = 4.dp, radius = 2.dp)
                                    Text(b.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = face.ink))
                                    Eyebrow("${formatHM(((p.durationSec - p.positionSec) * 1000).toLong())} left", size = 9.sp)
                                }
                            }
                        }
                        Gap(18)
                        Lab("All books")
                    }
                }
            }
            items(books, key = { it.id }) { b -> BookCard(b) { push(KourosScreen.BookPage(b.id, b.title)) } }
        }
    }
}

/** The web's library card (BookCard): card stock, the cover, the title in the serif, the author, the length. */
@Composable
private fun BookCard(b: Book, onClick: () -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(JkRadius.lg)
    Column(
        Modifier.drawBehind { boxShadow(face.ink.copy(alpha = if (face.dark) 0.3f else 0.10f), JkRadius.lg, 8.dp, dy = 2.dp) }
            .clip(shape).background(face.card).border(1.dp, face.line, shape).clickable(onClick = onClick).padding(10.dp),
    ) {
        BookCover(b, 150.dp)
        Gap(9)
        Text(b.title, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 19.sp, color = face.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
        b.author?.let { Text(it, Modifier.padding(top = 2.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = face.muted), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        Eyebrow(formatHM((b.durationSec * 1000).toLong()), Modifier.padding(top = 6.dp), size = 9.sp)
    }
}

private fun fmtSeq(n: Double) = if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()

@Composable
private fun BookCover(b: Book, size: Dp) {
    Cover(b.id.takeIf { b.hasCover }, size, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(JkRadius.sm)), book = true, title = b.title)
}

// ── one book ───────────────────────────────────────────────────────────────────

/**
 * A book's page (apps/kouros/src/views/books/BookDetail.tsx): Play, or Resume from where this
 * listener left it on any device; a finished book starts over. Tapping a chapter plays from it.
 * Each chapter row fills with how much of it is behind the listener.
 */
@Composable
fun BookScreen(page: KourosScreen.BookPage, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit, pre: Pair<BookDetail, Progress?>? = null) {
    val face = Jk.face
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<BookDetail, Progress?>>>(pre?.let { Load.Ready(it) } ?: Load.Loading) }
    LaunchedEffect(page.id, attemptNo) {
        if (pre != null && attemptNo == 0) return@LaunchedEffect
        state = Load.Loading
        state = attempt {
            coroutineScope {
                val detail = async { KourosApi.book(page.id) }
                val progress = async { runCatching { KourosApi.progress().firstOrNull { it.bookId == page.id } }.getOrNull() }
                detail.await() to progress.await()
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        // The web's "← Audiobooks": the hero under it already says which book.
        Header("Audiobooks", onBack)
        Loaded(state, retry = { attemptNo++ }) { (detail, saved) ->
            val b = detail.book
            val layout = remember(detail) { BookLayout(detail.files, detail.chapters) }
            val playingThis = now?.book?.bookId == b.id
            val livePos = if (playingThis) now!!.book!!.offsetMs + rememberPosition(controller, now.isPlaying) else null
            val savedMs = saved?.takeIf { !it.finished }?.let { (it.positionSec * 1000).toLong() }
            val positionMs = livePos ?: savedMs ?: 0L
            fun playAt(ms: Long) { controller?.playBook(detail, ms, BookRate.get()) }

            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item {
                    // The web's book hero: the cover in its frame, and what the book is beside it.
                    Row {
                        Box(
                            Modifier.size(128.dp).drawBehind { boxShadow(face.ink.copy(alpha = if (face.dark) 0.35f else 0.14f), JkRadius.lg, 10.dp, dy = 3.dp) }
                                .clip(RoundedCornerShape(JkRadius.lg)).background(face.card).border(1.dp, face.line, RoundedCornerShape(JkRadius.lg)),
                        ) { Cover(b.id.takeIf { b.hasCover }, 128.dp, Modifier.size(128.dp), book = true, title = b.title) }
                        Spacer(Modifier.width(18.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            AccentLab("Audiobook")
                            Text(b.title, style = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 25.sp, letterSpacing = (-0.015).em, color = face.ink), maxLines = 3, overflow = TextOverflow.Ellipsis)
                            b.subtitle?.let { Text(it, style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 14.sp, color = face.faint), maxLines = 2) }
                            Text(
                                buildAnnotatedString {
                                    b.author?.let { append(it) }
                                    b.narrator?.let { withStyle(SpanStyle(color = face.ink.copy(alpha = 0.6f))) { append((if (b.author != null) " · " else "") + "narrated by $it") } }
                                },
                                style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.sp, color = face.ink),
                            )
                            b.series?.let { s -> Text(b.seriesSeq?.let { "$s #${fmtSeq(it)}" } ?: s, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = face.ink.copy(alpha = 0.6f))) }
                            Eyebrow(listOfNotNull(b.year?.toString(), formatHM(layout.totalMs)).joinToString(" · "))
                        }
                    }
                }
                item {
                    Column(Modifier.padding(top = 14.dp)) {
                        PlayBookButton(
                            // A preloaded page is a render's: draw its Play as a listener sees it.
                            enabled = (controller != null || pre != null) && detail.files.isNotEmpty(),
                            label = when {
                                playingThis && now!!.isPlaying -> "Playing"
                                playingThis -> "▶ Continue"
                                savedMs != null && savedMs > 0 -> "▶ Resume · ${formatTime(savedMs)}"
                                else -> "▶ Play"
                            },
                        ) { if (playingThis) { if (!now!!.isPlaying) controller?.play() } else playAt(savedMs ?: 0L) }
                        if (layout.totalMs > 0 && positionMs > 0) {
                            Box(Modifier.fillMaxWidth().padding(top = 12.dp).height(4.dp).clip(RoundedCornerShape(50)).background(face.line)) {
                                Box(Modifier.fillMaxHeight().fillMaxWidth((positionMs.toFloat() / layout.totalMs).coerceIn(0f, 1f)).background(face.accent))
                            }
                        }
                        BookModels.plain(detail.description)?.let {
                            Text(it, Modifier.padding(top = 14.dp), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.5.sp, lineHeight = 22.sp, color = face.muted))
                        }
                        Lab(if (detail.chapters.isNotEmpty()) "Chapters" else "Tracks", Modifier.padding(top = 20.dp, bottom = 4.dp))
                    }
                }
                if (detail.chapters.isNotEmpty()) {
                    itemsIndexed(detail.chapters) { i, ch ->
                        val start = (ch.startSec * 1000).toLong()
                        val end = (ch.endSec * 1000).toLong()
                        SpanRow(i + 1, ch.title, start, end, positionMs) { playAt(start) }
                    }
                } else {
                    itemsIndexed(layout.files) { i, f ->
                        val start = layout.startOf(i)
                        val end = start + (f.durationSec * 1000).toLong()
                        SpanRow(i + 1, "Track ${f.index + 1}", start, end, positionMs) { playAt(start) }
                    }
                }
            }
        }
    }
}

/** The web's Play: the one loud button on the page, the accent's wash in a strong accent rim. */
@Composable
private fun PlayBookButton(enabled: Boolean, label: String, onClick: () -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(JkRadius.sm)
    Box(
        Modifier.clip(shape).background(face.accent.mix(22.0, face.card)).border(2.dp, face.accent.mix(60.0, Color.Transparent), shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = 48.dp).padding(horizontal = 26.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (enabled) face.accent else face.ghost, shadow = haloText(face.accent, 45.0, 8f)))
    }
}

/** A chapter or a track (the web's chapter-row): paper-2 in a hairline, filling with the accent as it's heard. */
@Composable
private fun SpanRow(n: Int, title: String, startMs: Long, endMs: Long, positionMs: Long, onClick: () -> Unit) {
    val face = Jk.face
    val heard = when {
        positionMs <= startMs -> 0f
        positionMs >= endMs -> 1f
        else -> (positionMs - startMs).toFloat() / (endMs - startMs)
    }
    val shape = RoundedCornerShape(JkRadius.lg)
    Box(Modifier.fillMaxWidth().clip(shape).background(face.paper2).border(1.dp, face.line, shape).clickable(onClick = onClick).heightIn(min = 46.dp)) {
        Box(Modifier.matchParentSize()) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(heard).background(face.accent.mix(14.0, Color.Transparent)))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("$n", Modifier.width(30.dp), style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 12.5.sp, color = face.faint))
            Text(title, Modifier.weight(1f), style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 14.sp, color = face.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatTime(endMs - startMs), Modifier.padding(start = 8.dp), style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 12.5.sp, color = face.faint))
        }
    }
}
