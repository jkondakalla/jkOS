package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.AccountApi
import net.jkos.app.alpha.auth.HudRef
import net.jkos.app.alpha.auth.HudShelf
import net.jkos.app.alpha.auth.Shelf

import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// The BeigeBoard tab (TODO §10 H). Every read and write goes through a dataset or capability
// BeigeBoard declares (BeigeBoardApi); pin and focus are the person's HUD shelf in jkAuth.

/** BeigeBoard's screens, as entries of its tab's back stack. */
sealed interface BeigeBoardScreen : Screen {
    data object Today : BeigeBoardScreen
    data class GoalPage(val id: Long) : BeigeBoardScreen
    data class RoutinePage(val id: Long) : BeigeBoardScreen
    /** A routine's document to edit ([routineId]), or a new one or a bundle to import (null). */
    data class DocumentPage(val routineId: Long?) : BeigeBoardScreen
}

/** The tab's first screen shows one of these; the rest are pushed. */
enum class BoardSection(val label: String) { Today("Today"), Goals("Goals"), Calendar("Calendar"), Routines("Routines") }

/** The BeigeBoard tab's first screen. */
val BeigeBoardRoot: Screen = BeigeBoardScreen.Today

/**
 * What every BeigeBoard screen reads and writes: the items, and the HUD shelf. Writes are drawn
 * at once and put back if the server refuses them (the web's onUpdateItem), and a write that
 * touches a routine's occurrence reloads, since the server re-renders the routine's horizon.
 */
class Board(private val scope: CoroutineScope) {
    var state by mutableStateOf<Load<List<Item>>>(Load.Loading)
        private set
    var shelf by mutableStateOf(Shelf(emptyList(), null))
        private set
    var note by mutableStateOf<String?>(null)
    var section by mutableStateOf(BoardSection.Today)

    val items: List<Item> get() = (state as? Load.Ready)?.value ?: emptyList()
    val byId: Map<Long, Item> get() = items.associateBy { it.id }

    /** Draw [items] and [shelf] without asking the server (the screenshot renders' sample board). */
    internal fun preload(items: List<Item>, shelf: Shelf = Shelf(emptyList(), null)) {
        state = Load.Ready(items)
        this.shelf = shelf
    }

    fun load() {
        scope.launch {
            if (state !is Load.Ready) state = Load.Loading
            val r = attempt { BeigeBoardApi.items() }
            if (r is Load.Ready || state !is Load.Ready) state = r
            runCatching { AccountApi.shelf() }.onSuccess { shelf = it }
        }
    }

    private fun replace(item: Item) { state = Load.Ready(items.map { if (it.id == item.id) item else it }) }

    /** Apply [optimistic] now, then [write]; on failure, put the item back and say so. */
    private fun write(before: Item?, optimistic: Item?, write: suspend () -> Item?) {
        optimistic?.let(::replace)
        note = null
        scope.launch {
            when (val r = attempt { write() }) {
                is Load.Ready -> {
                    r.value?.let(::replace)
                    if (before?.isOccurrence == true || before?.kind == "routine") load()
                }
                is Load.Failed -> { before?.let(::replace); note = "Couldn't save: ${r.message}" }
                Load.Loading -> Unit
            }
        }
    }

    fun toggleDone(item: Item) = write(item, item.copy(completed = !item.completed)) { BeigeBoardApi.complete(item.id, !item.completed) }

    fun update(item: Item, changes: Map<String, Any?>, optimistic: Item) = write(item, optimistic) { BeigeBoardApi.update(item.id, changes) }

    /** deloadSession: the server re-renders the routine's sessions after it, so this reloads. */
    fun deload(item: Item, on: Boolean) = write(item, item.copy(deloadOverride = if (on) 1 else null)) { BeigeBoardApi.deload(item.id, on) }

    fun add(title: String, kind: String, dueDate: String?, time: String?, parentId: Long? = null, done: (Item) -> Unit = {}) {
        note = null
        scope.launch {
            // One key per add: a retry after a timeout replays the first create, never a second row.
            when (val r = attempt { BeigeBoardApi.create(Items.createBody(title, kind, dueDate, time, UUID.randomUUID().toString(), parentId)) }) {
                is Load.Ready -> { state = Load.Ready(items + r.value); done(r.value) }
                is Load.Failed -> note = "Couldn't add it: ${r.message}"
                Load.Loading -> Unit
            }
        }
    }

    fun delete(item: Item, done: () -> Unit = {}) {
        val before = items
        state = Load.Ready(items.filterNot { it.id == item.id })
        scope.launch {
            // The server deletes everything under it too (cascadeDelete): reload to show that.
            if (attempt { BeigeBoardApi.delete(item.id) } is Load.Failed) { state = Load.Ready(before); note = "Couldn't delete it." } else { done(); load() }
        }
    }

    private fun ref(item: Item) = HudRef("beigeboard", item.id.toString(), item.title, BeigeBoardApi.webBase, if (item.completed) "ok" else "accent")

    fun togglePin(item: Item) {
        val next = HudShelf.togglePin(shelf, ref(item), System.currentTimeMillis())
        val before = shelf
        shelf = shelf.copy(pins = next)
        scope.launch { if (attempt { AccountApi.setPins(next) } is Load.Failed) { shelf = before; note = "Couldn't change the pins." } }
    }

    fun toggleFocus(item: Item) {
        val next = HudShelf.toggleFocus(shelf, ref(item).copy(tone = null))
        val before = shelf
        shelf = shelf.copy(focus = next)
        scope.launch { if (attempt { AccountApi.setFocus(next) } is Load.Failed) { shelf = before; note = "Couldn't change the focus." } }
    }
}

@Composable
fun BeigeBoardTab(screen: Screen, nav: Nav) {
    val scope = rememberCoroutineScope()
    val board = remember { Board(scope) }
    LaunchedEffect(Unit) { board.load() }
    BoardScreen(screen, board, nav)
}

/** One screen of the tab, over [board]: a pushed page, or the first screen and its sections. */
@Composable
internal fun BoardScreen(screen: Screen, board: Board, nav: Nav) {
    when (screen) {
        is BeigeBoardScreen.GoalPage -> GoalScreen(screen.id, board, nav::pop, nav::push)
        is BeigeBoardScreen.RoutinePage -> RoutineScreen(screen.id, board, nav::pop, nav::push)
        is BeigeBoardScreen.DocumentPage -> DocumentScreen(screen.routineId, board, nav::pop)
        else -> Column(Modifier.fillMaxSize()) {
            Masthead(board)
            when (board.section) {
                BoardSection.Today -> TodayScreen(board, nav::push)
                BoardSection.Goals -> GoalsPane(board, nav::push)
                BoardSection.Calendar -> CalendarPane(board, nav::push)
                BoardSection.Routines -> RoutinesPane(board, nav::push)
            }
        }
    }
}

/** What each section's tab says under its name (the web's NOW / 7 DAYS / MONTH / GOALS). */
private val BoardSection.sub: String get() = when (this) {
    BoardSection.Today -> "Now"
    BoardSection.Goals -> "Workshop"
    BoardSection.Calendar -> "Month"
    BoardSection.Routines -> "Library"
}

private val FOLIO_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)

/**
 * BeigeBoard's masthead (AppHeader.tsx): the wordmark, the week folio and the clock, then the
 * section tabs, over a feathered ink rule.
 */
@Composable
private fun Masthead(board: Board) {
    val face = Jk.face
    val now = LocalDate.now()
    Column(Modifier.fillMaxWidth().mastheadRule(face.ink).padding(bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Wordmark("BeigeBoard")
            Spacer(Modifier.width(12.dp))
            // The web's edition number: ceil(day of the year / 7), not the ISO week.
            Folio("W%02d".format((now.dayOfYear + 6) / 7), now.format(FOLIO_DAY))
            Spacer(Modifier.weight(1f))
            Clock()
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (s in BoardSection.entries) MastTab(s.label, board.section == s, { board.section = s }, Modifier.weight(1f), sub = s.sub)
        }
    }
}

/** The masthead's clock (TimeReadout): 24-hour, the colon faint, the seconds smaller and dimmer. */
@Composable
private fun Clock() {
    var now by remember { mutableStateOf(LocalTime.now()) }
    val still = LocalStill.current
    LaunchedEffect(still) { while (!still) { kotlinx.coroutines.delay(1000L); now = LocalTime.now() } }
    val face = Jk.face
    Row(verticalAlignment = Alignment.Bottom) {
        Seg("%02d".format(now.hour), size = 15.sp)
        Seg(":", size = 15.sp, color = face.accent.copy(alpha = 0.4f))
        Seg("%02d".format(now.minute), size = 15.sp)
        Seg(":%02d".format(now.second), Modifier.padding(bottom = 1.dp), size = 11.sp, color = face.accent.copy(alpha = 0.6f))
    }
}

private fun todayIso(): String = LocalDate.now().toString()

private val TITLE_DATE = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)

// ── Today ──────────────────────────────────────────────────────────────────────

/**
 * Today, as the web's desktop Today (TodayView.tsx) lays it out, stacked for a phone: the day's
 * name pressed in the accent over its count, a quick add, the untimed strip, the day itself as
 * tinted chips on an hour rail with the now-line between what's past and what's next, then the
 * rail's sheets: what's running behind, the bench, goals in press and the loose leaves.
 */
@Composable
internal fun TodayScreen(board: Board, push: (Screen) -> Unit) {
    var open by remember { mutableStateOf<Item?>(null) }
    val today = todayIso()
    val face = Jk.face
    Column(Modifier.fillMaxSize()) {
        Loaded(board.state, retry = { board.load() }) { items ->
            val t = Today.of(items, today)
            val byId = board.byId
            val tree = remember(items) { Tree(items) }
            val day = remember(items, today) { Days.on(items, today) }
            val untimed = day.filter { it.scheduledTime == null }
            val timed = day.filter { it.scheduledTime != null }
            val tint = { i: Item -> accentOf(i, byId)?.let { Color(it) } ?: face.accent }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 28.dp)) {
                item {
                    PressTitle(LocalDate.now().format(TITLE_DATE) + ".", size = 30.sp)
                    Row(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Eyebrow(
                            "Day ${LocalDate.now().dayOfYear} · ${"%02d".format(t.events.size + timed.count { !it.isEvent })} timed · ${"%02d".format(untimed.size)} untimed",
                            Modifier.weight(1f),
                        )
                        TButton(quiet = true, onClick = { board.load() }) { Text("Refresh") }
                    }
                    Rule(strong = true)
                    board.note?.let { Text(it, Modifier.padding(top = 10.dp), color = face.secondary) }
                    Gap(14)
                    QuickAdd(board, today)
                    if (t.total > 0) {
                        Gap(16)
                        Row(Modifier.fillMaxWidth().padding(bottom = 7.dp)) { Eyebrow("Today", Modifier.weight(1f)); Eyebrow("${t.done.size}/${t.total}", color = face.muted) }
                        VU(t.pct / 100f)
                    }
                }
                if (untimed.isNotEmpty()) {
                    item { Strip("Untimed") }
                    items(untimed, key = { "u${it.id}" }) { ItemRow(it, byId, board, live = it == t.next) { open = it } }
                }
                if (timed.isNotEmpty()) {
                    item { Strip("The day") }
                    val nowHm = LocalTime.now().let { "%02d:%02d".format(it.hour, it.minute) }
                    val nextIdx = timed.indexOfFirst { (it.scheduledTime ?: "") >= nowHm }.let { if (it < 0) timed.size else it }
                    items(timed.size + 1, key = { i -> if (i == nextIdx) "now" else "t${timed[if (i < nextIdx) i else i - 1].id}" }) { i ->
                        if (i == nextIdx) NowLine() else {
                            val it = timed[if (i < nextIdx) i else i - 1]
                            DayBlock(it, tint(it), past = i < nextIdx, live = it == t.next, board) { open = it }
                        }
                    }
                }
                if (t.overdue.isNotEmpty()) item {
                    Gap(20)
                    Sheet(Modifier.fillMaxWidth()) {
                        SheetHead("Running behind", "${"%02d".format(t.overdue.size)} overdue")
                        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            for (o in t.overdue) ItemRow(o, byId, board, tag = Desk.short(o.dueDate ?: "").uppercase() to true) { open = o }
                        }
                    }
                }
                item {
                    val bench = Desk.bench(items, today)
                    Gap(14)
                    Sheet(Modifier.fillMaxWidth()) {
                        SheetHead("The bench", if (bench.isEmpty()) "Empty" else "${bench.count { it.completed }} of ${bench.size} done")
                        if (bench.isEmpty()) Hush("Nothing benched for the week. Park a task here from the workshop.")
                        else Column(verticalArrangement = Arrangement.spacedBy(7.dp)) { for (b in bench) ItemRow(b, byId, board) { open = b } }
                    }
                }
                item {
                    val goals = tree.goals.filter { (it.status ?: "active") == "active" }.take(3)
                    Gap(14)
                    Sheet(Modifier.fillMaxWidth()) {
                        SheetHead("Goals in press", "Workshop →") { board.section = BoardSection.Goals }
                        if (goals.isEmpty()) Hush("No goals in the press yet. Forge one in the workshop.")
                        else Column(verticalArrangement = Arrangement.spacedBy(13.dp)) {
                            for (g in goals) {
                                val p = tree.progress(g.id)
                                Column(Modifier.clickable { push(BeigeBoardScreen.GoalPage(g.id)) }, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(g.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Seg("${p.pct}%", size = 15.sp)
                                    }
                                    Bar(p.pct / 100f, tint = tint(g))
                                    Eyebrow(g.targetDate?.let { "Due ${Desk.short(it)}" } ?: "Ongoing")
                                }
                            }
                        }
                    }
                }
                item {
                    val loose = tree.loose()
                    Gap(14)
                    Sheet(Modifier.fillMaxWidth()) {
                        SheetHead("Loose leaves", if (loose.isEmpty()) "All filed" else "${"%02d".format(loose.count { !it.completed })} unfiled")
                        if (loose.isEmpty()) Hush("Every task is filed under a goal. Nothing loose.")
                        else Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            for (l in loose) ItemRow(l, byId, board, tag = Desk.looseState(l, today)) { open = l }
                        }
                    }
                }
            }
        }
    }
    open?.let { id -> board.byId[id.id]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
}

/** A section's name over the day (the web's UNTIMED / hour-rail heads): a mono eyebrow. */
@Composable
internal fun Label(text: String) = Eyebrow(text)

@Composable
private fun Strip(text: String) {
    Box(Modifier.padding(top = 20.dp, bottom = 8.dp)) { Eyebrow(text) }
}

/** The now-line: the accent across the rail, a dot at its head, the time beside it. */
@Composable
private fun NowLine() {
    val face = Jk.face
    val now = LocalTime.now()
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Seg(fmtTime("%02d:%02d".format(now.hour, now.minute)) ?: "", Modifier.width(58.dp), size = 11.sp)
        Box(Modifier.size(9.dp).clip(RoundedCornerShape(50)).background(face.accent))
        Box(Modifier.weight(1f).height(1.5.dp).background(face.accent))
    }
}

/**
 * One timed item on the day: its hour on the rail, then a SOLID chip in its tint (the timeline's
 * block) with the title knocked out in cream and the time in mono. Past blocks are spent.
 */
@Composable
private fun DayBlock(item: Item, tint: Color, past: Boolean, live: Boolean, board: Board, onOpen: () -> Unit) {
    val face = Jk.face
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).alpha(if (past && !item.completed) 0.68f else 1f), verticalAlignment = Alignment.Top) {
        Eyebrow(fmtTime(item.scheduledTime) ?: "", Modifier.width(58.dp).padding(top = 12.dp), size = 9.sp)
        Chip(tint, Modifier.weight(1f).heightIn(min = 52.dp), done = item.completed, solid = true, onClick = onOpen, padding = PaddingValues(start = 2.dp, end = 12.dp, top = 2.dp, bottom = 2.dp)) {
            if (item.isEvent) Spacer(Modifier.width(12.dp))
            else Check(item.completed, { board.toggleDone(item) }, tint = if (face.dark) tint else Color(0xFFF7EFDC), size = 16.dp, label = item.title)
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(
                    item.title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleSmall.copy(
                        color = when { item.completed -> face.faint; face.dark -> tint; else -> Color(0xFFF7EFDC) },
                        textDecoration = if (item.completed) TextDecoration.LineThrough else null,
                        shadow = if (item.completed) null else if (face.dark) haloText(tint, 60.0, 10f) else androidx.compose.ui.graphics.Shadow(Color(0x6B1E1204), androidx.compose.ui.geometry.Offset(0f, -1.5f), 0f),
                    ),
                )
                val sub = listOfNotNull(item.location, if (live) "Next up" else null).joinToString(" · ")
                if (sub.isNotEmpty()) Eyebrow(sub, color = if (face.dark) tint.mix(55.0, Color.Transparent) else Color(0xC7F7EFDC), size = 9.sp)
            }
            val span = fmtTime(item.scheduledTime)?.let { s -> fmtTime(item.scheduledEnd)?.let { "$s–$it" } ?: s } ?: ""
            Eyebrow(span, color = if (face.dark) tint.mix(55.0, Color.Transparent) else Color(0xC7F7EFDC), size = 9.sp)
        }
    }
}

/**
 * A row, as the web's rail draws one: a chip in the item's tint, a check to tick (not for an
 * event), the title pressed in Fraunces, and on the right a mono tag (a time, or where it sits).
 * [live] raises it (the next thing to do).
 */
@Composable
fun ItemRow(
    item: Item, byId: Map<Long, Item>, board: Board, hero: Boolean = false, dateShown: Boolean = false,
    live: Boolean = hero, tag: Pair<String, Boolean>? = null, onOpen: () -> Unit,
) {
    val face = Jk.face
    val tint = accentOf(item, byId)?.let { Color(it) } ?: face.accent
    Chip(tint, Modifier.fillMaxWidth().padding(vertical = 3.dp), done = item.completed, onClick = onOpen, padding = PaddingValues(start = 0.dp, end = 12.dp, top = 0.dp, bottom = 0.dp)) {
        if (item.isEvent) Spacer(Modifier.width(14.dp)) else Check(item.completed, { board.toggleDone(item) }, tint = tint, size = 18.dp, label = item.title)
        Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
            ChipTitle(item.title, tint, done = item.completed, maxLines = 2)
            val parent = item.parentId?.let(byId::get)
            val line = listOfNotNull(if (dateShown) item.dueDate?.let(Desk::short) else null, parent?.title, item.location, if (live) "Next up" else null).joinToString(" · ")
            if (line.isNotEmpty()) Eyebrow(line, Modifier.padding(top = 2.dp), size = 9.sp, color = if (live) face.accent else face.faint)
        }
        val (label, urgent) = tag ?: ((fmtTime(item.scheduledTime) ?: "") to false)
        if (label.isNotEmpty()) Eyebrow(label, size = 9.sp, color = if (urgent) face.accent else if (tag == null) tint.mix(80.0, face.ink) else face.faint)
    }
}

/** Add a task (or an event) for today, with a time if you want one. */
@Composable
private fun QuickAdd(board: Board, today: String) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var time by remember { mutableStateOf<String?>(null) }
    var event by remember { mutableStateOf(false) }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(
                value = title, onValueChange = { title = it.take(500) }, singleLine = true,
                placeholder = { Text(if (event) "Add an event for today" else "Add a task for today") }, modifier = Modifier.weight(1f),
            )
            TButton(primary = true, enabled = title.isNotBlank(), onClick = {
                board.add(title, if (event) "event" else "task", today, time)
                title = ""; time = null
            }) { Text("Add") }
        }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Choice("Task", !event) { event = false }
            Choice("Event", event) { event = true }
            Spacer(Modifier.weight(1f))
            TButton(quiet = true, onClick = {
                val now = LocalTime.now()
                TimePickerDialog(context, { _, h, m -> time = "%02d:%02d".format(h, m) }, now.hour, now.minute, false).show()
            }) { Text(fmtTime(time)?.let { "At $it" } ?: "Add a time") }
            if (time != null) TButton(quiet = true, onClick = { time = null }) { Text("No time") }
        }
    }
}

// ── one item ───────────────────────────────────────────────────────────────────

/**
 * An item's sheet: what it is, done or not, editing it, what it waits on and what waits on
 * it, taking a routine's session easy, and putting it on ORDECK (focus, pin).
 */
@Composable
fun ItemSheet(item: Item, board: Board, push: (Screen) -> Unit, preDeps: Deps? = null, onDismiss: () -> Unit) {
    val byId = board.byId
    val focused = board.shelf.isFocused("beigeboard", item.id.toString())
    val pinned = board.shelf.isPinned("beigeboard", item.id.toString())
    var confirmDelete by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    if (editing) { EditDialog(item, board) { editing = false }; return }
    Dialog(onDismissRequest = onDismiss) {
        Sheet(padding = PaddingValues(0.dp)) {
            Column(Modifier.padding(20.dp).heightIn(max = 640.dp).verticalScroll(rememberScrollState())) {
                AccentLab(item.kind)
                Gap(4)
                Text(item.title, style = MaterialTheme.typography.headlineSmall)
                val parent = item.parentId?.let(byId::get)
                val whenLine = listOfNotNull(
                    item.dueDate, fmtTime(item.scheduledTime)?.let { s -> fmtTime(item.scheduledEnd)?.let { "$s – $it" } ?: s },
                    item.endDate?.takeIf { it != item.dueDate }?.let { "until $it" },
                ).joinToString(" · ")
                if (whenLine.isNotEmpty()) Text(whenLine, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                parent?.let { Text("Under ${it.title}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                item.location?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                item.notes?.let { Text(it, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium) }
                Spacer(Modifier.height(12.dp))
                if (!item.isEvent) {
                    TButton(primary = true, onClick = { board.toggleDone(item) }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (item.completed) "Done — mark active" else "Mark complete")
                    }
                }
                if (item.isTask || item.isEvent || item.kind == "milestone") {
                    Gap(14)
                    Lab("On ORDECK")
                    Gap(6)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TButton(onClick = { board.toggleFocus(item) }, modifier = Modifier.weight(1f)) { Text(if (focused) "Focused — clear" else "Focus") }
                        TButton(onClick = { board.togglePin(item) }, modifier = Modifier.weight(1f)) { Text(if (pinned) "Pinned — unpin" else "Pin") }
                    }
                }
                if (item.isOccurrence && !item.completed) DeloadRow(item, board)
                if (item.kind != "routine") DepsSection(item, board, preDeps)
                board.note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                Row {
                    TButton(quiet = true, onClick = { editing = true }) { Text("Edit") }
                    if (item.kind == "goal") TButton(quiet = true, onClick = { onDismiss(); push(BeigeBoardScreen.GoalPage(item.id)) }) { Text("Open") }
                    TButton(quiet = true, onClick = { confirmDelete = true }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.weight(1f))
                    TButton(quiet = true, onClick = onDismiss) { Text("Close") }
                }
                if (confirmDelete) {
                    Text("Delete “${item.title}”? Anything under it goes too.", fontWeight = FontWeight.Bold)
                    Row {
                        TButton(quiet = true, onClick = { board.delete(item, onDismiss) }) { Text("Delete it", color = MaterialTheme.colorScheme.error) }
                        TButton(quiet = true, onClick = { confirmDelete = false }) { Text("Keep it") }
                    }
                }
            }
        }
    }
}
