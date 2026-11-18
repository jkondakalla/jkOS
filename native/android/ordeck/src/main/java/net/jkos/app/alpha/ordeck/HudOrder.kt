package net.jkos.app.alpha.ordeck

import org.json.JSONArray
import org.json.JSONObject

/**
 * The order the home screen draws the HUD's cards in: the person's own arrangement, as the web
 * draws it on a phone. Arranging stays on the web; this only reads.
 *
 * The web keeps one HUD document per person in jkAuth's preferences (`preferences.ordeck.hud`,
 * the legacy top-level `hud` as the fallback — XC-5) and draws a phone its MOBILE tier: the
 * stored mobile layout if there is one, else the desktop layout reflowed into two columns
 * (ORDECK's state.ts loadHudState, then engine.ts layoutForBreakpoint). One column here is that
 * tier read top to bottom, left to right.
 *
 * ⚠️ IT IS LIVE USER DATA WRITTEN BY ANOTHER IMPLEMENTATION, so it is held to the web's own
 * code: native/hud-order-cases.json runs through the web's real loadHudState and
 * layoutForBreakpoint in check:native, and through this object in the JVM test. Pure, no
 * Android import. One thing the web does that this doesn't: merge admin-published widget defs
 * (GET /auth/widgets), which can resize a placed card on a tier. That moves a card's height,
 * which changes a reading order only between cards sitting side by side.
 */
object HudOrder {
    /** state.ts HUD_STATE_VERSION: a document of any other version is replaced by the default. */
    const val VERSION = 5

    /** The phone tier's columns (types.ts COLS.mobile). */
    const val MOBILE_COLS = 2

    /** One card's place on a tier, in grid units (types.ts GridItem). */
    data class Cell(val i: String, val x: Int, val y: Int, val w: Int, val h: Int, val static: Boolean = false)

    /** state.ts DEFAULT_DESKTOP — check:native holds this list to it. */
    val DEFAULT_DESKTOP = listOf(
        Cell("clock", 0, 0, 4, 3),
        Cell("weather", 0, 3, 4, 4),
        Cell("calendar", 0, 7, 4, 6),
        Cell("today", 4, 0, 5, 13),
        Cell("systems", 9, 0, 3, 5),
        Cell("notifications", 9, 5, 3, 8),
    )

    /**
     * state.ts RETIRED_BUILTINS: a stored card that no longer exists, matched by id AND by the
     * slice it binds (an admin may publish a new widget under a freed id, and that one stays).
     */
    private val RETIRED = listOf("study" to "study")

    /** The card ids in the order the phone shows them. */
    fun order(preferences: JSONObject?): List<String> =
        mobile(load(preferences)).sortedWith(compareBy<Cell>({ it.y }, { it.x })).map { it.i }.distinct()

    // ── loadHudState ────────────────────────────────────────────────────────────

    /** The document's tiers, by name. */
    private fun load(preferences: JSONObject?): Map<String, List<Cell>> {
        val doc = valid(stored(preferences)) ?: return mapOf("desktop" to DEFAULT_DESKTOP)
        val widgets = doc.optJSONObject("widgets")
        val retired = RETIRED.filter { (id, slice) -> widgets?.optJSONObject(id)?.let { binds(it, slice) } == true }.map { it.first }.toSet()
        val tiers = doc.optJSONObject("layouts")?.let { l ->
            l.keys().asSequence().associateWith { tier -> cells(l.optJSONArray(tier)).filterNot { it.i in retired } }
        } ?: emptyMap()
        // A document that places nothing anywhere would draw a blank HUD: the web re-seeds the
        // default (every default card is a catalog card, so all of them come back).
        return if (tiers.values.any { it.isNotEmpty() }) tiers else mapOf("desktop" to DEFAULT_DESKTOP)
    }

    /** hudPrefs.ts readHudPref('hud'): the namespaced key unless it is absent or null, then the legacy one. */
    private fun stored(p: JSONObject?): Any? {
        val owned = p?.optJSONObject("ordeck")
        if (owned != null && owned.has("hud") && !owned.isNull("hud")) return owned.get("hud")
        return if (p != null && p.has("hud") && !p.isNull("hud")) p.get("hud") else null
    }

    /** state.ts validHud: an object of the current version with widgets. */
    private fun valid(v: Any?): JSONObject? {
        val o = v as? JSONObject ?: return null
        val version = o.opt("version") as? Number ?: return null
        if (version.toDouble() != VERSION.toDouble()) return null
        return if (truthy(o.opt("widgets"))) o else null
    }

    private fun truthy(v: Any?): Boolean = when (v) {
        null, JSONObject.NULL, false -> false
        is Number -> v.toDouble() != 0.0 && !v.toDouble().isNaN()
        is String -> v.isNotEmpty()
        else -> true
    }

    /** Does this def bind [slice] anywhere (a binding's `src`, a command body's included)? */
    private fun binds(v: Any?, slice: String): Boolean = when (v) {
        is JSONObject -> (v.opt("src") == slice) || v.keys().asSequence().any { binds(v.opt(it), slice) }
        is JSONArray -> (0 until v.length()).any { binds(v.opt(it), slice) }
        else -> false
    }

    private fun cells(a: JSONArray?): List<Cell> = (0 until (a?.length() ?: 0)).mapNotNull { k ->
        val o = a!!.optJSONObject(k) ?: return@mapNotNull null
        val i = o.opt("i") as? String ?: return@mapNotNull null
        Cell(i, o.optInt("x"), o.optInt("y"), o.optInt("w"), o.optInt("h"), o.optBoolean("static"))
    }

    // ── engine.ts ───────────────────────────────────────────────────────────────

    /** layoutForBreakpoint(state, mobile): the stored mobile tier, else the desktop one reflowed. */
    fun mobile(tiers: Map<String, List<Cell>>): List<Cell> {
        val stored = tiers["mobile"]
        return if (!stored.isNullOrEmpty()) compactVertical(stored, MOBILE_COLS)
        else compactVertical(tiers["desktop"].orEmpty().map { clamp(it, MOBILE_COLS) }, MOBILE_COLS)
    }

    /** clampToCols: shrink the width first, then pull x back on-grid. Never floats sideways. */
    private fun clamp(c: Cell, cols: Int): Cell {
        val w = minOf(c.w, cols)
        return c.copy(w = w, x = maxOf(0, minOf(c.x, cols - w)))
    }

    /** A card never collides with itself (the same id). */
    private fun collides(a: Cell, b: Cell) =
        a.i != b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

    /** compactVertical: top to bottom, left to right, each card into the highest row it fits; a static card keeps its row. */
    fun compactVertical(items: List<Cell>, cols: Int): List<Cell> {
        val placed = mutableListOf<Cell>()
        for (raw in items.sortedWith(compareBy<Cell>({ it.y }, { it.x }))) {
            val c = clamp(raw, cols)
            if (c.static) { placed += c; continue }
            var y = 0
            while (placed.any { collides(c.copy(y = y), it) }) y++
            placed += c.copy(y = y)
        }
        return placed
    }
}
