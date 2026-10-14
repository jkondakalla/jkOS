package net.jkos.kouros

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

// The pure half of native sign-in: no Android import, so the JVM unit test holds it.
// The server half is apps/jkauth/src/routes/native.js.

/**
 * One sign-in attempt's secrets (RFC 7636 PKCE + the OAuth `state`).
 *
 *  verifier   32 random bytes, base64url — 43 characters. It never leaves this app until the
 *             code exchange, so a code that is intercepted on its way back is useless.
 *  challenge  base64url(sha256(verifier)): what the authorize request carries instead.
 *  state      16 random bytes, base64url: binds the redirect to THIS attempt, so a code another
 *             app injects through the redirect scheme is refused before it is ever exchanged.
 */
class Pkce private constructor(val verifier: String, val challenge: String, val state: String) {
    companion object {
        private val random = SecureRandom()
        private fun bytes(n: Int) = ByteArray(n).also { random.nextBytes(it) }

        fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

        fun challengeOf(verifier: String): String =
            base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

        fun create(): Pkce {
            val verifier = base64Url(bytes(32))
            return Pkce(verifier, challengeOf(verifier), base64Url(bytes(16)))
        }

        /** A pending attempt read back after the process died while the Custom Tab was open. */
        fun restore(verifier: String, state: String) = Pkce(verifier, challengeOf(verifier), state)
    }
}

/** Equal without a timing side channel (the `state` comparison). */
fun constantTimeEquals(a: String, b: String): Boolean =
    MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

/** `${authOrigin}/auth/native/authorize?…` for one attempt. */
fun authorizeUrl(authOrigin: String, clientId: String, redirectUri: String, pkce: Pkce): String =
    "$authOrigin/auth/native/authorize" +
        "?response_type=code" +
        "&client_id=${enc(clientId)}" +
        "&redirect_uri=${enc(redirectUri)}" +
        "&code_challenge=${enc(pkce.challenge)}" +
        "&code_challenge_method=S256" +
        "&state=${enc(pkce.state)}"

/**
 * The query of a sign-in redirect, or null when [raw] is not one. A redirect is ours only
 * when it is EXACTLY the registered redirect URI plus a query — the intent filter matches the
 * scheme alone (see AndroidManifest.xml), so this is where the path is held.
 */
fun parseRedirect(raw: String, redirectUri: String): Map<String, String>? {
    if (!raw.startsWith("$redirectUri?")) return null
    val query = try {
        URI(raw).rawQuery
    } catch (_: Exception) {
        return null
    } ?: return null
    val out = LinkedHashMap<String, String>()
    for (pair in query.split('&')) {
        if (pair.isEmpty()) continue
        val i = pair.indexOf('=')
        val k = URLDecoder.decode(if (i < 0) pair else pair.substring(0, i), "UTF-8")
        val v = if (i < 0) "" else URLDecoder.decode(pair.substring(i + 1), "UTF-8")
        if (k in out) return null // a repeated parameter is ambiguous: refuse rather than pick one
        out[k] = v
    }
    return out
}
