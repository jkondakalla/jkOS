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

/** GET /auth/profile, as much of it as this app uses. */
data class Profile(val user: User, val themeMode: ThemeMode, val prefsVersion: Int)

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
        val mode = o.optJSONObject("preferences")?.optJSONObject("theme")?.str("mode")
        return Profile(AuthModels.user(o.getJSONObject("user")), ThemeMode.of(mode), o.optInt("prefs_version", 0))
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
