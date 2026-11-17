package net.jkos.app.alpha.beigeboard

import net.jkos.app.alpha.auth.*

import org.json.JSONObject

/**
 * BeigeBoard's API, as this app uses it. Every path here is a dataset or capability BeigeBoard
 * declares (apps/beigeboard/backend/discovery.js); check:native holds each literal to that, and
 * each body to its capability's declared fields (Items.kt). The transport and the token are
 * [AppApi]'s.
 */
object BeigeBoardApi {
    private val api = AppApi("beigeboard")

    /** Where BeigeBoard's web app is, for a pin's deeplink back to it. */
    val webBase: String get() = api.base

    // ── reads ──

    /** Every item of this person's: tasks, events, goals, milestones, routines. */
    suspend fun items(): List<Item> = Items.items(api.get("/api/items"))

    /** One item's dependency edges, both ways. */
    suspend fun deps(id: Long): Deps = Deps.of(JSONObject(api.get("/api/items/$id/deps")))

    // ── writes ──

    suspend fun create(body: JSONObject): Item = Items.item(JSONObject(api.call("POST", "/api/items", body.toString()).text))

    suspend fun complete(id: Long, completed: Boolean): Item =
        Items.item(JSONObject(api.call("PATCH", "/api/items/$id", Items.completeBody(completed).toString()).text))

    suspend fun update(id: Long, changes: Map<String, Any?>): Item =
        Items.item(JSONObject(api.call("PATCH", "/api/items/$id", Items.updateBody(changes).toString()).text))

    suspend fun delete(id: Long) {
        api.call("DELETE", "/api/items/$id")
    }

    suspend fun addDependency(id: Long, dependsOn: Long): Deps =
        Deps.of(JSONObject(api.call("POST", "/api/items/$id/deps", Items.dependencyBody(dependsOn).toString()).text))

    suspend fun removeDependency(id: Long, dep: Long): Deps =
        Deps.of(JSONObject(api.call("DELETE", "/api/items/$id/deps/$dep").text))

    // ── connected calendars (connecting is an OAuth redirect, and stays in the browser) ──

    /** The providers syncCalendar and disconnectCalendar take. */
    val PROVIDERS = listOf("google", "outlook", "icloud")

    suspend fun calendarStatus(provider: String): CalendarStatus {
        val o = JSONObject(api.get("/api/auth/$provider/status"))
        return CalendarStatus(provider, o.optBoolean("connected"), if (o.isNull("email")) null else o.optString("email"))
    }

    /**
     * Pull the provider's events into the board (pull-only: nothing is written back). The window
     * is replaced whole; an empty answer while the board holds its events replaces nothing.
     */
    suspend fun syncCalendar(provider: String): String {
        val o = JSONObject(api.call("POST", "/api/calendar/$provider/sync").text)
        return if (o.optBoolean("skipped")) "it answered with no events, so the board kept the ones it had"
        else "${o.optInt("synced")} event${if (o.optInt("synced") == 1) "" else "s"} on the board"
    }

    /** Forget the credential, and every event it put on the board. */
    suspend fun disconnectCalendar(provider: String) {
        api.call("DELETE", "/api/auth/$provider")
    }

    // ── routines ──

    suspend fun routines(): List<Routine> = Routines.routines(api.get("/api/routines"))

    /** One routine with its document: what is edited and imported back to change it. */
    suspend fun routine(id: Long): RoutineDoc = Routines.routine(api.get("/api/routines/$id"))

    suspend fun preview(id: Long, cycles: Int = 6): List<Session> = Routines.preview(api.get("/api/routines/$id/preview?cycles=$cycles"))

    /** [measure] is load, target, sets or volume (routineSeries declares the four). */
    suspend fun series(id: Long, measure: String): List<StepSeries> = Routines.series(api.get("/api/routines/$id/series?measure=$measure"))

    suspend fun metric(id: Long): Metric? = Routines.metric(api.get("/api/routines/$id/metric"))

    suspend fun revisions(id: Long): List<Revision> = Routines.revisions(api.get("/api/routines/$id/revisions"))

    /** importRoutine, or its dry run (?dryRun=1: validated and rendered, nothing written). */
    suspend fun importRoutine(body: JSONObject, dryRun: Boolean): ImportReport =
        Routines.routineReport(api.call("POST", "/api/routines/import" + if (dryRun) "?dryRun=1" else "", body.toString()).text)

    suspend fun importBundle(body: JSONObject, dryRun: Boolean): ImportReport =
        Routines.bundleReport(api.call("POST", "/api/routines/bundle" + if (dryRun) "?dryRun=1" else "", body.toString()).text)

    // ── the library ──

    suspend fun library(): List<LibraryEntry> = Library.entries(api.get("/api/library"))

    /** saveLibraryEntry: makes one, or replaces the one with the same collection and slug. */
    suspend fun saveEntry(changes: Map<String, Any?>) {
        api.call("POST", "/api/library", Library.body(changes, edit = false).toString())
    }

    suspend fun editEntry(id: Long, changes: Map<String, Any?>) {
        api.call("PATCH", "/api/library/$id", Library.body(changes, edit = true).toString())
    }

    suspend fun deleteEntry(id: Long) {
        api.call("DELETE", "/api/library/$id")
    }

    /** importLibrary: upserts by (collection, slug). Answers "N new, M updated, K refused". */
    suspend fun importLibrary(body: JSONObject): String {
        val o = JSONObject(api.call("POST", "/api/library/import", body.toString()).text)
        val failed = o.optJSONArray("failed")?.length() ?: 0
        return "${o.optInt("created")} new, ${o.optInt("updated")} updated" + if (failed > 0) ", $failed refused" else ""
    }

    suspend fun deload(id: Long, on: Boolean): Item =
        Items.item(JSONObject(api.call("POST", "/api/items/$id/deload", Items.deloadBody(on).toString()).text))
}

data class CalendarStatus(val provider: String, val connected: Boolean, val email: String?)

/** What blocks an item, and what it blocks (the itemDeps dataset). `blocked` is the server's, derived on every read. */
data class Deps(val blocked: Boolean, val blockedBy: List<Item>, val blocks: List<Item>) {
    companion object {
        fun of(o: JSONObject): Deps {
            fun list(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { Items.item(a.getJSONObject(it)) } } ?: emptyList()
            return Deps(o.optBoolean("blocked"), list("blocked_by"), list("blocks"))
        }
    }
}
