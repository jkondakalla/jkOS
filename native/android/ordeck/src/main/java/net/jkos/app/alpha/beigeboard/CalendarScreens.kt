package net.jkos.app.alpha.beigeboard

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import net.jkos.app.alpha.look.TButton

// The calendar (TODO §10 H3): a week as a list of days (the web's MobileWeekAgenda) and a month
// as a grid with the chosen day's agenda under it (MobileCalendarMonth), over the same items.
// Connected calendars can be pulled (syncCalendar) or forgotten (disconnectCalendar) here;
// connecting one is an OAuth redirect bound to a browser session, so it stays on the web.

private val FULL = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)
private val SHORT = DateTimeFormatter.ofPattern("MMM d", Locale.US)
private val MONTH = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)

@Composable
fun CalendarPane(board: Board, push: (Screen) -> Unit, startOnMonth: Boolean = false, today0: LocalDate? = null) {
    val now = today0 ?: LocalDate.now()
    var month by remember { mutableStateOf(startOnMonth) }
    var weekOf by remember { mutableStateOf(now.toString()) }
    var ym by remember { mutableStateOf(YearMonth.from(now)) }
    var day by remember { mutableStateOf(now.toString()) }
    var open by remember { mutableStateOf<Long?>(null) }
    var calendars by remember { mutableStateOf(false) }
    val today = now.toString()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Choice("Week", !month) { month = false }
            Choice("Month", month) { month = true }
            Spacer(Modifier.weight(1f))
            TButton(quiet = true, onClick = { calendars = true }) { Text("Calendars") }
        }
        Loaded(board.state, retry = { board.load() }) { items ->
            val byId = board.byId
            if (!month) {
                val days = Days.week(weekOf)
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 28.dp)) {
                    item { WeekHead(days, today, onShift = { n -> weekOf = LocalDate.parse(weekOf).plusWeeks(n.toLong()).toString() }, onThisWeek = { weekOf = today }) }
                    for (iso in days) {
                        val on = Days.on(items, iso)
                        item(key = "h$iso") { DayHead(iso, iso == today, on.size) }
                        if (on.isEmpty()) item(key = "e$iso") { Open() }
                        items(on, key = { "$iso:${it.id}" }) { AgendaRow(it, byId, board, shadeEvent = true, indent = true) { open = it.id } }
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 28.dp)) {
                    item { MonthGrid(items, byId, ym, day, today, onMonth = { ym = it }, onDay = { day = it }) }
                    item { MonthAgendaHead(day, day == today) { t -> board.add(t, "task", day, null) } }
                    val on = Days.on(items, day)
                    if (on.isEmpty()) item { Open("Nothing scheduled.") }
                    items(on, key = { it.id }) { AgendaRow(it, byId, board, shadeEvent = false, indent = false) { open = it.id } }
                }
            }
        }
    }
    open?.let { oid -> board.byId[oid]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
    if (calendars) CalendarsDialog(board) { calendars = false }
}

// ── the week (the web's MobileWeekAgenda) ──────────────────────────────────────

private val serifNum = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic)

@Composable
private fun WeekHead(days: List<String>, today: String, onShift: (Int) -> Unit, onThisWeek: () -> Unit) {
    val face = Jk.face
    val thisWeek = today in days
    Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f)) {
            Lab(if (thisWeek) "This week" else "The week of")
            Text("7 days", Modifier.padding(top = 4.dp), style = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Medium, fontSize = 30.sp, letterSpacing = (-0.02).em, color = face.ink))
        }
        Column(horizontalAlignment = Alignment.End) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Arrow("‹", "Previous week") { onShift(-1) }
                Text(
                    "${LocalDate.parse(days.first()).format(SHORT)} – ${LocalDate.parse(days.last()).format(SHORT)}",
                    style = serifNum.copy(fontSize = 13.sp, color = face.muted),
                )
                Arrow("›", "Next week") { onShift(1) }
            }
            if (!thisWeek) Text("THIS WEEK", Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = onThisWeek).padding(horizontal = 8.dp, vertical = 6.dp),
                style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, letterSpacing = 0.14.em, color = face.accent))
        }
    }
}

/** A thumb-sized ‹ or ›. */
@Composable
private fun Arrow(glyph: String, label: String, onClick: () -> Unit) {
    val face = Jk.face
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(50)).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Text(glyph, style = TextStyle(fontSize = 20.sp, color = face.ink))
    }
}

/** A day's head: its date in the italic serif, its weekday in tracked caps, a lamp on today, a rule, how many. */
@Composable
private fun DayHead(iso: String, isToday: Boolean, count: Int) {
    val face = Jk.face
    val d = LocalDate.parse(iso)
    val tone = if (isToday) face.accent else face.muted
    Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(d.dayOfMonth.toString(), Modifier.width(32.dp), style = serifNum.copy(fontSize = 17.sp, color = if (isToday) face.accent else face.ink, shadow = if (isToday) haloText(face.accent) else null))
        Text(d.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, Locale.US).uppercase(),
            style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, fontSize = 10.sp, letterSpacing = 0.22.em, color = tone, shadow = if (isToday) haloText(face.accent) else null))
        if (isToday) { Spacer(Modifier.width(9.dp)); Lamp("Today") }
        Spacer(Modifier.width(9.dp))
        Box(Modifier.weight(1f).height(1.dp).background(face.lineStrong))
        if (count > 0) Text(count.toString(), Modifier.padding(start = 9.dp), style = serifNum.copy(fontSize = 12.sp, color = face.faint))
    }
}

/** An empty day ("open"), in the faint italic serif. */
@Composable
private fun Open(text: String = "open") {
    Text(text, Modifier.padding(start = 32.dp, bottom = 4.dp), style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 13.sp, color = Jk.face.faint.copy(alpha = 0.7f)))
}

/**
 * The web's agenda row: a 2dp bar in the item's colour (its own, its source's, its goal's; else
 * the muted ink), a check for a task or a ◇ for an event, the title in the serif (an event's in
 * italic), and its time in italic in that colour. [shadeEvent] sinks an event's row (the week).
 */
@Composable
internal fun AgendaRow(item: Item, byId: Map<Long, Item>, board: Board, shadeEvent: Boolean, indent: Boolean, onOpen: () -> Unit) {
    val face = Jk.face
    val tint = agendaTint(item, byId)?.let { Color(it) } ?: face.muted
    Row(
        Modifier.fillMaxWidth().padding(start = if (indent) 32.dp else 0.dp, bottom = 5.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(if (shadeEvent && item.isEvent) Color.Black.copy(alpha = if (face.dark) 0.22f else 0.06f) else Color.Transparent)
            .drawBehind { drawRect(tint, size = androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height)) }
            .clickable(onClick = onOpen)
            .defaultMinSize(minHeight = 44.dp)
            .padding(start = 8.dp, end = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) {
            if (item.isEvent) Text("◇", style = TextStyle(fontSize = 10.sp, color = tint))
            else Box(Modifier.wrapContentWidth(unbounded = true)) { Check(item.completed, { board.toggleDone(item) }, tint = tint, size = 16.dp, label = item.title) }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            item.title, Modifier.weight(1f),
            style = TextStyle(
                fontFamily = JkFonts.Serif, fontSize = 15.sp, fontStyle = if (item.isEvent) FontStyle.Italic else FontStyle.Normal,
                color = if (item.completed) face.muted else face.ink, textDecoration = if (item.completed) TextDecoration.LineThrough else null,
            ),
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        fmtTime(item.scheduledTime)?.let { Text(it, Modifier.padding(start = 8.dp), style = serifNum.copy(fontSize = 11.5.sp, color = tint)) }
    }
}

// ── the month (the web's MobileCalendarMonth) ──────────────────────────────────

@Composable
private fun MonthGrid(items: List<Item>, byId: Map<Long, Item>, ym: YearMonth, day: String, today: String, onMonth: (YearMonth) -> Unit, onDay: (String) -> Unit) {
    val face = Jk.face
    val cells = Days.monthCells(ym.year, ym.monthValue).let { it + List((7 - it.size % 7) % 7) { null } }
    Column {
        Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Arrow("‹", "Previous month") { onMonth(ym.minusMonths(1)) }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Lab("Calendar")
                Text(ym.atDay(1).format(MONTH), Modifier.padding(top = 3.dp),
                    style = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Medium, fontStyle = FontStyle.Italic, fontSize = 22.sp, letterSpacing = (-0.01).em, color = face.ink))
            }
            Arrow("›", "Next month") { onMonth(ym.plusMonths(1)) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp)) {
            for (d in listOf("M", "T", "W", "T", "F", "S", "S")) {
                Text(d, Modifier.weight(1f), textAlign = TextAlign.Center, style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, fontSize = 10.sp, letterSpacing = 0.12.em, color = face.faint))
            }
        }
        // The well: the month sunk into the page, as the web's grid sits in its recess.
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.22f))
                .border(1.dp, face.line, RoundedCornerShape(4.dp)).padding(6.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            for (week in cells.chunked(7)) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    for (iso in week) {
                        val isSel = iso != null && iso == day
                        val isToday = iso == today
                        Column(
                            Modifier.weight(1f).aspectRatio(1f / 1.05f).clip(RoundedCornerShape(2.dp))
                                .background(if (isSel) face.accent.mix(14.0, Color.Transparent) else Color.Transparent)
                                .border(1.dp, if (isSel) face.accent else Color.Transparent, RoundedCornerShape(2.dp))
                                .then(if (iso != null) Modifier.clickable { onDay(iso) } else Modifier)
                                .padding(top = 5.dp),
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            if (iso != null) {
                                Text(
                                    iso.takeLast(2).trimStart('0'),
                                    style = serifNum.copy(fontSize = 15.sp, fontWeight = if (isToday) FontWeight.SemiBold else FontWeight.Normal,
                                        color = if (isToday) face.accent else face.ink, shadow = if (isToday) haloText(face.accent) else null),
                                )
                                Row(Modifier.height(5.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                                    for (it in items.filter { x -> x.dueDate == iso }.take(4)) {
                                        val c = agendaTint(it, byId)?.let { t -> Color(t) } ?: face.muted
                                        Box(Modifier.size(4.dp).clip(CircleShape).background(c))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** The chosen day's head: its date (in the accent, with a lamp, when it is today), and + ADD for a task on it. */
@Composable
private fun MonthAgendaHead(day: String, isToday: Boolean, onAdd: (String) -> Unit) {
    val face = Jk.face
    var adding by remember(day) { mutableStateOf(false) }
    var title by remember(day) { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(top = 22.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Lab(LocalDate.parse(day).format(FULL), color = if (isToday) face.accent else face.muted)
            if (isToday) { Spacer(Modifier.width(9.dp)); Lamp(null) }
            Spacer(Modifier.weight(1f))
            Text("+ ADD", Modifier.clip(RoundedCornerShape(4.dp)).clickable(role = Role.Button) { adding = !adding }.padding(horizontal = 6.dp, vertical = 10.dp),
                style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, letterSpacing = 0.14.em, color = face.accent, shadow = haloText(face.accent)))
        }
        if (adding) {
            Field(
                title, { title = it.take(500) }, Modifier.fillMaxWidth().padding(bottom = 10.dp), singleLine = true,
                placeholder = { Text("New task…") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (title.isNotBlank()) { onAdd(title.trim()); title = ""; adding = false } }),
            )
        }
        Box(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 10.dp).height(1.dp).background(face.lineStrong))
    }
}

private val NAMES = mapOf("google" to "Google", "outlook" to "Outlook", "icloud" to "iCloud")

/** Each connected calendar: pull it, or forget it (with every event it brought). */
@Composable
private fun CalendarsDialog(board: Board, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<CalendarStatus>>>(Load.Loading) }
    var note by remember { mutableStateOf<String?>(null) }
    var forgetting by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(attemptNo) { state = attempt { BeigeBoardApi.PROVIDERS.map { BeigeBoardApi.calendarStatus(it) } } }
    fun act(block: suspend () -> String) {
        note = "Working…"
        scope.launch {
            note = when (val r = attempt { block() }) { is Load.Ready -> r.value; is Load.Failed -> "Couldn't: ${r.message}"; Load.Loading -> null }
            attemptNo++
            board.load()
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Calendars") },
        text = {
            Column {
                when (val s = state) {
                    Load.Loading -> Text("…")
                    is Load.Failed -> TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry: ${s.message}") }
                    is Load.Ready -> for (c in s.value) {
                        val name = NAMES[c.provider] ?: c.provider
                        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Text(name, fontWeight = FontWeight.Bold)
                            if (c.connected) {
                                Text(c.email ?: "Connected", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TButton(onClick = { act { "$name: " + BeigeBoardApi.syncCalendar(c.provider) } }) { Text("Sync now") }
                                    TButton(quiet = true, onClick = { forgetting = c.provider }) { Text("Disconnect", color = MaterialTheme.colorScheme.error) }
                                }
                                if (forgetting == c.provider) {
                                    Text("Disconnect $name? Its events leave the board too.", style = MaterialTheme.typography.bodySmall)
                                    Row {
                                        TButton(quiet = true, onClick = { forgetting = null; act { BeigeBoardApi.disconnectCalendar(c.provider); "$name disconnected." } }) { Text("Disconnect it", color = MaterialTheme.colorScheme.error) }
                                        TButton(quiet = true, onClick = { forgetting = null }) { Text("Keep it") }
                                    }
                                }
                            } else {
                                Text("Not connected. Connect it from BeigeBoard on the web.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                note?.let { Text(it, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.secondary) }
            }
        },
        confirmButton = { TButton(quiet = true, onClick = onDismiss) { Text("Done") } },
    )
}
