package net.jkos.home

import java.util.Locale

/**
 * May the launcher show this URL? The rule is declared once, as test vectors, in
 * native/origin-cases.json — the desktop shell's policy.js passes the same ones:
 *
 *   https only · no userinfo · the default port only · origin (scheme + host,
 *   case-insensitive) EXACTLY equal to a listed origin. No prefix, suffix or pattern match.
 *
 * Pure Kotlin on purpose (no android.net.Uri) so the JVM unit test runs the real class.
 * It reads only the scheme and authority by hand rather than handing the whole URL to a
 * general parser: a canonical URL's path may hold characters java.net.URI rejects, and
 * anything unusual in the authority fails CLOSED here.
 */
class OriginPolicy(origins: Collection<String>) {

    private val allowed: Set<String> = origins.map { o ->
        requireNotNull(normalize(o)) { "OriginPolicy: '$o' is not a plain https origin" }
    }.toSet()

    fun allows(url: String): Boolean = normalize(url)?.let { it in allowed } ?: false

    companion object {
        private const val HTTPS = "https://"

        /** `https://Host[:443][/…]` → `https://host`; anything else → null. */
        fun normalize(url: String): String? {
            if (!url.regionMatches(0, HTTPS, 0, HTTPS.length, ignoreCase = true)) return null
            val rest = url.substring(HTTPS.length)
            val end = rest.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) rest.length else it }
            val authority = rest.substring(0, end)
            val colon = authority.lastIndexOf(':')
            val host = (if (colon < 0) authority else authority.substring(0, colon)).lowercase(Locale.ROOT)
            if (colon >= 0 && authority.substring(colon + 1) != "443") return null
            // The host must be nothing BUT host characters. That is also what refuses userinfo
            // (`https://jkos.net@evil.example` is evil.example): '@' is not one of them, so no
            // separate '@' test — a mutation run showed one would be dead code.
            if (host.isEmpty() || !host.all { it in 'a'..'z' || it in '0'..'9' || it == '.' || it == '-' }) return null
            return HTTPS + host
        }
    }
}
