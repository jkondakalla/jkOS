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

    suspend fun deload(id: Long, on: Boolean): Item =
        Items.item(JSONObject(api.call("POST", "/api/items/$id/deload", Items.deloadBody(on).toString()).text))
}

/** What blocks an item, and what it blocks (the itemDeps dataset). `blocked` is the server's, derived on every read. */
data class Deps(val blocked: Boolean, val blockedBy: List<Item>, val blocks: List<Item>) {
    companion object {
        fun of(o: JSONObject): Deps {
            fun list(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { Items.item(a.getJSONObject(it)) } } ?: emptyList()
            return Deps(o.optBoolean("blocked"), list("blocked_by"), list("blocks"))
        }
    }
}
