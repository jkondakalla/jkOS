package net.jkos.app.alpha.auth

import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64

// What the app reads out of its own access token. No Android import: the JVM test holds it.

object Claims {
    /**
     * The `aud` claim of a jkAuth access token: the ids of the apps this person's role may
     * enter (jkAuth mints it from app_registry.allowed_roles — apps/jkauth/src/db.js roleClaims).
     *
     * The token is NOT verified here and doesn't need to be. The app uses the claim only to
     * decide which tabs to draw; every backend verifies the signature and checks its own id
     * against `aud` on each request, so a token edited to claim more would only draw a tab
     * whose every call is refused. Anything that isn't a well-formed JWT payload reads as no
     * audience at all: no tabs, never a guess.
     */
    fun audOf(accessToken: String): Set<String> {
        val parts = accessToken.split('.')
        if (parts.size != 3) return emptySet()
        return try {
            val payload = JSONObject(String(Base64.getUrlDecoder().decode(parts[1]), Charsets.UTF_8))
            when (val aud = payload.opt("aud")) {
                is JSONArray -> List(aud.length()) { aud.opt(it) }.filterIsInstance<String>().toSet()
                is String -> setOf(aud)
                else -> emptySet()
            }
        } catch (_: Exception) {
            emptySet()
        }
    }
}
