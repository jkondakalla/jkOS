package net.jkos.app.alpha

import net.jkos.app.alpha.ordeck.HudOrder
import net.jkos.app.alpha.ordeck.SysRow
import net.jkos.app.alpha.ordeck.SysStatus
import net.jkos.app.alpha.ordeck.Systems
import net.jkos.app.alpha.ordeck.SystemsState
import net.jkos.app.alpha.ordeck.Tone
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The HUD's order on the phone, held to the web's loadHudState + layoutForBreakpoint by the shared vectors. */
class HudOrderTest {
    private val doc = JSONObject(File(System.getProperty("jkos.hudOrderCases") ?: error("jkos.hudOrderCases not set")).readText())

    @Test fun everyCaseIsTheWebsOrder() {
        val cases = doc.getJSONArray("cases")
        assertTrue(cases.length() >= 12)
        for (k in 0 until cases.length()) {
            val c = cases.getJSONObject(k)
            val prefs = if (c.isNull("preferences")) null else c.getJSONObject("preferences")
            val want = c.getJSONArray("expect").let { a -> (0 until a.length()).map { a.getString(it) } }
            assertEquals(c.getString("name"), want, HudOrder.order(prefs))
        }
    }

    @Test fun compactionPacksUpwardAndNeverSideways() {
        val out = HudOrder.compactVertical(listOf(HudOrder.Cell("a", 1, 9, 1, 2), HudOrder.Cell("b", 0, 4, 2, 1)), 2)
        assertEquals(listOf(HudOrder.Cell("b", 0, 0, 2, 1), HudOrder.Cell("a", 1, 1, 1, 2)), out)
    }
}

/** ORDECK's home, the pure half: what the HUD's cards read, as the web's useHudData.ts reads it. */
class SystemsTest {
    @Test fun aHealthBodySaysWhetherTheAppIsDegraded() {
        assertNull(Systems.degradedReason("""{"status":"ok","service":"beigeboard"}"""))
        assertEquals("cache cold", Systems.degradedReason("""{"status":"ok","degraded":"cache cold"}"""))
        assertEquals("degraded", Systems.degradedReason("""{"status":"ok","degraded":true}"""))
        assertNull(Systems.degradedReason("""{"status":"ok","degraded":""}"""))
        assertEquals("gpu asleep", Systems.degradedReason("""{"status":"ok","compute_online":false}"""))
        assertNull(Systems.degradedReason("""{"compute_online":true}"""))
        // Non-JSON health is fine (the web's probe swallows the parse), and so is none.
        assertNull(Systems.degradedReason("OK"))
        assertNull(Systems.degradedReason(null))
    }

    @Test fun aProbeIsARow() {
        assertEquals(SysRow("auth", SysStatus.Up, "12 ms"), Systems.row("auth", true, 12, "{}"))
        assertEquals(SysRow("auth", SysStatus.Up, "1 ms"), Systems.row("auth", true, 0, null))
        assertEquals(SysRow("lazuros", SysStatus.Warn, "gpu asleep"), Systems.row("lazuros", true, 40, """{"compute_online":false}"""))
        // Refused (the gate's 302 included) is down, whatever the body says.
        assertEquals(SysRow("kouros", SysStatus.Down, "down"), Systems.row("kouros", false, 3, """{"degraded":"x"}"""))
    }

    @Test fun theHeadCountsWarnAsUp() {
        val s = SystemsState(listOf(
            Systems.row("auth", true, 12, null), Systems.row("beigeboard", false, 0, null),
            Systems.row("lazuros", true, 30, """{"compute_online":false}"""), Systems.row("kouros", true, 24, null),
        ))
        assertEquals(3, s.up)
        assertEquals(4, s.total)
        assertEquals("3 / 4 UP", s.summary)
        assertEquals(listOf(Tone.Ok, Tone.Danger, Tone.Warn, Tone.Ok), s.rows.map { it.tone })
        assertEquals("0 / 2 UP", Systems.probing(listOf("auth", "kouros")).summary)
    }

    @Test fun tonesRankAsTheRenderersToneRank() {
        // @jkos/widget-render's TONE_RANK: danger 0, warn 1, accent 2, ok 3, muted 4.
        assertEquals(listOf(Tone.Danger, Tone.Warn, Tone.Accent, Tone.Ok, Tone.Muted), Tone.entries.sortedBy { it.ordinal })
    }
}
