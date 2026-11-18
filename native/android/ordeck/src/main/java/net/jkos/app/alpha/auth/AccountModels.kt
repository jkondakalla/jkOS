package net.jkos.app.alpha.auth

import org.json.JSONObject

// jkAuth's account shapes (apps/jkauth/src/routes/profile.js and account.js), as the Account
// tab reads and writes them. No Android import: the JVM test holds the parsing and the bodies.

/** The suite's theme mode (`preferences.theme.mode`, @jkos/auth-client's JkOSTheme). */
enum class ThemeMode(val wire: String, val label: String) {
    System("system", "System"), Light("light", "Paper"), Dark("dark", "Dark");

    /** Dark when the person chose it, or left it to a device that is dark — the web's rule
     *  (packages/design/utils/applyJkOSTheme.ts). */
    fun isDark(systemDark: Boolean) = this == Dark || (this == System && systemDark)

    companion object {
        /** Anything unrecognised is `system`, the suite's default (auth-client DEFAULT_THEME). */
        fun of(wire: String?): ThemeMode = entries.firstOrNull { it.wire == wire } ?: System
    }
}

/**
 * How this person's suite looks, read as every web app reads it: `preferences.theme` (the mode
 * and the raw accent pair, auth-client's normaliseTheme) and `preferences.effects` (merged over
 * DEFAULT_EFFECTS). The faces derive everything else from these (look/Tokens.kt).
 */
data class Look(
    val mode: ThemeMode = ThemeMode.System,
    val primary: String = HOUSE_PRIMARY,
    val secondary: String = HOUSE_SECONDARY,
    /** The accent glow on the dark face, and the ambient rake / buzz. */
    val halation: Boolean = true,
    val scanLines: Boolean = false,
    val scanStrength: Double = 0.25,
) {
    fun toJson(): String = JSONObject()
        .put("mode", mode.wire).put("primary", primary).put("secondary", secondary)
        .put("halation", halation).put("scanLines", scanLines).put("scanStrength", scanStrength)
        .toString()

    companion object {
        // @jkos/design's ACCENT_SCHEMES[0]; TokensTest holds it to the web's computed default.
        const val HOUSE_PRIMARY = "#ffb000"
        const val HOUSE_SECONDARY = "#4ecdc4"
        private val HEX = Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

        /** A colour the person stored, or null: it is drawn, so anything but a hex is refused. */
        fun hex(s: String?): String? = s?.trim()?.takeIf { HEX.matches(it) }?.lowercase()

        /** preferences → Look. Anything missing or unreadable is the suite's default. */
        fun of(preferences: JSONObject?): Look {
            val t = preferences?.optJSONObject("theme")
            val e = preferences?.optJSONObject("effects")
            // The legacy nested theme kept the pair under `dark` (normaliseTheme).
            val pair = if (t?.has("primary") == true) t else t?.optJSONObject("dark")
            return Look(
                mode = ThemeMode.of(t?.let { if (it.isNull("mode")) null else it.optString("mode") }),
                primary = hex(pair?.optString("primary")) ?: HOUSE_PRIMARY,
                secondary = hex(pair?.optString("secondary")) ?: HOUSE_SECONDARY,
                halation = e?.optBoolean("halation", true) ?: true,
                scanLines = e?.optBoolean("scanLines", false) ?: false,
                scanStrength = (e?.optDouble("scanStrength", 0.25) ?: 0.25).takeIf { !it.isNaN() }?.coerceIn(0.0, 1.0) ?: 0.25,
            )
        }

        /** The last look this device saw (SessionStore), or the default. */
        fun fromJson(json: String?): Look = runCatching {
            val o = JSONObject(json ?: return Look())
            of(JSONObject()
                .put("theme", JSONObject().put("mode", o.optString("mode")).put("primary", o.optString("primary")).put("secondary", o.optString("secondary")))
                .put("effects", JSONObject().put("halation", o.optBoolean("halation", true)).put("scanLines", o.optBoolean("scanLines", false)).put("scanStrength", o.optDouble("scanStrength", 0.25))))
        }.getOrDefault(Look())
    }
}

/** GET /auth/profile, as much of it as this app uses. */
data class Profile(val user: User, val look: Look, val prefsVersion: Int) {
    val themeMode: ThemeMode get() = look.mode
}

/** One sign-in (a session family) from GET /auth/sessions. */
data class Device(
    val familyId: String,
    /** The native app this sign-in is, or null for a browser. */
    val clientId: String?,
    val createdAt: String,
    val lastUsedAt: String,
    val revoked: Boolean,
    val revokedReason: String?,
    val rotations: Int,
    /** This install's own session: its family is the one the token endpoint named. */
    val isThisDevice: Boolean,
)

object AccountModels {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)

    fun profile(json: String): Profile {
        val o = JSONObject(json)
        // `theme` is the flat { mode, primary, secondary } or the legacy nested shape; `mode`
        // sits at the top of both (auth-client's normaliseTheme).
        return Profile(AuthModels.user(o.getJSONObject("user")), Look.of(o.optJSONObject("preferences")), o.optInt("prefs_version", 0))
    }

    /**
     * The caller's sign-ins, in the order the screen shows them: this device first, then the
     * live ones (the server's order: most recently used first), then the signed-out ones.
     * [myFamily] is null when the server didn't name this session (an older jkAuth): then no
     * entry is marked, rather than one being guessed.
     */
    fun devices(json: String, myFamily: String?): List<Device> {
        val a = JSONObject(json).optJSONArray("sessions") ?: return emptyList()
        val all = List(a.length()) { i ->
            val o = a.getJSONObject(i)
            val family = o.getString("family_id")
            Device(
                familyId = family,
                clientId = o.str("client_id"),
                createdAt = o.str("created_at") ?: "",
                lastUsedAt = o.str("last_used_at") ?: "",
                revoked = o.optBoolean("revoked"),
                revokedReason = o.str("revoked_reason"),
                rotations = o.optInt("rotations"),
                isThisDevice = myFamily != null && family == myFamily,
            )
        }
        return all.sortedWith(compareByDescending<Device> { it.isThisDevice }.thenBy { it.revoked })
    }

    /** PATCH /auth/profile: a new display name. The server trims it and keeps 100 characters. */
    fun nameBody(name: String): String = JSONObject().put("name", name).toString()

    /**
     * PATCH /auth/profile: the theme mode, and nothing else of the theme. The server deep-merges
     * `preferences`, so the accent pair and every other slice stay as they are; `prefs_version`
     * makes it refuse (409) a write built on a blob that changed elsewhere.
     */
    fun themeBody(mode: ThemeMode, prefsVersion: Int): String = JSONObject()
        .put("preferences", JSONObject().put("theme", JSONObject().put("mode", mode.wire)))
        .put("prefs_version", prefsVersion)
        .toString()

    /** POST /auth/sessions/revoke. */
    fun revokeBody(familyId: String): String = JSONObject().put("family_id", familyId).toString()
}
