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
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
    when (screen) {
        is BeigeBoardScreen.GoalPage -> GoalScreen(screen.id, board, nav::pop, nav::push)
        is BeigeBoardScreen.RoutinePage -> RoutineScreen(screen.id, board, nav::pop, nav::push)
        is BeigeBoardScreen.DocumentPage -> DocumentScreen(screen.routineId, board, nav::pop)
        else -> Column(Modifier.fillMaxSize()) {
            Header("BeigeBoard", onBack = null) {
                TextButton(onClick = { board.load() }) { Text("Refresh") }
            }
            Row(Modifier.padding(horizontal = 8.dp)) {
                for (s in BoardSection.entries) Choice(s.label, board.section == s) { board.section = s }
            }
            when (board.section) {
                BoardSection.Today -> TodayScreen(board, nav::push)
                BoardSection.Goals -> GoalsPane(board, nav::push)
                BoardSection.Calendar -> CalendarPane(board, nav::push)
                BoardSection.Routines -> RoutinesPane(board, nav::push)
            }
        }
    }
}

private fun todayIso(): String = LocalDate.now().toString()

private val DATE_LINE = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)

/** The web's getGreeting. */
private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "Good morning"
    in 12..17 -> "Good afternoon"
    else -> "Good evening"
}

// ── Today ──────────────────────────────────────────────────────────────────────

/**
 * Today (apps/beigeboard/src/mobile/views/MobileTodayView.tsx): the day's line, a meter of
 * what's done, the next thing as the hero, the rest, today's events, what's running behind, a
 * quick add, and what's done.
 */
@Composable
private fun TodayScreen(board: Board, push: (Screen) -> Unit) {
    var open by remember { mutableStateOf<Item?>(null) }
    val today = todayIso()
    Column(Modifier.fillMaxSize()) {
        Loaded(board.state, retry = { board.load() }) { items ->
            val t = Today.of(items, today)
            val byId = board.byId
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
                item {
                    Text(LocalDate.now().format(DATE_LINE).uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${greeting()}.", style = MaterialTheme.typography.displaySmall, fontStyle = FontStyle.Italic)
                    Text(
                        if (t.active.isNotEmpty()) "${t.active.size} thing${if (t.active.size > 1) "s" else ""} on the reel" +
                            (if (t.overdue.isNotEmpty()) ", ${t.overdue.size} running behind" else "") + "."
                        else "The tape is clear today.",
                        style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    board.note?.let { Text(it, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.secondary) }
                    if (t.total > 0) {
                        Spacer(Modifier.height(16.dp))
                        Row { Label("Today"); Spacer(Modifier.weight(1f)); Label("${t.done.size}/${t.total}") }
                        LinearProgressIndicator(progress = { t.pct / 100f }, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).height(8.dp))
                    }
                    Spacer(Modifier.height(12.dp))
                    QuickAdd(board, today)
                }
                t.next?.let { next ->
                    item { Section("Next up") }
                    item { ItemRow(next, byId, board, hero = true) { open = next } }
                }
                if (t.rest.isNotEmpty()) {
                    item { Section("Other things") }
                    items(t.rest, key = { it.id }) { ItemRow(it, byId, board) { open = it } }
                }
                if (t.events.isNotEmpty()) {
                    item { Section("Events") }
                    items(t.events, key = { "e${it.id}" }) { ItemRow(it, byId, board) { open = it } }
                }
                if (t.overdue.isNotEmpty()) {
                    item { Section("Running behind") }
                    items(t.overdue, key = { "o${it.id}" }) { ItemRow(it, byId, board, dateShown = true) { open = it } }
                }
                if (t.done.isNotEmpty()) {
                    item { Section("Done") }
                    items(t.done, key = { "d${it.id}" }) { ItemRow(it, byId, board) { open = it } }
                }
            }
        }
    }
    open?.let { id -> board.byId[id.id]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
}

@Composable
internal fun Label(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Section(text: String) {
    Box(Modifier.padding(top = 20.dp, bottom = 6.dp)) { Label(text) }
}

/** A row: its accent down the side, a box to tick (not for an event), the title and the time. */
@Composable
fun ItemRow(item: Item, byId: Map<Long, Item>, board: Board, hero: Boolean = false, dateShown: Boolean = false, onOpen: () -> Unit) {
    val accent = accentOf(item, byId)?.let { Color(it) } ?: MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(4.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .then(if (hero) Modifier.border(2.dp, accent, shape) else Modifier)
            .clickable(onClick = onOpen)
            .padding(horizontal = 4.dp, vertical = if (hero) 8.dp else 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!hero) Box(Modifier.width(3.dp).height(36.dp).background(accent))
        if (item.isEvent) {
            Spacer(Modifier.width(16.dp))
        } else {
            Checkbox(checked = item.completed, onCheckedChange = { board.toggleDone(item) }, colors = CheckboxDefaults.colors(checkedColor = accent))
        }
        Column(Modifier.weight(1f)) {
            Text(
                item.title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                style = if (hero) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
                color = if (item.completed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
                textDecoration = if (item.completed) TextDecoration.LineThrough else null,
            )
            val parent = item.parentId?.let(byId::get)
            val line = listOfNotNull(if (dateShown) item.dueDate else null, parent?.title, item.location).joinToString(" · ")
            if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        fmtTime(item.scheduledTime)?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = accent) }
        Spacer(Modifier.width(8.dp))
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
            OutlinedTextField(
                value = title, onValueChange = { title = it.take(500) }, singleLine = true,
                placeholder = { Text(if (event) "Add an event for today" else "Add a task for today") }, modifier = Modifier.weight(1f),
            )
            Button(enabled = title.isNotBlank(), onClick = {
                board.add(title, if (event) "event" else "task", today, time)
                title = ""; time = null
            }) { Text("Add") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Choice("Task", !event) { event = false }
            Choice("Event", event) { event = true }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = {
                val now = LocalTime.now()
                TimePickerDialog(context, { _, h, m -> time = "%02d:%02d".format(h, m) }, now.hour, now.minute, false).show()
            }) { Text(fmtTime(time)?.let { "At $it" } ?: "Add a time") }
            if (time != null) TextButton(onClick = { time = null }) { Text("No time") }
        }
    }
}

// ── one item ───────────────────────────────────────────────────────────────────

/**
 * An item's sheet: what it is, done or not, editing it, what it waits on and what waits on
 * it, taking a routine's session easy, and putting it on ORDECK (focus, pin).
 */
@Composable
fun ItemSheet(item: Item, board: Board, push: (Screen) -> Unit, onDismiss: () -> Unit) {
    val byId = board.byId
    val focused = board.shelf.isFocused("beigeboard", item.id.toString())
    val pinned = board.shelf.isPinned("beigeboard", item.id.toString())
    var confirmDelete by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    if (editing) { EditDialog(item, board) { editing = false }; return }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(20.dp).heightIn(max = 640.dp).verticalScroll(rememberScrollState())) {
                Label(item.kind)
                Text(item.title, style = MaterialTheme.typography.titleLarge)
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
                    Button(onClick = { board.toggleDone(item) }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (item.completed) "Done — mark active" else "Mark complete")
                    }
                }
                if (item.isTask || item.isEvent || item.kind == "milestone") {
                    Label("On ORDECK")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { board.toggleFocus(item) }, modifier = Modifier.weight(1f)) { Text(if (focused) "Focused — clear" else "Focus") }
                        OutlinedButton(onClick = { board.togglePin(item) }, modifier = Modifier.weight(1f)) { Text(if (pinned) "Pinned — unpin" else "Pin") }
                    }
                }
                if (item.isOccurrence && !item.completed) DeloadRow(item, board)
                if (item.kind != "routine") DepsSection(item, board)
                board.note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                Row {
                    TextButton(onClick = { editing = true }) { Text("Edit") }
                    if (item.kind == "goal") TextButton(onClick = { onDismiss(); push(BeigeBoardScreen.GoalPage(item.id)) }) { Text("Open") }
                    TextButton(onClick = { confirmDelete = true }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onDismiss) { Text("Close") }
                }
                if (confirmDelete) {
                    Text("Delete “${item.title}”? Anything under it goes too.", fontWeight = FontWeight.Bold)
                    Row {
                        TextButton(onClick = { board.delete(item, onDismiss) }) { Text("Delete it", color = MaterialTheme.colorScheme.error) }
                        TextButton(onClick = { confirmDelete = false }) { Text("Keep it") }
                    }
                }
            }
        }
    }
}
