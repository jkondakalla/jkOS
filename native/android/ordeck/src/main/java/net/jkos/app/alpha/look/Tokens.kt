package net.jkos.app.alpha.look

import kotlin.math.pow
import kotlin.math.roundToInt

// The suite's colour tokens, derived the way packages/design/tokens/hub.css derives them: the
// two faces' literal values, and the accent chain computed from the person's own accent pair
// with CSS color-mix arithmetic. Pure Kotlin (no Android import), so the JVM test holds every
// token here to the value a real Chromium computes for it
// (packages/design/tokens/computed-baseline.json). Names follow hub.css's tier-2 `--color-*`.

/** A colour with straight (non-premultiplied) alpha, every channel in 0..1. */
data class Rgba(val r: Double, val g: Double, val b: Double, val a: Double = 1.0) {
    fun alpha(a: Double) = copy(a = a)

    /** 0xAARRGGBB, for Compose's Color(Long). */
    fun argb(): Long {
        fun c(x: Double) = (x.coerceIn(0.0, 1.0) * 255).roundToInt().toLong()
        return (c(a) shl 24) or (c(r) shl 16) or (c(g) shl 8) or c(b)
    }

    /** WCAG 2 relative luminance, from the linear channels. */
    fun luminance(): Double {
        fun lin(c: Double) = if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    companion object {
        val Transparent = Rgba(0.0, 0.0, 0.0, 0.0)
        val White = Rgba(1.0, 1.0, 1.0)
        val Black = Rgba(0.0, 0.0, 0.0)

        /** `#rgb` or `#rrggbb`, or null for anything else. */
        fun hexOrNull(s: String?): Rgba? {
            val h = s?.trim()?.removePrefix("#") ?: return null
            if (!h.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
            val full = when (h.length) {
                3 -> h.map { "$it$it" }.joinToString("")
                6 -> h
                else -> return null
            }
            val v = full.toLong(16)
            return Rgba(((v shr 16) and 0xff) / 255.0, ((v shr 8) and 0xff) / 255.0, (v and 0xff) / 255.0)
        }

        fun hex(s: String): Rgba = requireNotNull(hexOrNull(s)) { "not a colour: $s" }
        fun rgba(r: Int, g: Int, b: Int, a: Double) = Rgba(r / 255.0, g / 255.0, b / 255.0, a)
    }
}

/**
 * CSS `color-mix(in srgb, a p%, b)`: premultiplied interpolation, so mixing with `transparent`
 * keeps the hue and only lowers the alpha (the browser's rule, CSS Color 5 § 3).
 */
fun mix(a: Rgba, percent: Double, b: Rgba): Rgba {
    val p = percent / 100.0
    val alpha = a.a * p + b.a * (1 - p)
    if (alpha == 0.0) return Rgba.Transparent
    fun ch(x: Double, y: Double) = (x * a.a * p + y * b.a * (1 - p)) / alpha
    return Rgba(ch(a.r, b.r), ch(a.g, b.g), ch(a.b, b.b), alpha)
}

/** The tokens a screen reads, for one face and one accent pair. */
data class Palette(
    val dark: Boolean,
    // grounds
    val paper: Rgba, val paper2: Rgba, val card: Rgba, val card2: Rgba, val lit: Rgba,
    val screen: Rgba, val screenLine: Rgba,
    val metal0: Rgba, val metal1: Rgba, val metal2: Rgba,
    val bevelLight: Rgba, val bevelDark: Rgba,
    // ink and rules
    val ink: Rgba, val muted: Rgba, val faint: Rgba, val ghost: Rgba,
    val line: Rgba, val lineStrong: Rgba, val lineBright: Rgba,
    // the accent family
    val accent: Rgba, val accentBright: Rgba, val accentDim: Rgba, val accentDeep: Rgba,
    val accentGlow: Rgba, val accentSoft: Rgba, val accentInk: Rgba, val accentContrast: Rgba,
    val secondary: Rgba, val secondaryDim: Rgba, val secondaryGlow: Rgba, val tertiary: Rgba,
    val onAccent: Rgba, val onAccentDim: Rgba, val onAccentFaint: Rgba,
    // status
    val ok: Rgba, val okGlow: Rgba, val okSoft: Rgba,
    val warn: Rgba, val warnSoft: Rgba,
    val danger: Rgba, val dangerGlow: Rgba, val dangerSoft: Rgba,
    // fields and veils
    val fieldFace: Rgba, val fieldFaceFocus: Rgba,
    val scrim: Rgba, val scrimHeavy: Rgba,
    /** The paper face's deepen targets: the warm near-black every darkening mixes toward. */
    val deepenInk: Rgba, val deepenInkMeter: Rgba,
)

object Tokens {
    /** auth-client's DEFAULT_THEME: the first of @jkos/design's ACCENT_SCHEMES (amber · cyan). */
    const val HOUSE_PRIMARY = "#ffb000"
    const val HOUSE_SECONDARY = "#4ecdc4"

    private val DeepenInk = Rgba.hex("#2a1c0e")
    private val DeepenInkMeter = Rgba.hex("#1a0a00")

    /** The tier-1 values a face declares outright (hub.css's two `:root` blocks). */
    private class Ground(
        val g0: String, val g1: String, val g2: String, val g3: String, val g4: String,
        val screen: String, val screenLine: String,
        val metal: List<String>, val bevelLight: Rgba, val bevelDark: Rgba,
        val line: String, val lineStrong: String, val lineBright: String,
        val ink: String, val muted: String, val faint: String, val ghost: String,
        val danger: String, val dangerGlow: Rgba, val ok: String, val okGlow: Rgba, val warn: String, val tertiary: String,
    )

    private val PaperGround = Ground(
        "#ede2c8", "#e4d5b0", "#f5ead4", "#ead9bb", "#f7f1e3", "#f0e8d8", "#d8c8b0",
        listOf("#d4c8a8", "#c8bca0", "#b8a888"), Rgba.rgba(255, 252, 230, 0.85), Rgba.rgba(80, 50, 20, 0.18),
        "#c8ae88", "#b09a72", "#907854", "#1c1408", "#6b5038", "#9c8060", "#b8a888",
        "#b42010", mix(Rgba.hex("#b42010"), 22.0, Rgba.Transparent), "#2a7040", mix(Rgba.hex("#2a7040"), 22.0, Rgba.Transparent),
        "#a04010", "#8a2060",
    )

    private val DarkGround = Ground(
        "#11100d", "#1a1814", "#232019", "#2c2820", "#38321f", "#0e0c08", "#2a2418",
        listOf("#2a2620", "#3a342b", "#4a4234"), Rgba.rgba(255, 220, 160, 0.06), Rgba.rgba(0, 0, 0, 0.5),
        "#3a3528", "#4a4232", "#6a5d3e", "#efe6c9", "#d6cba8", "#8a8067", "#5a543f",
        "#ff4530", Rgba.rgba(255, 69, 48, 0.4), "#5cd66a", Rgba.rgba(92, 214, 106, 0.35),
        "#fbbf24", "#ff5d8f",
    )

    /**
     * The palette for a face and the person's raw accent pair (preferences.theme.primary and
     * .secondary). An unreadable colour falls back to the house pair, as the web's would.
     */
    fun palette(dark: Boolean, primary: String = HOUSE_PRIMARY, secondary: String = HOUSE_SECONDARY): Palette {
        val g = if (dark) DarkGround else PaperGround
        val rawA = Rgba.hexOrNull(primary) ?: Rgba.hex(HOUSE_PRIMARY)
        val rawS = Rgba.hexOrNull(secondary) ?: Rgba.hex(HOUSE_SECONDARY)
        val g0 = Rgba.hex(g.g0)
        val g2 = Rgba.hex(g.g2)

        // THE ACCENT CHAIN. Paper deepens the raw pair toward the warm ink so a vivid or
        // pastel pick holds on kraft; the tube shows it raw and makes it glow.
        val accent = if (dark) rawA else mix(rawA, 64.0, DeepenInk)
        val secondaryC = if (dark) rawS else mix(rawS, 64.0, DeepenInk)
        val accentDim = if (dark) mix(accent, 72.0, Rgba.hex("#1a1400")) else mix(accent, 72.0, DeepenInkMeter)
        val accentDeep = if (dark) mix(accent, 26.0, Rgba.Black) else mix(accent, 20.0, g2)
        val accentGlow = mix(accent, if (dark) 38.0 else 30.0, Rgba.Transparent)
        val accentInk = if (dark) mix(accent, 78.0, Rgba.White) else mix(accent, 80.0, Rgba.Black)
        val secondaryDim = if (dark) mix(secondaryC, 50.0, Rgba.Black) else mix(secondaryC, 60.0, Rgba.Black)
        val secondaryGlow = mix(secondaryC, if (dark) 38.0 else 25.0, Rgba.Transparent)
        val danger = Rgba.hex(g.danger)
        val ok = Rgba.hex(g.ok)
        val warn = Rgba.hex(g.warn)

        return Palette(
            dark = dark,
            paper = g0, paper2 = Rgba.hex(g.g1), card = g2, card2 = Rgba.hex(g.g3), lit = Rgba.hex(g.g4),
            screen = Rgba.hex(g.screen), screenLine = Rgba.hex(g.screenLine),
            metal0 = Rgba.hex(g.metal[0]), metal1 = Rgba.hex(g.metal[1]), metal2 = Rgba.hex(g.metal[2]),
            bevelLight = g.bevelLight, bevelDark = g.bevelDark,
            ink = Rgba.hex(g.ink), muted = Rgba.hex(g.muted), faint = Rgba.hex(g.faint), ghost = Rgba.hex(g.ghost),
            line = Rgba.hex(g.line), lineStrong = Rgba.hex(g.lineStrong), lineBright = Rgba.hex(g.lineBright),
            accent = accent,
            accentBright = mix(accent, 55.0, Rgba.White),
            accentDim = accentDim, accentDeep = accentDeep, accentGlow = accentGlow,
            accentSoft = mix(accent, 12.0, g2),
            accentInk = accentInk,
            // D10: black or white, whichever contrasts more with the accent (the WCAG crossing).
            accentContrast = if (accent.luminance() > 0.17913) Rgba.Black else Rgba.White,
            secondary = secondaryC, secondaryDim = secondaryDim, secondaryGlow = secondaryGlow,
            tertiary = Rgba.hex(g.tertiary),
            onAccent = Rgba.rgba(255, 255, 255, 0.95), onAccentDim = Rgba.rgba(255, 255, 255, 0.7),
            onAccentFaint = Rgba.rgba(255, 255, 255, 0.45),
            ok = ok, okGlow = g.okGlow, okSoft = mix(ok, 12.0, g2),
            warn = warn, warnSoft = mix(warn, 11.0, g2),
            danger = danger, dangerGlow = g.dangerGlow, dangerSoft = mix(danger, 10.0, g2),
            // A field is a slot: debossed paper stock, or the tube's darkest unlit glass.
            fieldFace = if (dark) Rgba.hex(g.screen) else g0,
            fieldFaceFocus = if (dark) g0 else mix(accent, 4.0, g0),
            scrim = Rgba.rgba(10, 8, 6, 0.5), scrimHeavy = Rgba.rgba(5, 4, 3, 0.85),
            deepenInk = DeepenInk, deepenInkMeter = DeepenInkMeter,
        )
    }

    /**
     * The tokens by their hub.css names, for the test that holds this file to the browser.
     * Every token the palette implements is listed; a token added to [Palette] and not here
     * is simply not checked, so keep the two together.
     */
    fun byCssName(p: Palette): Map<String, Rgba> = mapOf(
        "--color-paper" to p.paper, "--color-paper-2" to p.paper2, "--color-card" to p.card,
        "--color-card-2" to p.card2, "--color-lit" to p.lit, "--color-screen" to p.screen,
        "--color-screen-line" to p.screenLine, "--color-metal-0" to p.metal0, "--color-metal-1" to p.metal1,
        "--color-metal-2" to p.metal2, "--color-bevel-light" to p.bevelLight, "--color-bevel-dark" to p.bevelDark,
        "--color-ink" to p.ink, "--color-muted" to p.muted, "--color-faint" to p.faint, "--color-ghost" to p.ghost,
        "--color-line" to p.line, "--color-line-strong" to p.lineStrong, "--color-line-bright" to p.lineBright,
        "--color-accent" to p.accent, "--color-accent-bright" to p.accentBright, "--color-accent-dim" to p.accentDim,
        "--color-accent-deep" to p.accentDeep, "--color-accent-glow" to p.accentGlow,
        "--color-accent-soft" to p.accentSoft, "--color-accent-ink" to p.accentInk,
        "--color-secondary" to p.secondary, "--color-secondary-dim" to p.secondaryDim,
        "--color-secondary-glow" to p.secondaryGlow, "--color-tertiary" to p.tertiary,
        "--color-on-accent" to p.onAccent, "--color-on-accent-dim" to p.onAccentDim,
        "--color-on-accent-faint" to p.onAccentFaint,
        "--color-ok" to p.ok, "--color-ok-glow" to p.okGlow, "--color-ok-soft" to p.okSoft,
        "--color-warn" to p.warn, "--color-warn-soft" to p.warnSoft,
        "--color-danger" to p.danger, "--color-danger-glow" to p.dangerGlow, "--color-danger-soft" to p.dangerSoft,
        "--hub-field-face" to p.fieldFace, "--hub-field-face-focus" to p.fieldFaceFocus,
        "--color-scrim" to p.scrim, "--color-scrim-heavy" to p.scrimHeavy,
        "--hub-deepen-ink" to p.deepenInk, "--hub-deepen-ink-meter" to p.deepenInkMeter,
    )
}
