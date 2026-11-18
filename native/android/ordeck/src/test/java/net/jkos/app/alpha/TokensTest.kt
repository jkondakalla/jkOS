package net.jkos.app.alpha

import net.jkos.app.alpha.auth.Look
import net.jkos.app.alpha.look.Rgba
import net.jkos.app.alpha.look.Tokens
import net.jkos.app.alpha.look.mix
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs

/**
 * The app's two faces are the web's, token for token: every colour look/Tokens.kt derives for
 * the house accent pair is held to what a real Chromium computes from hub.css
 * (computed-baseline.json, written by test/token-identity.mjs). Change hub.css, regenerate the
 * baseline, and this fails until the app follows.
 */
class TokensTest {
    private val baseline = JSONObject(File(System.getProperty("jkos.tokenBaseline") ?: error("jkos.tokenBaseline not set")).readText())
        .getJSONObject("values")

    /** A computed value as Chromium serialises it: rgb(), rgba(), or color(srgb r g b [/ a]). */
    private fun parse(css: String): Rgba {
        val s = css.trim()
        Regex("""^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$""").matchEntire(s)?.let { m ->
            val (r, g, b) = m.destructured
            return Rgba(r.toDouble() / 255, g.toDouble() / 255, b.toDouble() / 255, m.groupValues[4].ifEmpty { "1" }.toDouble())
        }
        Regex("""^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: / ([\d.]+))?\)$""").matchEntire(s)?.let { m ->
            val (r, g, b) = m.destructured
            return Rgba(r.toDouble(), g.toDouble(), b.toDouble(), m.groupValues[4].ifEmpty { "1" }.toDouble())
        }
        error("unparsed computed colour: $css")
    }

    private fun near(a: Rgba, b: Rgba) =
        listOf(a.r - b.r, a.g - b.g, a.b - b.b, a.a - b.a).all { abs(it) <= 1.0 / 255 }

    private fun holdFace(face: String, dark: Boolean) {
        val tokens = Tokens.byCssName(Tokens.palette(dark))
        val wrong = tokens.mapNotNull { (name, mine) ->
            val used = baseline.optJSONObject(name)?.optJSONObject(face)?.optString("used")
                ?: return@mapNotNull "$name: not in the baseline (renamed in hub.css?)"
            val web = parse(used)
            if (near(mine, web)) null else "$name: app ${fmt(mine)} · web ${fmt(web)} ($used)"
        }
        assertTrue("the $face face drifted from hub.css:\n  " + wrong.joinToString("\n  "), wrong.isEmpty())
    }

    private fun fmt(c: Rgba) = "rgba(%.3f %.3f %.3f / %.2f)".format(c.r, c.g, c.b, c.a)

    @Test fun thePaperFaceIsHubCss() = holdFace("light", dark = false)
    @Test fun theDarkFaceIsHubCss() = holdFace("dark", dark = true)

    @Test fun theHousePairIsTheWebDefault() {
        assertTrue(near(Rgba.hex(Tokens.HOUSE_PRIMARY), parse(baseline.getJSONObject("--hub-accent-raw").getJSONObject("light").getString("used"))))
        assertTrue(near(Rgba.hex(Tokens.HOUSE_SECONDARY), parse(baseline.getJSONObject("--hub-secondary-raw").getJSONObject("light").getString("used"))))
        assertEquals(Tokens.HOUSE_PRIMARY, Look().primary)
        assertEquals(Tokens.HOUSE_SECONDARY, Look().secondary)
    }

    @Test fun colorMixIsTheBrowsers() {
        // With transparent, the hue stays and only the alpha drops (premultiplied).
        assertTrue(near(mix(Rgba.hex("#ffb000"), 38.0, Rgba.Transparent), Rgba.hex("#ffb000").alpha(0.38)))
        assertTrue(near(mix(Rgba.White, 50.0, Rgba.Black), Rgba(0.5, 0.5, 0.5)))
    }

    @Test fun anotherPairDerivesItsOwnChain() {
        // Green · Violet: paper deepens it, the tube shows it raw.
        val paper = Tokens.palette(false, "#5cd66a", "#c08aff")
        val dark = Tokens.palette(true, "#5cd66a", "#c08aff")
        assertTrue(near(dark.accent, Rgba.hex("#5cd66a")))
        assertTrue(near(paper.accent, mix(Rgba.hex("#5cd66a"), 64.0, Rgba.hex("#2a1c0e"))))
        assertTrue(near(dark.secondary, Rgba.hex("#c08aff")))
    }

    @Test fun anUnreadableAccentIsTheHousePair() {
        val p = Tokens.palette(true, "url(javascript:1)", "#12")
        assertTrue(near(p.accent, Rgba.hex(Tokens.HOUSE_PRIMARY)))
        assertTrue(near(p.secondary, Rgba.hex(Tokens.HOUSE_SECONDARY)))
        assertEquals(null, Rgba.hexOrNull("#ggg"))
        assertTrue(near(Rgba.hex("#fa0"), Rgba.hex("#ffaa00")))
    }
}
