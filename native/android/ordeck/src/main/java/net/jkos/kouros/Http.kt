package net.jkos.kouros

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

internal class HttpResult(val code: Int, val body: ByteArray) {
    val text get() = String(body, Charsets.UTF_8)
    val ok get() = code in 200..299
}

/**
 * The app's one HTTP client: HttpURLConnection, nothing else (no networking library). Blocking
 * — callers are on Dispatchers.IO or a player loader thread.
 *
 * ⚠️ Redirects are NOT followed. Behind the staging edge gate an unauthenticated request is
 * answered with a 302 to the sign-in page; followed, it becomes a 200 of HTML that every
 * caller would then fail to parse as JSON, with nothing saying "signed out". A 3xx here means
 * "not authorised" and the API client treats it exactly like a 401.
 *
 * https only: the network security config refuses cleartext, and this refuses it first, so a
 * mistyped base URL fails loudly instead of quietly sending a Bearer token over http.
 */
internal object Http {
    fun request(method: String, url: String, headers: Map<String, String> = emptyMap(), json: String? = null): HttpResult {
        if (!url.startsWith("https://")) throw IOException("refusing a non-https URL")
        val c = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.requestMethod = method
            c.useCaches = false
            for ((k, v) in headers) c.setRequestProperty(k, v)
            if (json != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            return HttpResult(code, stream?.use { it.readBytes() } ?: ByteArray(0))
        } finally {
            c.disconnect()
        }
    }
}
