package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.*

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import net.jkos.app.alpha.look.*

// Routines and the library (TODO §10 H4). A routine's sessions are ordinary tasks, minted under
// it with ext_ref routine:<id>:<date>: they show on Today and the calendar, and are ticked and
// taken easy there. Making or changing a routine goes through the document import the web's
// paste pane uses: write or paste the document, Check it (a dry run, rendered as numbers), then
// Import it.

// ── the section: Routines | Library ───────────────────────────────────────────

@Composable
fun RoutinesPane(
    board: Board, push: (Screen) -> Unit,
    // Sample data for the screenshot renders; null loads from BeigeBoard, as the app always does.
    routines: List<Routine>? = null, entries: List<LibraryEntry>? = null, startOnLibrary: Boolean = false,
) {
    var library by remember { mutableStateOf(startOnLibrary) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Choice("Routines", !library) { library = false }
            Choice("Library", library) { library = true }
        }
        if (library) LibraryPane(entries) else RoutineList(push, routines)
    }
}

@Composable
private fun RoutineList(push: (Screen) -> Unit, preloaded: List<Routine>?) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<Routine>>>(preloaded?.let { Load.Ready(it) } ?: Load.Loading) }
    LaunchedEffect(attemptNo) { if (preloaded == null || attemptNo > 0) state = attempt { BeigeBoardApi.routines() } }
    Loaded(state, retry = { attemptNo++ }) { routines ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TButton(onClick = { push(BeigeBoardScreen.DocumentPage(null)) }) { Text("New or import") }
                    TButton(quiet = true, onClick = { attemptNo++ }) { Text("Refresh") }
                }
                if (routines.isEmpty()) Text("No routines yet. Write one, or paste a document an assistant wrote.", Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(routines, key = { it.item.id }) { r ->
                Column(Modifier.fillMaxWidth().clickable { push(BeigeBoardScreen.RoutinePage(r.item.id)) }.padding(vertical = 12.dp)) {
                    Text(r.item.title, style = MaterialTheme.typography.titleMedium)
                    r.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    r.item.status?.takeIf { it != "active" }?.let { Text(it.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary) }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            }
        }
    }
}

// ── one routine ────────────────────────────────────────────────────────────────

internal class RoutineView(val doc: RoutineDoc, val metric: Metric?, val sessions: List<Session>, val revisions: List<Revision>)

private val MEASURES = listOf("load" to "Load", "target" to "Reps/target", "sets" to "Sets", "volume" to "Volume")

/** A routine: where its metric stands, the sessions it will prescribe next, how it has gone, what's coming up, and its versions. */
@Composable
internal fun RoutineScreen(
    id: Long, board: Board, onBack: () -> Unit, push: (Screen) -> Unit,
    preloaded: RoutineView? = null, preSeries: List<StepSeries>? = null,
) {
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<RoutineView>>(preloaded?.let { Load.Ready(it) } ?: Load.Loading) }
    var measure by remember { mutableStateOf("target") }
    var series by remember { mutableStateOf<Load<List<StepSeries>>>(preSeries?.let { Load.Ready(it) } ?: Load.Loading) }
    var open by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(id, attemptNo) {
        if (preloaded != null && attemptNo == 0) return@LaunchedEffect
        state = Load.Loading
        state = attempt {
            coroutineScope {
                val doc = async { BeigeBoardApi.routine(id) }
                val metric = async { runCatching { BeigeBoardApi.metric(id) }.getOrNull() }
                val sessions = async { BeigeBoardApi.preview(id) }
                val revisions = async { runCatching { BeigeBoardApi.revisions(id) }.getOrDefault(emptyList()) }
                RoutineView(doc.await(), metric.await(), sessions.await(), revisions.await())
            }
        }
    }
    LaunchedEffect(id, measure, attemptNo) { if (preSeries == null || attemptNo > 0 || measure != "target") series = attempt { BeigeBoardApi.series(id, measure) } }
    val title = (state as? Load.Ready)?.value?.doc?.item?.title ?: "Routine"
    Column(Modifier.fillMaxSize()) {
        Header(title, onBack) {
            TButton(quiet = true, onClick = { push(BeigeBoardScreen.DocumentPage(id)) }) { Text("Edit") }
        }
        Loaded(state, retry = { attemptNo++ }) { v ->
            val today = LocalDate.now().toString()
            val upcoming = board.items.filter { it.extRef?.startsWith("routine:$id:") == true && (it.dueDate ?: "") >= today && !it.completed }
                .sortedBy { it.dueDate }.take(8)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
                v.doc.warnings.takeIf { it.isNotEmpty() }?.let { ws -> item { Warnings(ws) } }
                v.metric?.let { m ->
                    item {
                        Label(m.label ?: "Goal")
                        Text("${fmt(m.value)} of ${fmt(m.target)} ${m.unit ?: ""}", style = MaterialTheme.typography.titleMedium)
                        Bar(m.pct / 100f, Modifier.padding(vertical = 7.dp))
                    }
                }
                item { Box(Modifier.padding(top = 16.dp)) { Label("Next sessions") } }
                items(v.sessions, key = { "s${it.cycle}" }) { SessionCard(it) }
                if (upcoming.isNotEmpty()) {
                    item { Box(Modifier.padding(top = 16.dp)) { Label("Coming up") } }
                    items(upcoming, key = { "u${it.id}" }) { ItemRow(it, board.byId, board, dateShown = true) { open = it.id } }
                }
                item {
                    Box(Modifier.padding(top = 16.dp)) { Label("How it has gone") }
                    Row { for ((k, label) in MEASURES) Choice(label, measure == k) { measure = k } }
                    Row {
                        Text("— prescribed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        Text("   ● performed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
                        Text("   ● short of it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
                when (val s = series) {
                    Load.Loading -> item { Text("…") }
                    is Load.Failed -> item { TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry: ${s.message}") } }
                    is Load.Ready -> items(s.value, key = { "g${it.key}" }) { SeriesChart(it) }
                }
                if (v.revisions.isNotEmpty()) {
                    item { Box(Modifier.padding(top = 16.dp)) { Label("Versions") } }
                    items(v.revisions, key = { "r${it.version}" }) { r ->
                        Column(Modifier.padding(vertical = 4.dp)) {
                            Text("v${r.version}" + (if (r.current) " · current" else "") + (r.createdAt?.take(10)?.let { " · $it" } ?: ""), fontWeight = if (r.current) FontWeight.Bold else FontWeight.Normal)
                            r.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            r.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                        }
                    }
                }
            }
        }
    }
    open?.let { oid -> board.byId[oid]?.let { ItemSheet(it, board, push) { open = null } } ?: run { open = null } }
}

private fun fmt(d: Double) = if (d % 1.0 == 0.0) d.toLong().toString() else "%.1f".format(java.util.Locale.ROOT, d)

@Composable
private fun Warnings(ws: List<Warning>) {
    Column(Modifier.padding(vertical = 8.dp)) {
        Label("Worth a look")
        for (w in ws) Text("• " + w.message + (w.path?.let { "  ($it)" } ?: ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
    }
}

@Composable
private fun SessionCard(s: Session) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(listOfNotNull("Session ${s.cycle + 1}", s.phase, if (s.deload) "deload" else null).joinToString(" · "), style = MaterialTheme.typography.labelLarge)
        for (st in s.steps) Text("${st.title}: ${st.line ?: ""}", style = MaterialTheme.typography.bodySmall)
    }
}

/** Prescribed (a line) against performed (dots), per session. */
@Composable
private fun SeriesChart(s: StepSeries) {
    // The face's primary and secondary are both the accent: performed is its "ok" green, and a
    // session that fell short of what was prescribed its danger red.
    val prescribed = MaterialTheme.colorScheme.primary
    val performed = MaterialTheme.colorScheme.tertiary
    val missed = MaterialTheme.colorScheme.error
    val pts = s.points
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(s.title, style = MaterialTheme.typography.bodyMedium)
        val values = pts.flatMap { listOfNotNull(it.prescribed, it.performed) }
        if (pts.size < 2 || values.isEmpty()) {
            Text("Not enough sessions yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        val flat = values.min() == values.max()
        // A flat series is drawn through the middle, not along the floor.
        val lo = values.min() - if (flat) 1 else 0
        val hi = values.max() + if (flat) 1 else 0
        Canvas(Modifier.fillMaxWidth().height(72.dp)) {
            val dx = size.width / (pts.size - 1)
            fun y(v: Double) = (size.height - ((v - lo) / (hi - lo) * size.height)).toFloat()
            for (i in 1 until pts.size) {
                val a = pts[i - 1].prescribed; val b = pts[i].prescribed
                if (a != null && b != null) drawLine(prescribed, Offset((i - 1) * dx, y(a)), Offset(i * dx, y(b)), strokeWidth = 3f)
            }
            pts.forEachIndexed { i, p -> p.performed?.let { drawCircle(if (p.met == false) missed else performed, 7f, Offset(i * dx, y(it))) } }
        }
        Text(
            if (flat) "${fmt(values.min())} every session, over ${pts.size}" else "${fmt(values.min())} – ${fmt(values.max())} over ${pts.size} sessions",
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── a document: write or paste, check, import ─────────────────────────────────

/** What a new routine's document starts as: the smallest one the import takes. */
private const val NEW_DOC = """{
  "title": "",
  "days": ["mon", "thu"],
  "spec": {
    "steps": [
      { "title": "", "sets": 3, "target": 8, "unit": "reps" }
    ]
  }
}"""

/**
 * A routine's document (or a bundle of routines and library entries), edited as text. Check
 * runs the import's dry run: validated and rendered as numbers, nothing written. Import is
 * offered once the text in the box is the text that was checked. Only the keys the import
 * declares are sent; any other key is listed as not sent.
 */
@Composable
internal fun DocumentScreen(routineId: Long?, board: Board, onBack: () -> Unit, preText: String? = null, preReport: ImportReport? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(preText ?: if (routineId == null) NEW_DOC else null) }
    var note by remember { mutableStateOf("") }
    var checked by remember { mutableStateOf<String?>(preText.takeIf { preReport?.dryRun == true }) }
    var report by remember { mutableStateOf(preReport) }
    var notSent by remember { mutableStateOf<List<String>>(emptyList()) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(routineId) {
        if (routineId != null && text == null) {
            text = when (val r = attempt { BeigeBoardApi.routine(routineId) }) {
                is Load.Ready -> r.value.document.toString(2)
                is Load.Failed -> { message = r.message; "" }
                Load.Loading -> ""
            }
        }
    }
    fun run(dryRun: Boolean) {
        val t = text ?: return
        val doc = try { JSONObject(t) } catch (e: Exception) { message = "That isn't a JSON object: ${e.message}"; return }
        val bundle = Routines.isBundle(doc)
        val f = if (bundle) Routines.bundleBody(doc) else Routines.importBody(doc, note.takeIf { routineId != null })
        notSent = f.notSent
        busy = true
        message = null
        scope.launch {
            when (val r = attempt { if (bundle) BeigeBoardApi.importBundle(f.body, dryRun) else BeigeBoardApi.importRoutine(f.body, dryRun) }) {
                is Load.Ready -> {
                    report = r.value
                    if (dryRun) checked = t else { checked = null; board.load(); message = "Imported." }
                }
                is Load.Failed -> { report = null; checked = null; message = "Refused: ${r.message}. Check the document, then try again." }
                Load.Loading -> Unit
            }
            busy = false
        }
    }
    Column(Modifier.fillMaxSize()) {
        Header(if (routineId == null) "New or import" else "Edit routine", onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TButton(onClick = {
                        val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                        clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.let { text = it; checked = null; report = null }
                    }) { Text("Paste") }
                    TButton(primary = true, enabled = !busy && !text.isNullOrBlank(), onClick = { run(dryRun = true) }) { Text("Check") }
                    TButton(primary = true, enabled = !busy && checked != null && checked == text, onClick = { run(dryRun = false) }) { Text("Import") }
                }
                if (routineId != null) {
                    Field(value = note, onValueChange = { note = it.take(500) }, singleLine = true, label = { Text("What changed (kept in its versions)") }, modifier = Modifier.fillMaxWidth())
                }
                message?.let { Text(it, Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.secondary) }
                if (notSent.isNotEmpty()) Text("Not sent (the import doesn't take them): ${notSent.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                report?.let { r ->
                    Column(Modifier.padding(vertical = 8.dp)) {
                        Label(if (r.dryRun) "Checked: nothing written yet" else "Imported")
                        for (l in r.lines) Text(l)
                        r.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        if (r.warnings.isNotEmpty()) Warnings(r.warnings)
                        for (s in r.sessions.take(4)) SessionCard(s)
                    }
                }
            }
            item {
                Field(
                    value = text ?: "", onValueChange = { text = it; report = null },
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp),
                )
            }
        }
    }
}
