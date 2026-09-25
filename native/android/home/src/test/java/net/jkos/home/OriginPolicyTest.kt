package net.jkos.home

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** OriginPolicy against native/origin-cases.json — the vectors the desktop shell passes too. */
class OriginPolicyTest {

    private val doc = JSONObject(File(System.getProperty("jkos.originCases")!!).readText())

    @Test
    fun agreesWithTheSharedCases() {
        val origins = doc.getJSONArray("origins").let { a -> List(a.length()) { a.getString(it) } }
        val policy = OriginPolicy(origins)
        val cases = doc.getJSONArray("cases")
        val wrong = (0 until cases.length()).map { cases.getJSONObject(it) }
            .filter { policy.allows(it.getString("url")) != it.getBoolean("allow") }
            .map { "${it.getString("url")}  (expected ${it.getBoolean("allow")}: ${it.getString("why")})" }
        assertEquals("OriginPolicy disagrees with origin-cases.json:\n" + wrong.joinToString("\n"), 0, wrong.size)
        // An empty or truncated case file must not pass by having nothing to disagree with.
        assertTrue("origin-cases.json holds too few cases to mean anything", cases.length() >= 20)
    }

    @Test
    fun refusesAnOriginListThatIsNotPlainHttps() {
        assertThrows(IllegalArgumentException::class.java) { OriginPolicy(listOf("http://jkos.net")) }
        assertThrows(IllegalArgumentException::class.java) { OriginPolicy(listOf("*")) }
    }
}
