package net.jkos.app.alpha.auth

/**
 * jkAuth's account routes, as the Account tab uses them: the person's own profile and their
 * own sessions. Each takes the app's Bearer user token (jkAuth's resolveCaller) and reaches
 * only the caller's own rows. The token goes only to URLs under `${authOrigin}/auth/`
 * ([BearerClient]); check:native holds every `/auth/…` path typed in this package to
 * jkAuth's own route catalog.
 *
 * Password and two-factor are not here on purpose: they stay jkAuth's own pages, opened in
 * the browser, so a password is never typed into this app.
 */
object AccountApi {
    private val origin: String get() = Auth.config.authOrigin
    private val client = BearerClient("jkAuth") { "$origin/auth/" }

    suspend fun profile(): Profile = AccountModels.profile(client.call("GET", "$origin/auth/profile").text)

    suspend fun setName(name: String) {
        client.call("PATCH", "$origin/auth/profile", AccountModels.nameBody(name))
    }

    /** Set the theme mode on top of [prefsVersion]. A 409 means the blob changed elsewhere. */
    suspend fun setThemeMode(mode: ThemeMode, prefsVersion: Int) {
        client.call("PATCH", "$origin/auth/profile", AccountModels.themeBody(mode, prefsVersion))
    }

    /** The person's preferences blob: the HUD's arrangement, the shelf, the AI switch — what the home reads in one go. */
    suspend fun preferences(): org.json.JSONObject? = org.json.JSONObject(client.call("GET", "$origin/auth/profile").text).optJSONObject("preferences")

    /** The person's HUD shelf (pins and focus), from their preferences. */
    suspend fun shelf(): Shelf = HudShelf.read(preferences())

    /** Replace the pin list. No prefs_version: like the web's shelf, the last write wins. */
    suspend fun setPins(pins: List<HudRef>) {
        client.call("PATCH", "$origin/auth/profile", HudShelf.pinsBody(pins))
    }

    suspend fun setFocus(focus: HudRef?) {
        client.call("PATCH", "$origin/auth/profile", HudShelf.focusBody(focus))
    }

    suspend fun devices(): List<Device> =
        AccountModels.devices(client.call("GET", "$origin/auth/sessions").text, Auth.familyId)

    suspend fun revoke(familyId: String) {
        client.call("POST", "$origin/auth/sessions/revoke", AccountModels.revokeBody(familyId))
    }

    /** jkAuth's own security page (password, two-factor), for the browser. No token goes with it. */
    val securityPage: String get() = "$origin/auth/security"
}
