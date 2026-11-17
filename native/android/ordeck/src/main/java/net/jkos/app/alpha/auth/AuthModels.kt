package net.jkos.app.alpha.auth

import org.json.JSONObject

// jkAuth's shapes, as this app reads them (apps/jkauth/src/routes/native.js and tokens.js).
// org.json is part of Android; the JVM unit test uses the org.json artifact.

data class User(val id: Long, val email: String, val name: String?, val role: String)

/** POST /auth/native/token's answer, either grant. [familyId] is which of the person's
 *  sessions this install is (null from a jkAuth that doesn't say). */
data class TokenGrant(val accessToken: String, val expiresInSec: Long, val refreshToken: String, val user: User, val familyId: String?)

object AuthModels {
    /** A string field, with JSON null and absence both null. (optString turns null into "null".) */
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)

    fun user(o: JSONObject) = User(
        id = o.getLong("id"),
        email = o.getString("email"),
        name = o.str("name"),
        role = o.getString("role"),
    )

    fun tokenGrant(json: String): TokenGrant {
        val o = JSONObject(json)
        return TokenGrant(
            accessToken = o.getString("access_token"),
            expiresInSec = o.getLong("expires_in"),
            refreshToken = o.getString("refresh_token"),
            user = user(o.getJSONObject("user")),
            familyId = o.str("family_id"),
        )
    }
}
