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
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import net.jkos.app.alpha.look.TButton

// The calendar (TODO §10 H3): a week as a list of days (the web's MobileWeekAgenda) and a month
// as a grid with the chosen day's agenda under it (MobileCalendarMonth), over the same items.
// Connected calendars can be pulled (syncCalendar) or forgotten (disconnectCalendar) here;
// connecting one is an OAuth redirect bound to a browser session, so it stays on the web.

private val DAY = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.US)
private val SHORT = DateTimeFormatter.ofPattern("MMM d", Locale.US)
private val MONTH = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)

@Composable
fun CalendarPane(board: Board, push: (Screen) -> Unit, startOnMonth: Boolean = false) {
    var month by remember { mutableStateOf(startOnMonth) }
    var weekOf by remember { mutableStateOf(LocalDate.now().toString()) }
    var ym by remember { mutableStateOf(YearMonth.now()) }
    var day by remember { mutableStateOf(LocalDate.now().toString()) }
    var open by remember { mutableStateOf<Long?>(null) }
    var calendars by remember { mutableStateOf(false) }
    val today = LocalDate.now().toString()
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
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TButton(quiet = true, onClick = { weekOf = LocalDate.parse(weekOf).minusWeeks(1).toString() }) { Text("‹") }
                            Text(
                                "${LocalDate.parse(days.first()).format(SHORT)} – ${LocalDate.parse(days.last()).format(SHORT)}",
                                Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium,
                            )
                            TButton(quiet = true, onClick = { weekOf = LocalDate.parse(weekOf).plusWeeks(1).toString() }) { Text("›") }
                        }
                        if (today !in days) TButton(quiet = true, onClick = { weekOf = today }) { Text("This week") }
                    }
                    for (iso in days) {
                        item(key = "h$iso") {
                            Text(
                                LocalDate.parse(iso).format(DAY) + if (iso == today) " · today" else "",
                                Modifier.padding(top = 16.dp, bottom = 4.dp),
                                style = MaterialTheme.typography.labelLarge,
                                color = if (iso == today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = if (iso == today) FontWeight.Bold else FontWeight.Normal,
                            )
                        }
                        val on = Days.on(items, iso)
                        if (on.isEmpty()) item(key = "e$iso") { Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(on, key = { "$iso:${it.id}" }) { ItemRow(it, byId, board) { open = it.id } }
                    }
                }
            } else {
                MonthGrid(items, ym, day, today, onMonth = { ym = it }, onDay = { day = it })
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
                    item { Text(LocalDate.parse(day).format(DAY), Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.titleSmall) }
                    val on = Days.on(items, day)
                    if (on.isEmpty()) item { Text("Nothing on this day.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(on, key = { it.id }) { ItemRow(it, byId, board) { open = it.id } }
                }
            }
        }
    }
    open?.let { oid -> board.byId[oid]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
    if (calendars) CalendarsDialog(board) { calendars = false }
}

@Composable
private fun MonthGrid(items: List<Item>, ym: YearMonth, day: String, today: String, onMonth: (YearMonth) -> Unit, onDay: (String) -> Unit) {
    val cells = Days.monthCells(ym.year, ym.monthValue)
    Column(Modifier.padding(horizontal = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TButton(quiet = true, onClick = { onMonth(ym.minusMonths(1)) }) { Text("‹") }
            Text(ym.atDay(1).format(MONTH), Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
            TButton(quiet = true, onClick = { onMonth(ym.plusMonths(1)) }) { Text("›") }
        }
        Row {
            for (d in listOf("M", "T", "W", "T", "F", "S", "S")) {
                Text(d, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        for (week in cells.chunked(7)) {
            Row {
                for (i in 0 until 7) {
                    val iso = week.getOrNull(i)
                    Box(
                        Modifier.weight(1f).aspectRatio(1f).padding(2.dp)
                            .clip(CircleShape)
                            .background(if (iso != null && iso == day) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.background)
                            .then(if (iso != null) Modifier.clickable { onDay(iso) } else Modifier),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (iso != null) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    iso.takeLast(2).trimStart('0'),
                                    fontWeight = if (iso == today) FontWeight.Bold else FontWeight.Normal,
                                    color = when {
                                        iso == day -> MaterialTheme.colorScheme.onPrimary
                                        iso == today -> MaterialTheme.colorScheme.primary
                                        else -> MaterialTheme.colorScheme.onBackground
                                    },
                                )
                                val n = Days.on(items, iso).count { !it.completed }
                                if (n > 0) Box(Modifier.size(5.dp).clip(CircleShape).background(if (iso == day) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.secondary))
                            }
                        }
                    }
                }
            }
        }
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
