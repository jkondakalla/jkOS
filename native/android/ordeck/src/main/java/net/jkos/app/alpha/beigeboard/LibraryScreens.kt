package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.*

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.*
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.sp

// The library (TODO §10 H4): the reusable sub-tasks routines are built from (exercises,
// recipes, practice pieces, chores). A step names one by its slug (`ref`) and inherits its
// unit, ladder and defaults. Browsed, edited one entry at a time (the three entry
// capabilities), and imported in bulk from a pasted library document (importLibrary).

@Composable
fun LibraryPane(preloaded: List<LibraryEntry>? = null) {
    val scope = rememberCoroutineScope()
    var attemptNo by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<List<LibraryEntry>>>(preloaded?.let { Load.Ready(it) } ?: Load.Loading) }
    var q by remember { mutableStateOf("") }
    var collection by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<LibraryEntry?>(null) }
    var adding by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(attemptNo) { if (preloaded == null || attemptNo > 0) state = attempt { BeigeBoardApi.library() } }
    fun write(done: String, block: suspend () -> Unit) {
        note = null
        scope.launch {
            note = when (val r = attempt { block() }) { is Load.Failed -> "Couldn't save: ${r.message}"; else -> done }
            attemptNo++
        }
    }
    Column(Modifier.fillMaxSize()) {
        Loaded(state, retry = { attemptNo++ }) { entries ->
            val shown = entries.filter { e ->
                (collection == null || e.collection == collection) &&
                    (q.isBlank() || listOf(e.title, e.slug, e.tags.joinToString(" "), e.variants.joinToString(" "), e.notes ?: "").any { it.contains(q.trim(), ignoreCase = true) })
            }.sortedBy { it.title.lowercase() }
            val counts = entries.groupingBy { it.collection }.eachCount()
            // The shelves that hold something, in the vocabulary's order, and the one chosen even if empty.
            val shelves = Library.COLLECTIONS.filter { (counts[it] ?: 0) > 0 || it == collection }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    // The web's library head: the shelf's name in the big serif, how many of how many.
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.Bottom) {
                        SerifHead(collection?.replaceFirstChar { it.uppercase() } ?: "Everything", 28.sp, Modifier.weight(1f, fill = false))
                        Spacer(Modifier.width(12.dp))
                        Eyebrow("%02d of %02d entries".format(shown.size, entries.size), Modifier.padding(bottom = 5.dp))
                    }
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TButton(onClick = { adding = true }) { Text("+ New entry") }
                        TButton(quiet = true, onClick = { importing = true }) { Text("⇪ Paste") }
                    }
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Choice("All %02d".format(entries.size), collection == null) { collection = null }
                        for (c in shelves) Choice("$c %02d".format(counts[c] ?: 0), collection == c) { collection = c }
                    }
                    Field(value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text("Search title, tag, ladder, notes…") }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
                    note?.let { Text(it, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.secondary) }
                    Rule(Modifier.padding(top = 12.dp, bottom = 4.dp))
                    if (shown.isEmpty()) Eyebrow(if (q.isNotBlank()) "Nothing matches" else "This shelf is empty — add an entry or paste a set", Modifier.padding(vertical = 8.dp), maxLines = 2)
                }
                items(shown, key = { it.id }) { e -> EntryCard(e) { editing = e } }
            }
        }
    }
    if (adding) EntryDialog(null, onSave = { ch -> adding = false; write("Saved.") { BeigeBoardApi.saveEntry(ch) } }, onDelete = {}) { adding = false }
    editing?.let { e ->
        EntryDialog(e, onSave = { ch -> editing = null; if (ch.isNotEmpty()) write("Saved.") { BeigeBoardApi.editEntry(e.id, ch) } },
            onDelete = { editing = null; write("Deleted.") { BeigeBoardApi.deleteEntry(e.id) } }) { editing = null }
    }
    if (importing) LibraryImportDialog(onImport = { body -> importing = false; note = "Importing…"; scope.launch {
        note = when (val r = attempt { BeigeBoardApi.importLibrary(body) }) { is Load.Ready -> "Imported: ${r.value}."; is Load.Failed -> "Refused: ${r.message}"; Load.Loading -> null }
        attemptNo++
    } }) { importing = false }
}

@Composable
private fun Pick(label: String, value: String?, options: List<String>, none: Boolean, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Box {
            TButton(quiet = true, onClick = { open = true }) { Text(value ?: "None") }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                if (none) DropdownMenuItem(text = { Text("None") }, onClick = { open = false; onPick(null) })
                for (o in options) DropdownMenuItem(text = { Text(o) }, onClick = { open = false; onPick(o) })
            }
        }
    }
}

/**
 * One entry, new ([entry] null: saveLibraryEntry) or existing (updateLibraryEntry, only what
 * changed). The slug is set once: a step's `ref` names the entry by it, so it isn't edited.
 */
@Composable
private fun EntryDialog(entry: LibraryEntry?, onSave: (Map<String, Any?>) -> Unit, onDelete: () -> Unit, onDismiss: () -> Unit) {
    var collection by remember { mutableStateOf(entry?.collection ?: "exercise") }
    var title by remember { mutableStateOf(entry?.title ?: "") }
    var slug by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf(entry?.notes ?: "") }
    var unit by remember { mutableStateOf(entry?.unit) }
    var loadUnit by remember { mutableStateOf(entry?.loadUnit) }
    var tags by remember { mutableStateOf(entry?.tags?.joinToString(", ") ?: "") }
    var variants by remember { mutableStateOf(entry?.variants?.joinToString("\n") ?: "") }
    var confirm by remember { mutableStateOf(false) }
    fun tagList() = tags.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    fun variantList() = variants.lines().map { it.trim() }.filter { it.isNotEmpty() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (entry == null) "New entry" else "Edit entry") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Pick("Collection", collection, Library.COLLECTIONS, none = false) { collection = it ?: "exercise" }
                Field(value = title, onValueChange = { title = it.take(200) }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (entry == null) Field(value = slug, onValueChange = { slug = it.take(60) }, label = { Text("Slug (from the title if empty)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                else Text("Slug: ${entry.slug}", style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
                Field(value = notes, onValueChange = { notes = it.take(2000) }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth())
                Pick("Counts in", unit, Library.UNITS, none = true) { unit = it }
                Pick("Load in", loadUnit, Library.LOAD_UNITS, none = true) { loadUnit = it }
                Field(value = tags, onValueChange = { tags = it }, label = { Text("Tags, comma-separated") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Field(value = variants, onValueChange = { variants = it }, label = { Text("Ladder: one rung a line, easiest first") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                if (entry != null) {
                    if (confirm) {
                        Text("Delete “${entry.title}”? A routine step that refs ${entry.slug} can no longer find it.", style = MaterialTheme.typography.bodySmall)
                        Row {
                            TButton(quiet = true, onClick = onDelete) { Text("Delete it", color = MaterialTheme.colorScheme.error) }
                            TButton(quiet = true, onClick = { confirm = false }) { Text("Keep it") }
                        }
                    } else TButton(quiet = true, onClick = { confirm = true }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            TButton(quiet = true, enabled = title.isNotBlank(), onClick = {
                val all = mapOf<String, Any?>(
                    "collection" to collection, "title" to title.trim(), "notes" to notes.trim().ifEmpty { null },
                    "unit" to unit, "load_unit" to loadUnit, "tags" to tagList(), "variants" to variantList(),
                )
                if (entry == null) {
                    onSave(all.filterValues { it != null && it != emptyList<String>() } + (slug.trim().takeIf { it.isNotEmpty() }?.let { mapOf("slug" to it) } ?: emptyMap()))
                } else {
                    val was = mapOf<String, Any?>(
                        "collection" to entry.collection, "title" to entry.title, "notes" to entry.notes,
                        "unit" to entry.unit, "load_unit" to entry.loadUnit, "tags" to entry.tags, "variants" to entry.variants,
                    )
                    onSave(all.filter { (k, v) -> was[k] != v })
                }
            }) { Text("Save") }
        },
        dismissButton = { TButton(quiet = true, onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Paste a library document (an export file, or a bare array of entries) and import it. */
@Composable
private fun LibraryImportDialog(onImport: (org.json.JSONObject) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import library entries") },
        text = {
            Column {
                Text("An export file, or an array of entries. Entries with a collection and slug already here are updated.", style = MaterialTheme.typography.bodySmall)
                Field(value = text, onValueChange = { text = it; error = null }, minLines = 6,
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TButton(enabled = text.isNotBlank(), onClick = {
                val body = runCatching { Library.importBody(text) }.getOrNull()
                if (body == null) error = "That isn't a library document." else onImport(body)
            }) { Text("Import") }
        },
        dismissButton = { TButton(quiet = true, onClick = onDismiss) { Text("Cancel") } },
    )
}
