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

// Audiobooks (TODO §10 G2): the library, a book's page with its chapters, and the book player
// with speed, sleep and bookmarks. Resume is the server's `progress` row, which BookKeeper
// writes as the book plays, so a book paused here resumes on the web and the reverse.

/** "3 h 12 min" / "47 min". */
fun formatHM(ms: Long): String {
    val m = (ms / 60_000).coerceAtLeast(0)
    return if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"
}

/** The book library, as the KourOS library's third pane: what's under way, then every book. */
@Composable
fun BooksPane(query: String, push: (Screen) -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<List<Book>, List<Progress>>>>(Load.Loading) }
    LaunchedEffect(query, attemptNo) {
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
            Text(if (query.isEmpty()) "No audiobooks yet. An admin rescans the library on the web." else "No books match “$query”.",
                Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Loaded
        }
        val byId = books.associateBy { it.id }
        val shelf = if (query.isNotEmpty()) emptyList() else progress
            .sortedByDescending { it.lastPlayed ?: "" }
            .mapNotNull { p -> byId[p.bookId]?.let { it to p } }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (shelf.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column {
                        Text("Continue listening", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(8.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(shelf, key = { it.first.id }) { (b, p) ->
                                Column(Modifier.width(132.dp).clickable { push(KourosScreen.BookPage(b.id, b.title)) }) {
                                    BookCover(b, 132.dp)
                                    Bar(if (p.durationSec > 0) (p.positionSec / p.durationSec).toFloat() else 0f, Modifier.padding(vertical = 6.dp), height = 3.dp, radius = 1.dp)
                                    Text(b.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                                }
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Text("All books", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            items(books, key = { it.id }) { b ->
                Column(Modifier.clickable { push(KourosScreen.BookPage(b.id, b.title)) }) {
                    BookCover(b, 150.dp)
                    Spacer(Modifier.height(6.dp))
                    Text(b.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(b.author, b.series?.let { s -> b.seriesSeq?.let { "$s #${fmtSeq(it)}" } ?: s }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

private fun fmtSeq(n: Double) = if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()

@Composable
private fun BookCover(b: Book, size: Dp) {
    Cover(b.id.takeIf { b.hasCover }, size, Modifier.fillMaxWidth().aspectRatio(1f), book = true, title = b.title)
}

// ── one book ───────────────────────────────────────────────────────────────────

/**
 * A book's page (apps/kouros/src/views/books/BookDetail.tsx): Play, or Resume from where this
 * listener left it on any device; a finished book starts over. Tapping a chapter plays from it.
 * Each chapter row fills with how much of it is behind the listener.
 */
@Composable
fun BookScreen(page: KourosScreen.BookPage, controller: MediaController?, now: NowPlaying?, onBack: () -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<Pair<BookDetail, Progress?>>>(Load.Loading) }
    LaunchedEffect(page.id, attemptNo) {
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
        Header((state as? Load.Ready)?.value?.first?.book?.title ?: page.title, onBack)
        Loaded(state, retry = { attemptNo++ }) { (detail, saved) ->
            val b = detail.book
            val layout = remember(detail) { BookLayout(detail.files, detail.chapters) }
            val playingThis = now?.book?.bookId == b.id
            val livePos = if (playingThis) now!!.book!!.offsetMs + rememberPosition(controller, now.isPlaying) else null
            val savedMs = saved?.takeIf { !it.finished }?.let { (it.positionSec * 1000).toLong() }
            val positionMs = livePos ?: savedMs ?: 0L
            fun playAt(ms: Long) { controller?.playBook(detail, ms, BookRate.get()) }

            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                item {
                    Row(Modifier.padding(16.dp)) {
                        Cover(b.id.takeIf { b.hasCover }, 128.dp, Modifier.size(128.dp), book = true)
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            b.subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                            Text(BookModels.byline(b), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            b.series?.let { s -> Text(b.seriesSeq?.let { "$s #${fmtSeq(it)}" } ?: s, style = MaterialTheme.typography.bodySmall) }
                            Text(
                                listOfNotNull(b.year?.toString(), formatHM(layout.totalMs)).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        TButton(primary = true, enabled = controller != null && detail.files.isNotEmpty(), onClick = {
                            if (playingThis) { if (!now!!.isPlaying) controller?.play() } else playAt(savedMs ?: 0L)
                        }) {
                            Icon(Glyphs.Play, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                when {
                                    playingThis && now!!.isPlaying -> "Playing"
                                    playingThis -> "Continue"
                                    savedMs != null && savedMs > 0 -> "Resume · ${formatTime(savedMs)}"
                                    else -> "Play"
                                },
                            )
                        }
                        if (layout.totalMs > 0 && positionMs > 0) {
                            Bar(positionMs.toFloat() / layout.totalMs, Modifier.padding(vertical = 8.dp))
                        }
                        BookModels.plain(detail.description)?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 8.dp))
                        }
                        Text(if (detail.chapters.isNotEmpty()) "Chapters" else "Parts", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
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
                        SpanRow(i + 1, "Part ${i + 1}", start, end, positionMs) { playAt(start) }
                    }
                }
            }
        }
    }
}

/** A chapter or a part: a row whose background fills with the part of it already heard. */
@Composable
private fun SpanRow(n: Int, title: String, startMs: Long, endMs: Long, positionMs: Long, onClick: () -> Unit) {
    val heard = when {
        positionMs <= startMs -> 0f
        positionMs >= endMs -> 1f
        else -> (positionMs - startMs).toFloat() / (endMs - startMs)
    }
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onClick)) {
        Box(Modifier.matchParentSize()) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(heard).background(MaterialTheme.colorScheme.surfaceVariant))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("$n", Modifier.width(36.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatTime(endMs - startMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
}

// ── the book player ────────────────────────────────────────────────────────────

/**
 * Now Playing for a book: the whole book on one scrubber, the chapter it's in, ±30 s, previous
 * and next chapter, the rate (kept per device, books only), the sleep timer, and bookmarks.
 */
@Composable
fun BookNowPlaying(controller: MediaController, now: NowPlaying, book: BookInfo) {
    val layout = remember(book) { BookLayout(listOf(BookFile(0, book.totalMs / 1000.0)), book.chapters) }
    val global = book.offsetMs + rememberPosition(controller, now.isPlaying)
    var dragging by remember { mutableStateOf<Float?>(null) }
    var bookmarks by remember { mutableStateOf(false) }
    val sleep by SleepTimer.state.collectAsState()
    val chapter = layout.chapterAt(global).takeIf { it >= 0 }?.let { book.chapters[it] }
    fun seek(ms: Long) = controller.seekInBook(book, ms)

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Cover(book.bookId.takeIf { now.hasArtwork }, 280.dp, Modifier.fillMaxWidth(0.8f).aspectRatio(1f), book = true)
        Spacer(Modifier.height(16.dp))
        Text(now.title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            chapter?.title ?: now.artist, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        val total = book.totalMs.coerceAtLeast(1L)
        JkSlider(
            value = dragging ?: (global.toFloat() / total).coerceIn(0f, 1f),
            onValueChange = { dragging = it },
            onValueChangeFinished = { dragging?.let { seek((it * total).toLong()) }; dragging = null },
        )
        Row(Modifier.fillMaxWidth()) {
            Text(formatTime(dragging?.let { (it * total).toLong() } ?: global), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.weight(1f))
            Text("−" + formatTime(book.totalMs - global), style = MaterialTheme.typography.bodySmall)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IconButton(enabled = layout.previousChapterStart(global) != null, onClick = { layout.previousChapterStart(global)?.let(::seek) }) {
                Icon(Glyphs.Previous, contentDescription = "Previous chapter")
            }
            TButton(quiet = true, onClick = { seek(global - SKIP_MS) }) { Text("−30 s") }
            IconButton(onClick = { if (controller.isPlaying) controller.pause() else controller.play() }, modifier = Modifier.size(72.dp)) {
                Icon(if (now.isPlaying) Glyphs.Pause else Glyphs.Play, contentDescription = if (now.isPlaying) "Pause" else "Play", modifier = Modifier.size(44.dp))
            }
            TButton(quiet = true, onClick = { seek(global + SKIP_MS) }) { Text("+30 s") }
            IconButton(enabled = layout.nextChapterStart(global) != null, onClick = { layout.nextChapterStart(global)?.let(::seek) }) {
                Icon(Glyphs.Next, contentDescription = "Next chapter")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TButton(onClick = {
                val r = Rates.next(now.rate)
                BookRate.set(r)
                controller.setPlaybackSpeed(r)
            }) { Text(Rates.label(now.rate)) }
            SleepButton(sleep, chapterEndMs = book.layoutChapterEnd(global))
            TButton(onClick = { bookmarks = true }) { Text("Bookmarks") }
        }
    }
    if (bookmarks) BookmarksDialog(book.bookId, global, onSeek = ::seek) { bookmarks = false }
}

private const val SKIP_MS = 30_000L

@Composable
private fun SleepButton(sleep: SleepState, chapterEndMs: Long?) {
    var open by remember { mutableStateOf(false) }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sleep) { while (sleep.deadlineMs != null) { nowMs = System.currentTimeMillis(); delay(1000) } }
    Box {
        TButton(onClick = { open = true }) {
            Text(
                when {
                    sleep.mode == SleepState.CHAPTER -> "Sleep: chapter"
                    sleep.on -> "Sleep " + formatTime(sleep.remainingMs(nowMs) ?: 0)
                    else -> "Sleep"
                },
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            fun pick(mode: String) { SleepTimer.set(mode, System.currentTimeMillis(), chapterEndMs); open = false }
            DropdownMenuItem(text = { Text("Off") }, onClick = { pick(SleepState.OFF) })
            for (m in SleepState.TIMED) DropdownMenuItem(text = { Text("$m minutes") }, onClick = { pick(m) })
            DropdownMenuItem(text = { Text("End of chapter") }, enabled = chapterEndMs != null, onClick = { pick(SleepState.CHAPTER) })
        }
    }
}

@Composable
private fun BookmarksDialog(bookId: Long, globalMs: Long, onSeek: (Long) -> Unit, onDismiss: () -> Unit) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<Bookmark>>>(Load.Loading) }
    var title by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val at = remember { globalMs }   // the bookmark marks where the listener was when they opened this
    LaunchedEffect(attemptNo) { state = attempt { KourosApi.bookmarks(bookId) } }
    fun write(block: suspend () -> Unit) {
        note = null
        scope.launch {
            when (val r = attempt { block() }) {
                is Load.Failed -> note = "Couldn't save: ${r.message}"
                else -> attemptNo++
            }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Bookmarks") },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Field(
                        value = title, onValueChange = { title = it.take(200) }, singleLine = true,
                        placeholder = { Text("At ${formatTime(at)}") }, modifier = Modifier.weight(1f),
                    )
                    TButton(quiet = true, onClick = { val t = title; title = ""; write { KourosApi.addBookmark(bookId, at, t) } }) { Text("Add") }
                }
                note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                when (val s = state) {
                    Load.Loading -> Text("Loading…", Modifier.padding(8.dp))
                    is Load.Failed -> TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry: ${s.message}") }
                    is Load.Ready -> if (s.value.isEmpty()) {
                        Text("No bookmarks in this book yet.", Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        LazyColumn(Modifier.heightIn(max = 320.dp)) {
                            items(s.value, key = { it.id }) { bm ->
                                val ms = (bm.positionSec * 1000).toLong()
                                Row(
                                    Modifier.fillMaxWidth().clickable { onSeek(ms); onDismiss() }.padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(formatTime(ms), Modifier.width(72.dp), style = MaterialTheme.typography.bodySmall)
                                    Text(bm.title ?: "Bookmark", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    IconButton(onClick = { write { KourosApi.deleteBookmark(bm.id) } }) {
                                        Icon(Glyphs.Close, contentDescription = "Delete the bookmark at ${formatTime(ms)}")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TButton(quiet = true, onClick = onDismiss) { Text("Done") } },
    )
}
