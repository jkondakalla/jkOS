package net.jkos.app.alpha.look

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** A token as Compose draws it. */
val Rgba.color: Color get() = Color(argb())

/** CSS color-mix over Compose colours: `p`% of this, the rest [other]. */
fun Color.mix(percent: Double, other: Color): Color =
    mix(Rgba(red.toDouble(), green.toDouble(), blue.toDouble(), alpha.toDouble()), percent,
        Rgba(other.red.toDouble(), other.green.toDouble(), other.blue.toDouble(), other.alpha.toDouble())).color

/**
 * The face a screen is drawn on: the palette (look/Tokens.kt) as Compose colours, and whether
 * this is the tube. Read it as `Jk.face`. What the person turned on (halation, scan lines)
 * comes with it, because a primitive's look depends on it.
 */
@Immutable
class JkFace(val palette: Palette, val halation: Boolean, val scanLines: Boolean, val scanStrength: Double) {
    val dark = palette.dark
    val paper = palette.paper.color
    val paper2 = palette.paper2.color
    val card = palette.card.color
    val card2 = palette.card2.color
    val lit = palette.lit.color
    val screen = palette.screen.color
    val bevelLight = palette.bevelLight.color
    val bevelDark = palette.bevelDark.color
    val ink = palette.ink.color
    val muted = palette.muted.color
    val faint = palette.faint.color
    val ghost = palette.ghost.color
    val line = palette.line.color
    val lineStrong = palette.lineStrong.color
    val lineBright = palette.lineBright.color
    val accent = palette.accent.color
    val accentDim = palette.accentDim.color
    val accentDeep = palette.accentDeep.color
    val accentGlow = palette.accentGlow.color
    val accentSoft = palette.accentSoft.color
    val accentInk = palette.accentInk.color
    val accentContrast = palette.accentContrast.color
    val secondary = palette.secondary.color
    val secondaryGlow = palette.secondaryGlow.color
    val tertiary = palette.tertiary.color
    val onAccent = palette.onAccent.color
    val onAccentDim = palette.onAccentDim.color
    val ok = palette.ok.color
    val okGlow = palette.okGlow.color
    val warn = palette.warn.color
    val danger = palette.danger.color
    val dangerGlow = palette.dangerGlow.color
    val fieldFace = palette.fieldFace.color
    val fieldFaceFocus = palette.fieldFaceFocus.color
    val scrim = palette.scrim.color
    val deepenInk = palette.deepenInk.color
    val deepenInkMeter = palette.deepenInkMeter.color

    /** The glow a tinted thing gives off on the tube, at hub.css's usual strengths. */
    fun glow(tint: Color, percent: Double) = tint.mix(percent, Color.Transparent)
}

val LocalJkFace = staticCompositionLocalOf { JkFace(Tokens.palette(false), halation = true, scanLines = false, scanStrength = 0.25) }

object Jk {
    val face: JkFace
        @Composable @ReadOnlyComposable get() = LocalJkFace.current
}
