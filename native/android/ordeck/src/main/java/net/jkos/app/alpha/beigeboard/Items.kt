package net.jkos.app.alpha.beigeboard

import org.json.JSONArray
import org.json.JSONObject

// BeigeBoard's items as this app reads and writes them. The shape is
// apps/beigeboard/backend/src/item-fields.js (ITEM_SHAPE); the writes are the capabilities in
// apps/beigeboard/backend/discovery.js. Pure, so the JVM test holds it.
//
// ⚠️ A BODY CARRIES ONLY WHAT ITS CAPABILITY DECLARES. The server's PATCH /items/:id accepts any
// client column, and the web sends more than createItem declares (scope, source, completed). This
// app doesn't: native/beigeboard-body-cases.json holds every body it builds, and check:native
// holds each one's keys to its capability's declared body.

/** One `items` row: a task, an event, a goal, a milestone or a routine. */
data class Item(
    val id: Long,
    val kind: String,
    val scope: String?,
    val title: String,
    val notes: String?,
    val parentId: Long?,
    val accent: String?,
    val completed: Boolean,
    val weekStart: String?,
    val dueDate: String?,
    val endDate: String?,
    val scheduledTime: String?,
    val scheduledEnd: String?,
    val location: String?,
    val status: String?,
    val position: Double?,
    val targetDate: String?,
    val doneMeans: String?,
    val extRef: String?,
    val tags: List<String>,
    val deloadOverride: Int?,
) {
    val isTask get() = kind == "task"
    val isEvent get() = kind == "event"
    /** A routine's occurrence is an ordinary task, minted with ext_ref `routine:<id>:<date>`. */
    val isOccurrence get() = extRef?.startsWith("routine:") == true
}

object Items {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }
    private fun JSONObject.long(k: String): Long? = if (isNull(k) || !has(k)) null else optLong(k)
    private fun JSONObject.dbl(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k).takeUnless { it.isNaN() }

    /** SQLite booleans arrive as 0/1 or true/false. */
    private fun JSONObject.bool(k: String): Boolean = when (val v = opt(k)) {
        is Boolean -> v
        is Number -> v.toInt() != 0
        else -> false
    }

    fun item(o: JSONObject): Item {
        val tags = o.optJSONArray("tags")
        return Item(
            id = o.getLong("id"),
            kind = o.str("kind") ?: "task",
            scope = o.str("scope"),
            title = o.optString("title", ""),
            notes = o.str("notes"),
            parentId = o.long("parent_id"),
            accent = o.str("accent"),
            completed = o.bool("completed"),
            weekStart = o.str("week_start"),
            dueDate = o.str("due_date"),
            endDate = o.str("end_date"),
            scheduledTime = o.str("scheduled_time"),
            scheduledEnd = o.str("scheduled_end"),
            location = o.str("location"),
            status = o.str("status"),
            position = o.dbl("position"),
            targetDate = o.str("target_date"),
            doneMeans = o.str("done_means"),
            extRef = o.str("ext_ref"),
            tags = if (tags == null) emptyList() else (0 until tags.length()).mapNotNull { tags.optString(it).takeIf(String::isNotBlank) },
            deloadOverride = if (o.isNull("deload_override") || !o.has("deload_override")) null else o.optInt("deload_override"),
        )
    }

    fun items(json: String): List<Item> {
        val a = JSONArray(json)
        return (0 until a.length()).map { item(a.getJSONObject(it)) }
    }

    // ── the bodies (each capability's declared fields only) ──

    /** The kinds this app creates: a routine is authored as a document (H4), never by quick add. */
    private val CREATE_KINDS = setOf("task", "event", "goal", "milestone")

    /**
     * createItem: a task or an event (a date and a time when given), or a goal or a milestone
     * for the tree. [parentId] files it under a goal or milestone; a goal is `scope: year`, as
     * the web's "+ Goal" makes one. Anything else is a task.
     */
    fun createBody(
        title: String, kind: String, dueDate: String?, time: String?, idempotencyKey: String,
        parentId: Long? = null,
    ): JSONObject = JSONObject().apply {
        val k = kind.takeIf { it in CREATE_KINDS } ?: "task"
        put("title", title.trim().take(500))
        put("kind", k)
        dueDate?.let { put("due_date", it) }
        time?.let { put("scheduled_time", it) }
        parentId?.let { put("parent_id", it) }
        if (k == "goal") put("scope", "year")
        put("idempotency_key", idempotencyKey)
    }

    /** completeItem. */
    fun completeBody(completed: Boolean): JSONObject = JSONObject().put("completed", completed)

    /**
     * updateItem: only the fields that changed, each one updateItem declares. A null value
     * clears the field (the server stores NULL); a field not in [changes] is left alone.
     */
    fun updateBody(changes: Map<String, Any?>): JSONObject = JSONObject().apply {
        for ((k, v) in changes) {
            require(k in UPDATE_FIELDS) { "updateItem does not declare $k" }
            put(k, v ?: JSONObject.NULL)
        }
    }

    /** updateItem's declared body (discovery.js), less the path's id. check:native holds this list to it. */
    val UPDATE_FIELDS = setOf(
        "week_start", "due_date", "end_date", "scheduled_time", "scheduled_end", "title", "notes", "accent", "kind",
        "cadence_days", "cadence_count", "spec", "cadence_rule", "performed", "deload_override",
    )

    /** addDependency. */
    fun dependencyBody(dependsOn: Long): JSONObject = JSONObject().put("depends_on", dependsOn)

    /** deloadSession: take this occurrence easy, or clear it (the web's onDeload). */
    fun deloadBody(on: Boolean): JSONObject = if (on) JSONObject().put("deload", true) else JSONObject().put("clear", true)
}

/** Progress through a goal or a list: its leaf tasks done out of all. */
data class Progress(val done: Int, val total: Int) {
    val pct: Int get() = if (total == 0) 0 else Math.round(done * 100f / total)
}

/** The tree (decomposition, by parent_id), as the web's lib/seed.ts walks it. */
class Tree(val items: List<Item>) {
    private val kids: Map<Long?, List<Item>> = items.groupBy { it.parentId }
    private val byId = items.associateBy { it.id }

    fun children(id: Long): List<Item> = kids[id].orEmpty().sortedWith(compareBy<Item>({ it.position ?: Double.MAX_VALUE }, { it.id }))

    /** The goals at the top of the tree. */
    val goals: List<Item> get() = kids[null].orEmpty().filter { it.kind == "goal" }.sortedWith(compareBy<Item>({ it.position ?: Double.MAX_VALUE }, { it.id }))

    /** Everything under [id], with a cycle guard (a parent cycle must not loop). */
    fun descendants(id: Long): List<Item> {
        val out = mutableListOf<Item>()
        val seen = hashSetOf(id)
        val stack = ArrayDeque(listOf(id))
        while (stack.isNotEmpty()) for (k in kids[stack.removeLast()].orEmpty()) if (seen.add(k.id)) { out += k; stack.addLast(k.id) }
        return out
    }

    private fun underRoutine(i: Item): Boolean {
        val seen = HashSet<Long>()
        var cur: Item? = i
        while (cur != null && seen.add(cur.id)) { if (cur.kind == "routine") return true; cur = cur.parentId?.let(byId::get) }
        return false
    }

    /** getProgress: the leaf tasks under [id], less a routine's sessions (they are a pattern, not a plan). */
    fun progress(id: Long): Progress {
        val leaves = descendants(id).filter { it.isTask && kids[it.id].isNullOrEmpty() && !underRoutine(it) }
        return Progress(leaves.count { it.completed }, leaves.size)
    }
}

/** Today, as the web's mobile Today view derives it from the items (MobileTodayView.tsx). */
data class Today(
    /** Today's tasks still to do, by time (untimed last). */
    val active: List<Item>,
    val done: List<Item>,
    /** Tasks due before today and not done. */
    val overdue: List<Item>,
    /** Today's events, by time. */
    val events: List<Item>,
) {
    val next: Item? get() = active.firstOrNull()
    val rest: List<Item> get() = active.drop(1)
    val total: Int get() = active.size + done.size
    val pct: Int get() = if (total == 0) 0 else Math.round(done.size * 100f / total)

    companion object {
        private fun byTime(i: Item) = i.scheduledTime ?: "zz"

        fun of(items: List<Item>, todayIso: String): Today {
            val tasks = items.filter { it.isTask }
            val todays = tasks.filter { it.dueDate == todayIso }
            return Today(
                active = todays.filter { !it.completed }.sortedBy(::byTime),
                done = todays.filter { it.completed },
                overdue = tasks.filter { it.dueDate != null && it.dueDate < todayIso && !it.completed }.sortedBy { it.dueDate },
                // A multi-day event shows on every day it spans.
                events = items.filter { it.isEvent && it.dueDate != null && it.dueDate <= todayIso && (it.endDate ?: it.dueDate) >= todayIso }.sortedBy(::byTime),
            )
        }
    }
}

/** The item's accent, as a colour this app can draw: its own, else the nearest ancestor's (the web's getAccent). Only #rrggbb is drawable here. */
fun accentOf(item: Item, byId: Map<Long, Item>): Long? {
    val seen = HashSet<Long>()
    var cur: Item? = item
    while (cur != null && seen.add(cur.id)) {
        cur.accent?.let(::hex)?.let { return it }
        cur = cur.parentId?.let(byId::get)
    }
    return null
}

private fun hex(s: String): Long? {
    val m = Regex("^#([0-9a-fA-F]{6})$").find(s.trim()) ?: return null
    return 0xFF000000 or m.groupValues[1].toLong(16)
}

/** "9:30 AM" from "09:30", as the web's fmtTime. */
fun fmtTime(hhmm: String?): String? {
    val m = Regex("^(\\d{1,2}):(\\d{2})").find(hhmm ?: return null) ?: return null
    val h = m.groupValues[1].toInt()
    val ampm = if (h < 12) "AM" else "PM"
    val h12 = if (h % 12 == 0) 12 else h % 12
    return "$h12:${m.groupValues[2]} $ampm"
}
