package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.*

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// Goals and their lists (TODO §10 H2): the tree the web's mobile tasks view draws
// (apps/beigeboard/src/mobile/views/MobileTasksView.tsx). A goal holds lists (milestones) and
// loose tasks; a list holds tasks. Progress is the leaf tasks done (Tree.progress).

@Composable
private fun Meter(p: Progress, color: Color) {
    Bar(p.pct / 100f, Modifier.padding(vertical = 7.dp), tint = color)
}

/** A title field and an Add button, for a goal, a list or a task under one. */
@Composable
fun InlineAdd(placeholder: String, onAdd: (String) -> Unit) {
    var title by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Field(value = title, onValueChange = { title = it.take(500) }, singleLine = true, placeholder = { Text(placeholder) }, modifier = Modifier.weight(1f))
        TButton(primary = true, enabled = title.isNotBlank(), onClick = { onAdd(title); title = "" }) { Text("Add") }
    }
}

/** Every goal, with its progress, and the year's meter over every task. */
@Composable
fun GoalsPane(board: Board, push: (Screen) -> Unit) {
    var adding by remember { mutableStateOf(false) }
    Loaded(board.state, retry = { board.load() }) { items ->
        val tree = Tree(items)
        val tasks = items.filter { it.isTask }
        val all = Progress(tasks.count { it.completed }, tasks.size)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
            item {
                Gap(14)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PressTitle("The workshop.", Modifier.weight(1f), size = 30.sp)
                    TButton(quiet = true, onClick = { adding = !adding }) { Text(if (adding) "Cancel" else "+ Goal") }
                }
                Row(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 10.dp)) {
                    Eyebrow("The year · ${tree.goals.size} goals", Modifier.weight(1f)); Eyebrow("${all.done}/${all.total}", color = Jk.face.muted)
                }
                Rule(strong = true)
                Gap(12)
                VU(all.pct / 100f)
                Gap(8)
                if (adding) InlineAdd("A goal for the year") { board.add(it, "goal", null, null); adding = false }
                board.note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                Spacer(Modifier.height(8.dp))
            }
            if (tree.goals.isEmpty()) item { Hush("No goals in the press yet. Forge one with + Goal.") }
            items(tree.goals, key = { it.id }) { g ->
                val accent = accentOf(g, board.byId)?.let { Color(it) } ?: MaterialTheme.colorScheme.primary
                val p = tree.progress(g.id)
                // The workshop's goal card: a sheet in the goal's own hue down its edge.
                Sheet(Modifier.fillMaxWidth().padding(vertical = 7.dp).clickable { push(BeigeBoardScreen.GoalPage(g.id)) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(g.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Seg("${p.pct}%", size = 16.sp)
                    }
                    Meter(p, accent)
                    Row {
                        Eyebrow("${p.done} of ${p.total} leaves", Modifier.weight(1f))
                        Eyebrow(
                            g.targetDate?.let { "Due ${Desk.short(it)}" } ?: when { p.total > 0 && p.pct == 100 -> "Complete"; p.pct > 0 -> "Under way"; else -> "Not started" },
                            color = if (p.pct in 1..99) accent else Jk.face.faint,
                        )
                    }
                }
            }
        }
    }
}

/** One goal: its loose tasks, its lists with their tasks, and adding to either. */
@Composable
fun GoalScreen(id: Long, board: Board, onBack: () -> Unit, push: (Screen) -> Unit) {
    var open by remember { mutableStateOf<Long?>(null) }
    var addingList by remember { mutableStateOf(false) }
    val goal = board.byId[id]
    Column(Modifier.fillMaxSize()) {
        Header(goal?.title ?: "Goal", onBack) {
            if (goal != null) TButton(quiet = true, onClick = { open = goal.id }) { Text("Details") }
        }
        Loaded(board.state, retry = { board.load() }) { items ->
            if (goal == null) { Text("This goal is gone.", Modifier.padding(24.dp)); return@Loaded }
            val tree = Tree(items)
            val byId = board.byId
            val kids = tree.children(id)
            val loose = kids.filter { it.isTask || it.isEvent }
            val lists = kids.filter { it.kind == "milestone" || it.kind == "goal" }
            val accent = accentOf(goal, byId)?.let { Color(it) } ?: MaterialTheme.colorScheme.primary
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
                item {
                    val p = tree.progress(id)
                    Meter(p, accent)
                    Text("${p.done} of ${p.total} done", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    goal.doneMeans?.let { Text("Done means: $it", Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium) }
                    goal.targetDate?.let { Text("By $it", style = MaterialTheme.typography.bodySmall) }
                    board.note?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
                }
                if (loose.isNotEmpty()) {
                    item { Text("TASKS", Modifier.padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(loose, key = { it.id }) { ItemRow(it, byId, board, dateShown = true) { open = it.id } }
                }
                item { Spacer(Modifier.height(8.dp)); InlineAdd("A task for this goal") { board.add(it, "task", null, null, parentId = id) } }
                for (l in lists) {
                    item(key = "l${l.id}") {
                        val lp = tree.progress(l.id)
                        val lAccent = accentOf(l, byId)?.let { Color(it) } ?: accent
                        Column(Modifier.padding(top = 20.dp).clickable { open = l.id }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(l.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                Text("${lp.done}/${lp.total}", style = MaterialTheme.typography.labelMedium, color = lAccent)
                            }
                            Meter(lp, lAccent)
                        }
                    }
                    items(tree.children(l.id), key = { it.id }) { ItemRow(it, byId, board, dateShown = true) { open = it.id } }
                    item(key = "a${l.id}") { InlineAdd("A task for ${l.title}") { board.add(it, "task", null, null, parentId = l.id) } }
                }
                item {
                    Spacer(Modifier.height(16.dp))
                    if (addingList) InlineAdd("A list (a milestone)") { board.add(it, "milestone", null, null, parentId = id); addingList = false }
                    else TButton(quiet = true, onClick = { addingList = true }) { Text("+ Add list") }
                }
            }
        }
    }
    open?.let { oid -> board.byId[oid]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
}
