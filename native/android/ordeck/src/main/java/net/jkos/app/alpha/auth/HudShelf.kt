package net.jkos.app.alpha.auth

import org.json.JSONArray
import org.json.JSONObject

// The HUD shelf: the person's pins (a suite-wide list) and their focus (a suite-wide single
// item), kept in jkAuth's preferences so any app can put its items on ORDECK by {app, id}
// (packages/auth-client/src/useHudShelf.ts). BeigeBoard's screens pin and focus through it;
// ORDECK's home reads it. Pure: the JVM test holds the reading and the patches to
// native/hud-shelf-cases.json, which the web's hudPrefs.ts passes too.
//
// ⚠️ XC-5: the slices moved under `preferences.ordeck`, and the legacy top-level keys are the
// fallback. A write sets the namespaced key and nulls the legacy one in the same patch (the
// server deep-merges, and replaces arrays whole). A namespaced focus of null is a real value,
// "nothing in focus", not an absence: reading it must not fall back to a legacy focus.

/** One thing on the shelf (the web's HudRef, plus a pin's `ts`). */
data class HudRef(
    val app: String,
    val id: String,
    val label: String,
    val deeplink: String? = null,
    val tone: String? = null,
    val ts: Long? = null,
)

data class Shelf(val pins: List<HudRef>, val focus: HudRef?) {
    fun isPinned(app: String, id: String) = pins.any { it.app == app && it.id == id }
    fun isFocused(app: String, id: String) = focus?.let { it.app == app && it.id == id } ?: false
}

object HudShelf {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)

    private fun ref(o: JSONObject?): HudRef? {
        if (o == null) return null
        val app = o.str("app") ?: return null
        val id = if (o.isNull("id")) return null else o.get("id").toString()
        return HudRef(app, id, o.str("label") ?: "", o.str("deeplink"), o.str("tone"), if (o.has("ts") && !o.isNull("ts")) o.optLong("ts") else null)
    }

    private fun json(r: HudRef): JSONObject = JSONObject().apply {
        put("app", r.app); put("id", r.id); put("label", r.label)
        r.deeplink?.let { put("deeplink", it) }
        r.tone?.let { put("tone", it) }
        r.ts?.let { put("ts", it) }
    }

    /** hudPrefs.ts readHudPref, for both keys. */
    fun read(preferences: JSONObject?): Shelf {
        val owned = preferences?.optJSONObject("ordeck")
        val pinsArr = owned?.takeIf { it.has("hudPins") && !it.isNull("hudPins") }?.optJSONArray("hudPins")
            ?: preferences?.optJSONArray("hudPins")
        val pins = if (pinsArr == null) emptyList() else (0 until pinsArr.length()).mapNotNull { ref(pinsArr.optJSONObject(it)) }
        val focus = when {
            owned != null && owned.has("hudFocus") && !owned.isNull("hudFocus") -> ref(owned.optJSONObject("hudFocus"))
            owned != null && owned.has("hudFocus") -> null   // "nothing in focus", said explicitly
            else -> ref(preferences?.optJSONObject("hudFocus"))
        }
        return Shelf(pins, focus)
    }

    /** The PATCH /auth/profile body that writes [key] (writeHudPref): namespaced, legacy nulled. */
    private fun write(key: String, value: Any): String = JSONObject()
        .put("preferences", JSONObject().put("ordeck", JSONObject().put(key, value)).put(key, JSONObject.NULL))
        .toString()

    fun pinsBody(pins: List<HudRef>): String = write("hudPins", JSONArray(pins.map(::json)))

    fun focusBody(focus: HudRef?): String = write("hudFocus", focus?.let(::json) ?: JSONObject.NULL)

    /** useHudShelf's togglePin: off if it's there, else on the end with the time it was pinned. */
    fun togglePin(shelf: Shelf, r: HudRef, nowMs: Long): List<HudRef> =
        if (shelf.isPinned(r.app, r.id)) shelf.pins.filterNot { it.app == r.app && it.id == r.id }
        else shelf.pins + r.copy(ts = nowMs)

    /** useHudShelf's toggleFocus: the one item in focus, or none. */
    fun toggleFocus(shelf: Shelf, r: HudRef): HudRef? = if (shelf.isFocused(r.app, r.id)) null else r.copy(ts = null)
}
