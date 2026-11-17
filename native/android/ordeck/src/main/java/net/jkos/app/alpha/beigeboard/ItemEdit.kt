package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.*

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.time.LocalDate

// Editing an item (TODO §10 H2): its fields through updateItem (only what changed, only what
// updateItem declares), what it waits on through addDependency / removeDependency, and a
// routine's session taken easy through deloadSession.

@Composable
private fun DateField(label: String, value: String?, onChange: (String?) -> Unit) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        TextButton(onClick = {
            val d = value?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
            DatePickerDialog(context, { _, y, m, day -> onChange(LocalDate.of(y, m + 1, day).toString()) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
        }) { Text(value ?: "None") }
        if (value != null) TextButton(onClick = { onChange(null) }) { Text("Clear") }
    }
}

@Composable
private fun TimeField(label: String, value: String?, onChange: (String?) -> Unit) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        TextButton(onClick = {
            val (h, m) = value?.split(":")?.let { (it.getOrNull(0)?.toIntOrNull() ?: 9) to (it.getOrNull(1)?.toIntOrNull() ?: 0) } ?: (9 to 0)
            TimePickerDialog(context, { _, hh, mm -> onChange("%02d:%02d".format(hh, mm)) }, h, m, false).show()
        }) { Text(fmtTime(value) ?: "None") }
        if (value != null) TextButton(onClick = { onChange(null) }) { Text("Clear") }
    }
}

/** The fields updateItem declares that this item has; Save sends only the changed ones. */
@Composable
fun EditDialog(item: Item, board: Board, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf(item.title) }
    var notes by remember { mutableStateOf(item.notes ?: "") }
    var due by remember { mutableStateOf(item.dueDate) }
    var end by remember { mutableStateOf(item.endDate) }
    var time by remember { mutableStateOf(item.scheduledTime) }
    var until by remember { mutableStateOf(item.scheduledEnd) }
    val dated = item.isTask || item.isEvent
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit ${item.kind}") },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it.take(500) }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = notes, onValueChange = { notes = it.take(5000) }, label = { Text("Notes") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                if (dated) {
                    DateField("Date", due) { due = it }
                    TimeField("Time", time) { time = it }
                    if (item.isEvent) {
                        TimeField("Ends", until) { until = it }
                        DateField("Until", end) { end = it }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = title.isNotBlank(), onClick = {
                val changes = buildMap<String, Any?> {
                    if (title.trim() != item.title) put("title", title.trim())
                    if (notes.trim() != (item.notes ?: "")) put("notes", notes.trim().ifEmpty { null })
                    if (dated) {
                        if (due != item.dueDate) put("due_date", due)
                        if (time != item.scheduledTime) put("scheduled_time", time)
                        if (item.isEvent && until != item.scheduledEnd) put("scheduled_end", until)
                        if (item.isEvent && end != item.endDate) put("end_date", end)
                    }
                }
                if (changes.isNotEmpty()) {
                    board.update(
                        item, changes,
                        item.copy(
                            title = title.trim(), notes = notes.trim().ifEmpty { null }, dueDate = due, scheduledTime = time,
                            scheduledEnd = if (item.isEvent) until else item.scheduledEnd, endDate = if (item.isEvent) end else item.endDate,
                        ),
                    )
                }
                onDismiss()
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** A routine's session: take this one easy (it costs no rung on the routine's ladder), or hand it back. */
@Composable
fun DeloadRow(item: Item, board: Board) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
        Column(Modifier.weight(1f)) {
            Text("Take this one easy")
            Text("A lighter session, and the routine doesn't move on.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = item.deloadOverride == 1, onCheckedChange = { board.deload(item, it) })
    }
}

/**
 * What this item waits on, and what waits on it (the itemDeps dataset). An item is blocked
 * while anything it waits on is unfinished; the server derives that on every read.
 */
@Composable
fun DepsSection(item: Item, board: Board, preloaded: Deps? = null) {
    val scope = rememberCoroutineScope()
    var attemptNo by remember { mutableIntStateOf(0) }
    var deps by remember { mutableStateOf<Load<Deps>>(preloaded?.let { Load.Ready(it) } ?: Load.Loading) }
    var picking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(item.id, attemptNo) { if (preloaded == null || attemptNo > 0) deps = attempt { BeigeBoardApi.deps(item.id) } }
    fun change(block: suspend () -> Deps) {
        note = null
        scope.launch {
            when (val r = attempt { block() }) {
                is Load.Ready -> deps = r
                is Load.Failed -> note = "Couldn't change that: ${r.message}"
                Load.Loading -> Unit
            }
        }
    }
    Label("Waits on")
    when (val d = deps) {
        Load.Loading -> Text("…")
        is Load.Failed -> TextButton(onClick = { attemptNo++ }) { Text("Retry: ${d.message}") }
        is Load.Ready -> {
            if (d.value.blocked) Text("Blocked: something it waits on isn't done.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            if (d.value.blockedBy.isEmpty()) Text("Nothing.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (b in d.value.blockedBy) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text((if (b.completed) "✓ " else "") + b.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { change { BeigeBoardApi.removeDependency(item.id, b.id) } }) {
                        Icon(Glyphs.Close, contentDescription = "Stop waiting on ${b.title}")
                    }
                }
            }
            OutlinedButton(onClick = { picking = true }) { Text("+ Waits on…") }
            if (d.value.blocks.isNotEmpty()) {
                Spacer(Modifier.padding(4.dp))
                Label("Waiting on this")
                for (b in d.value.blocks) Text(b.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            if (picking) {
                val taken = d.value.blockedBy.map { it.id }.toSet() + item.id
                DependencyPicker(board.items.filter { it.id !in taken && !it.completed && (it.isTask || it.kind == "milestone") }, onPick = { other ->
                    picking = false
                    change { BeigeBoardApi.addDependency(item.id, other.id) }
                }) { picking = false }
            }
        }
    }
    note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
}

@Composable
private fun DependencyPicker(candidates: List<Item>, onPick: (Item) -> Unit, onDismiss: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val shown = candidates.filter { q.isBlank() || it.title.contains(q.trim(), ignoreCase = true) }.take(100)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Waits on…") },
        text = {
            Column {
                OutlinedTextField(value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text("Find a task or list") }, modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(shown, key = { it.id }) { c ->
                        Column(Modifier.fillMaxWidth().clickable { onPick(c) }.padding(vertical = 8.dp)) {
                            Text(c.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(c.kind, c.dueDate).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
