package net.jkos.app.alpha.beigeboard

import org.json.JSONArray
import org.json.JSONObject

// Routines and the library (TODO §10 H4), as this app reads and writes them. The shapes are
// BeigeBoard's routines, routine, routinePreview, routineSeries, routineMetric, routineRevisions
// and library datasets; the writes are importRoutine, importRoutineBundle, importLibrary and the
// three library entry capabilities. Pure, so the JVM test holds it.
//
// A routine is CHANGED the way the web changes one: its document is read, edited and imported
// again (the slug makes it an update). A document is text the person wrote or pasted, so the
// body sent is only the keys its capability declares, and any other key is named back to them
// as not sent, never quietly forwarded. check:native holds each field list here to its
// capability's declared body, and the vocabularies to @jkos/routine-spec's.

data class Warning(val path: String?, val code: String?, val message: String)

data class Routine(val item: Item, val summary: String?)

data class RoutineDoc(val item: Item, val document: JSONObject, val warnings: List<Warning>)

data class RxStep(val key: String, val title: String, val line: String?)

/** One rendered session: what the routine prescribes at [cycle]. */
data class Session(val cycle: Int, val phase: String?, val deload: Boolean, val line: String?, val steps: List<RxStep>)

data class Point(val cycle: Int, val date: String?, val completed: Boolean, val deload: Boolean, val prescribed: Double?, val performed: Double?, val met: Boolean?)

data class StepSeries(val key: String, val title: String, val points: List<Point>)

data class Metric(val measure: String?, val unit: String?, val label: String?, val target: Double, val value: Double, val pct: Int)

data class Revision(val version: Int, val current: Boolean, val summary: String?, val note: String?, val createdAt: String?)

data class LibraryEntry(
    val id: Long,
    val collection: String,
    val slug: String,
    val title: String,
    val notes: String?,
    val unit: String?,
    val loadUnit: String?,
    val tags: List<String>,
    val variants: List<String>,
    val source: String?,
)

/** What an import (or its dry run) answered, for the screen to show. */
data class ImportReport(
    val dryRun: Boolean,
    /** "create" / "update" for one routine; for a bundle, one line per half. */
    val lines: List<String>,
    val summary: String?,
    val warnings: List<Warning>,
    val sessions: List<Session>,
)

/** A body ready to send, and the keys of what was given that its capability doesn't declare. */
data class Filtered(val body: JSONObject, val notSent: List<String>)

object Routines {
    private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
    private fun JSONObject.num(k: String): Double? = if (!has(k) || isNull(k)) null else optDouble(k).takeUnless { it.isNaN() }
    private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.opt(it)?.let { v -> if (v is JSONObject) v.str("title") ?: v.str("name") else v.toString() }?.takeIf(String::isNotBlank) }

    // ── field lists (check:native holds each to its capability's declared body) ──

    /** importRoutine's declared body. */
    val IMPORT_FIELDS = setOf("slug", "title", "days", "cadence_count", "time", "spec", "notes", "cadence_days", "cadence", "end_time", "accent", "status", "revision_note")

    /** importRoutineBundle's declared body. */
    val BUNDLE_FIELDS = setOf("kind", "library", "routines", "routine")

    // ── reads ──

    fun warnings(a: JSONArray?): List<Warning> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { i ->
        when (val w = a.opt(i)) {
            is JSONObject -> Warning(w.str("path"), w.str("code"), w.str("message") ?: w.str("code") ?: "")
            is String -> Warning(null, null, w)
            else -> null
        }
    }

    fun routines(json: String): List<Routine> {
        val a = JSONArray(json)
        return (0 until a.length()).map { val o = a.getJSONObject(it); Routine(Items.item(o), o.str("summary")) }
    }

    fun routine(json: String): RoutineDoc {
        val o = JSONObject(json)
        return RoutineDoc(Items.item(o), o.optJSONObject("document") ?: JSONObject(), warnings(o.optJSONArray("warnings")))
    }

    fun session(o: JSONObject): Session {
        val steps = o.optJSONArray("steps")
        return Session(
            o.optInt("cycle"), o.str("phase"), o.optBoolean("deload"), o.str("line"),
            if (steps == null) emptyList() else (0 until steps.length()).map { val s = steps.getJSONObject(it); RxStep(s.optString("key"), s.str("title") ?: s.optString("key"), s.str("line")) },
        )
    }

    fun sessions(a: JSONArray?): List<Session> = if (a == null) emptyList() else (0 until a.length()).map { session(a.getJSONObject(it)) }

    /** routinePreview → its sessions. */
    fun preview(json: String): List<Session> = sessions(JSONObject(json).optJSONArray("sessions"))

    fun series(json: String): List<StepSeries> {
        val steps = JSONObject(json).optJSONArray("steps") ?: return emptyList()
        return (0 until steps.length()).map { i ->
            val s = steps.getJSONObject(i)
            val pts = s.optJSONArray("points") ?: JSONArray()
            StepSeries(s.optString("key"), s.str("title") ?: s.optString("key"), (0 until pts.length()).map { j ->
                val p = pts.getJSONObject(j)
                Point(p.optInt("cycle"), p.str("date"), p.optBoolean("completed"), p.optBoolean("deload"), p.num("prescribed"), p.num("performed"),
                    if (!p.has("met") || p.isNull("met")) null else p.optBoolean("met"))
            })
        }
    }

    /** routineMetric → its metric, or null for a routine with none. */
    fun metric(json: String): Metric? {
        val m = JSONObject(json).optJSONObject("metric") ?: return null
        return Metric(m.str("measure"), m.str("unit"), m.str("label"), m.num("target") ?: 0.0, m.num("value") ?: 0.0, m.optInt("pct"))
    }

    fun revisions(json: String): List<Revision> {
        val a = JSONObject(json).optJSONArray("revisions") ?: return emptyList()
        return (0 until a.length()).map { val r = a.getJSONObject(it); Revision(r.optInt("version"), r.optBoolean("current"), r.str("summary"), r.str("note"), r.str("created_at")) }
    }

    // ── documents ──

    /** A bundle (library entries, routines, or both) rather than one routine: the web's paste pane tells them apart the same way. */
    fun isBundle(doc: JSONObject): Boolean =
        doc.str("kind") == "jkos.beigeboard.bundle" || doc.has("library") || doc.has("routines") || doc.has("routine")

    private fun keep(doc: JSONObject, fields: Set<String>): Filtered {
        val out = JSONObject()
        val dropped = mutableListOf<String>()
        for (k in doc.keys()) if (k in fields) out.put(k, doc.get(k)) else dropped += k
        return Filtered(out, dropped.sorted())
    }

    /** importRoutine's body from a document: the declared keys, and a revision note when one is given. */
    fun importBody(doc: JSONObject, revisionNote: String? = null): Filtered {
        val f = keep(doc, IMPORT_FIELDS)
        if (!revisionNote.isNullOrBlank()) f.body.put("revision_note", revisionNote.trim())
        return f
    }

    fun bundleBody(doc: JSONObject): Filtered = keep(doc, BUNDLE_FIELDS)

    /** importRoutine's answer, real or dry. */
    fun routineReport(json: String): ImportReport {
        val o = JSONObject(json)
        val dry = o.optBoolean("dryRun")
        val what = if (dry) "Would ${o.optString("action", "import")} “${o.optString("slug")}”"
        else (if (o.optBoolean("created")) "Made “" else "Updated “") + o.optString("slug") + "”" + (o.optInt("minted").takeIf { it > 0 }?.let { ", $it sessions ahead" } ?: "")
        return ImportReport(dry, listOf(what), o.str("summary"), warnings(o.optJSONArray("warnings")), sessions(o.optJSONArray("sessions")))
    }

    /** importRoutineBundle's answer, real or dry: one line for the library half, one per routine. */
    fun bundleReport(json: String): ImportReport {
        val o = JSONObject(json)
        val lines = mutableListOf<String>()
        o.optJSONObject("library")?.let { l -> lines += "Library: ${l.optInt("created")} new, ${l.optInt("updated")} updated" }
        val rs = o.optJSONArray("routines") ?: JSONArray()
        val sessions = mutableListOf<Session>()
        for (i in 0 until rs.length()) {
            val r = rs.getJSONObject(i)
            val act = r.str("action") ?: if (r.optBoolean("created")) "created" else "updated"
            lines += "Routine “${r.optString("slug", r.optString("title"))}”: $act"
            sessions += sessions(r.optJSONArray("sessions"))
        }
        return ImportReport(o.optBoolean("dryRun"), lines, null, warnings(o.optJSONArray("warnings")), sessions)
    }
}

object Library {
    private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }

    /** saveLibraryEntry's declared fields. */
    val SAVE_FIELDS = setOf("slug", "collection", "title", "notes", "unit", "load_unit", "tags", "variants", "defaults")

    /** updateLibraryEntry's: no slug. A step's `ref` names an entry by its slug, so changing one would orphan every step that used it. */
    val EDIT_FIELDS = setOf("collection", "title", "notes", "unit", "load_unit", "tags", "variants", "defaults")

    // The vocabularies, as @jkos/routine-spec has them (check:native holds them equal).
    val COLLECTIONS = listOf("exercise", "recipe", "practice", "study", "chore", "custom")
    val UNITS = listOf("reps", "sec", "min", "m", "km", "mi", "pages", "count", "kcal", "g", "ml")
    val LOAD_UNITS = listOf("lb", "kg", "bw", "band", "level", "plate", "%")

    fun entries(json: String): List<LibraryEntry> {
        val a = JSONArray(json)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            fun list(k: String) = o.optJSONArray(k)?.let { arr -> (0 until arr.length()).mapNotNull { arr.opt(it)?.toString()?.takeIf(String::isNotBlank) } } ?: emptyList()
            LibraryEntry(o.getLong("id"), o.optString("collection", "custom"), o.optString("slug"), o.optString("title"), o.str("notes"),
                o.str("unit"), o.str("load_unit"), list("tags"), list("variants"), o.str("source"))
        }
    }

    /** A save ([edit] false) or an edit: only that capability's declared fields, each as the server reads it (tags and variants as arrays). */
    fun body(changes: Map<String, Any?>, edit: Boolean): JSONObject = JSONObject().apply {
        val fields = if (edit) EDIT_FIELDS else SAVE_FIELDS
        for ((k, v) in changes) {
            require(k in fields) { "${if (edit) "updateLibraryEntry" else "saveLibraryEntry"} does not declare $k" }
            put(k, when (v) { null -> JSONObject.NULL; is List<*> -> JSONArray(v); else -> v })
        }
    }

    /** importLibrary's body from a pasted library document: its entries (an export file, or a bare array). */
    fun importBody(text: String): JSONObject? {
        val t = text.trim()
        val entries = when {
            t.startsWith("[") -> JSONArray(t)
            t.startsWith("{") -> JSONObject(t).let { it.optJSONArray("entries") ?: it.optJSONArray("library") } ?: return null
            else -> return null
        }
        return JSONObject().put("entries", entries)
    }
}

/** One day of a routine's week strip (the web's weekCells, apps/beigeboard/src/lib/routines.ts). */
enum class CellState { Off, Idle, Skipped, Planned, Open, Missed, Done }

data class WeekCell(val iso: String, val committed: Boolean, val state: CellState)

/**
 * A routine's week, as the web's Workshop draws it on a routine's card: which days it commits
 * to, what each day of this week holds, and the streak. An occurrence is a row the engine
 * minted under the routine (parent_id AND a `routine:` ext_ref), so a task filed under a routine
 * by hand is never counted. Pure: the JVM test holds it.
 */
object Cadence {
    /** The committed day offsets, 0 = Monday, sorted and de-duped; anything malformed is dropped. */
    fun days(r: Item): List<Int> = (r.cadenceDays ?: "").split(',').mapNotNull { it.trim().toIntOrNull()?.takeIf { n -> n in 0..6 } }.distinct().sorted()

    /** The weekly target: an explicit count, else the committed days. */
    fun weeklyTarget(r: Item): Int = r.cadenceCount?.coerceAtLeast(0) ?: days(r).size

    fun skips(r: Item): Set<String> = (r.cadenceSkips ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

    fun occurrences(r: Item, items: List<Item>): List<Item> = items.filter { it.parentId == r.id && it.isOccurrence }

    /** The seven cells of the week starting [weekStart] (a Monday). */
    fun week(r: Item, items: List<Item>, weekStart: String, today: String): List<WeekCell> {
        val committed = days(r).toSet()
        val skips = skips(r)
        val byDate = occurrences(r, items).filter { it.dueDate != null }.associateBy { it.dueDate!! }
        val start = java.time.LocalDate.parse(weekStart)
        return (0 until 7).map { offset ->
            val iso = start.plusDays(offset.toLong()).toString()
            val o = byDate[iso]
            val state = when {
                o != null && o.completed -> CellState.Done
                o != null && iso < today -> CellState.Missed
                o != null && iso == today -> CellState.Open
                o != null -> CellState.Planned
                iso in skips -> CellState.Skipped
                offset in committed -> CellState.Idle
                else -> CellState.Off
            }
            WeekCell(iso, offset in committed, state)
        }
    }

    /** Kept occurrences in a row, back from the latest. Today unticked neither breaks nor counts. */
    fun streak(r: Item, items: List<Item>, today: String): Int {
        var n = 0
        for (o in occurrences(r, items).filter { it.dueDate != null && it.dueDate <= today }.sortedByDescending { it.dueDate }) {
            if (o.completed) { n++; continue }
            if (o.dueDate == today) continue
            break
        }
        return n
    }

    /** The card's cadence line for a weekly routine: "2×/WK · 18:00"; empty when it commits to nothing. */
    fun line(r: Item): String {
        val target = weeklyTarget(r)
        if (target == 0) return ""
        return "$target×/WK" + (r.scheduledTime?.take(5)?.let { " · $it" } ?: "")
    }
}

