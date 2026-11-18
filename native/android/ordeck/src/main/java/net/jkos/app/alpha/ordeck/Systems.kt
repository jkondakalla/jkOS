package net.jkos.app.alpha.ordeck

import org.json.JSONObject

// The systems card's pure half: a probe's answer as a row, and the rows as the card's head.
// ORDECK's useHudData.ts (sysRow, viewSystems, degradedReason) is the reference; no Android
// import, so the JVM test holds it.

/** A row's colour, as @jkos/widget-render names them. Declared in TONE_RANK's order, so the
 *  ordinal is the rank a feed sorts by (most urgent first). */
enum class Tone { Danger, Warn, Accent, Ok, Muted }

enum class SysStatus(val tone: Tone) { Up(Tone.Ok), Warn(Tone.Warn), Down(Tone.Danger), Probing(Tone.Muted) }

/** One app's health: its id, what the probe found, and the detail the row prints ("12 ms"). */
data class SysRow(val name: String, val status: SysStatus, val detail: String) {
    val tone: Tone get() = status.tone
}

data class SystemsState(val rows: List<SysRow>) {
    /** Warn counts as up: the app answered, and said what it can't do. */
    val up: Int get() = rows.count { it.status == SysStatus.Up || it.status == SysStatus.Warn }
    val total: Int get() = rows.size
    val summary: String get() = "$up / $total UP"
}

object Systems {
    /** Every probe still out ("—"), before the first answers land. */
    fun probing(apps: List<String>) = SystemsState(apps.map { SysRow(it, SysStatus.Probing, "—") })

    /**
     * An up-but-degraded reason from a health body, or null for plain healthy (the web's
     * degradedReason): a generic `degraded` (a string, or true), and LazurOS's
     * `compute_online: false`. Anything that isn't a JSON object is plain healthy.
     */
    fun degradedReason(body: String?): String? {
        val o = runCatching { JSONObject(body ?: return null) }.getOrNull() ?: return null
        val d = o.opt("degraded")
        if (d is String && d.isNotEmpty()) return d
        if (d == true) return "degraded"
        if (o.has("compute_online") && o.opt("compute_online") == false) return "gpu asleep"
        return null
    }

    /** One probe's answer as its row: down unless it answered 2xx; then warn with the reason, or up in [ms]. */
    fun row(app: String, ok: Boolean, ms: Long, body: String?): SysRow {
        if (!ok) return SysRow(app, SysStatus.Down, "down")
        val degraded = degradedReason(body)
        return if (degraded != null) SysRow(app, SysStatus.Warn, degraded) else SysRow(app, SysStatus.Up, "${ms.coerceAtLeast(1)} ms")
    }
}
