package net.jkos.app.alpha.look

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.R

// The suite's four typefaces, as hub.css names them (--jk-font-*), bundled in res/font
// (native/android/fonts.json pins each file). The web loads the same families from Google
// Fonts; here they ship in the APK so the app needs no font fetch.

object JkFonts {
    // Fraunces is variable on weight and optical size. The browser sets the optical size from
    // the font size (font-optical-sizing: auto); Compose can't, so there are two cuts: the
    // text size and the display size.
    private fun fraunces(opsz: Float) = FontFamily(
        listOf(400, 500, 600, 700).flatMap { w ->
            listOf(
                Font(R.font.fraunces, FontWeight(w), FontStyle.Normal, variationSettings =
                    FontVariation.Settings(FontVariation.weight(w), FontVariation.Setting("opsz", opsz))),
                Font(R.font.fraunces_italic, FontWeight(w), FontStyle.Italic, variationSettings =
                    FontVariation.Settings(FontVariation.weight(w), FontVariation.Setting("opsz", opsz))),
            )
        },
    )

    /** --jk-font-serif at text sizes: labels, titles, buttons, figures. */
    val Serif = fraunces(14f)

    /** --jk-font-serif at display sizes: a page's title, the wordmark. */
    val SerifDisplay = fraunces(72f)

    /** --jk-font-sans: IBM Plex Sans, the prose voice. */
    val Sans = FontFamily(
        listOf(400, 500, 600, 700).map { w ->
            Font(R.font.plex_sans, FontWeight(w), FontStyle.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(w)))
        },
    )

    /** --jk-font-mono: IBM Plex Mono, the typed voice — eyebrows, fields, readouts. */
    val Mono = FontFamily(
        Font(R.font.plex_mono_regular, FontWeight.Normal),
        Font(R.font.plex_mono_medium, FontWeight.Medium),
        Font(R.font.plex_mono_semibold, FontWeight.SemiBold),
    )

    /** --jk-font-seg: Big Shoulders Display, the tube's phosphor numerals (.jk-seg, dark only). */
    val Seg = FontFamily(
        listOf(600, 700).map { w ->
            Font(R.font.big_shoulders_display, FontWeight(w), FontStyle.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(w)))
        },
    )
}

/**
 * Material's type roles, filled with the web's voices so a stock component (a dialog's title, a
 * menu item) prints like the rest of the suite. Sizes are hub.css's touch tier.
 *   display / headline / titleLarge   Fraunces bold: a page's name ("Wednesday, November 18.")
 *   titleMedium / titleSmall          Fraunces semibold: an item's name on a chip or a row
 *   body                              IBM Plex Sans: prose
 *   labelLarge                        Fraunces semibold, tracked: a text button (.jk-tbtn)
 *   labelMedium / labelSmall          IBM Plex Mono, tracked: pills and eyebrows
 */
val JkTypography: Typography = run {
    val display = TextStyle(fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em)
    val title = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em)
    val body = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.Normal)
    val mono = TextStyle(fontFamily = JkFonts.Mono, fontWeight = FontWeight.Normal)
    Typography(
        displayLarge = display.copy(fontSize = 46.sp, lineHeight = 48.sp),
        displayMedium = display.copy(fontSize = 38.sp, lineHeight = 42.sp),
        displaySmall = display.copy(fontSize = 32.sp, lineHeight = 36.sp),
        headlineLarge = display.copy(fontSize = 30.sp, lineHeight = 34.sp),
        headlineMedium = display.copy(fontSize = 26.sp, lineHeight = 30.sp),
        headlineSmall = display.copy(fontSize = 22.sp, lineHeight = 26.sp),
        titleLarge = display.copy(fontSize = 22.sp, lineHeight = 26.sp),
        titleMedium = title.copy(fontSize = 16.sp, lineHeight = 21.sp),
        titleSmall = title.copy(fontSize = 14.sp, lineHeight = 19.sp),
        bodyLarge = body.copy(fontSize = 16.sp, lineHeight = 23.sp),
        bodyMedium = body.copy(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = body.copy(fontSize = 12.5.sp, lineHeight = 17.sp),
        labelLarge = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, letterSpacing = 0.09.em),
        labelMedium = mono.copy(fontSize = 11.sp, letterSpacing = 0.16.em),
        labelSmall = mono.copy(fontSize = 10.sp, letterSpacing = 0.2.em),
    )
}
