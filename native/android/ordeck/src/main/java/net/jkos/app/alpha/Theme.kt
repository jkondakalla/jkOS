package net.jkos.app.alpha

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import net.jkos.app.alpha.auth.ThemeMode

// The suite's two faces, from packages/design/tokens/hub.css as a browser computes them
// (packages/design/tokens/computed-baseline.json): paper and dark. Which one is drawn is the
// person's own `preferences.theme.mode`, the same setting every web app follows.
private class Face(
    val ground: Color, val surface: Color, val surfaceHigh: Color, val line: Color,
    val ink: Color, val inkDim: Color, val accent: Color, val onAccent: Color,
    val danger: Color, val ok: Color,
)

private val DarkFace = Face(
    ground = Color(0xFF11100D),       // --hub-ground-0
    surface = Color(0xFF1A1814),      // --hub-ground-1
    surfaceHigh = Color(0xFF2C2820),  // --hub-ground-3
    line = Color(0xFF3A3528),         // --hub-line
    ink = Color(0xFFEFE6C9),          // --hub-ink
    inkDim = Color(0xFFD6CBA8),       // --hub-ink-muted
    accent = Color(0xFFFFB000),       // --hub-accent
    onAccent = Color(0xFF1C1408),
    danger = Color(0xFFFF4530),       // --hub-danger
    ok = Color(0xFF5CD66A),           // --hub-ok
)

private val PaperFace = Face(
    ground = Color(0xFFEDE2C8),
    surface = Color(0xFFE4D5B0),
    surfaceHigh = Color(0xFFEAD9BB),
    line = Color(0xFFC8AE88),
    ink = Color(0xFF1C1408),
    inkDim = Color(0xFF6B5038),
    accent = Color(0xFFB27B05),       // the amber deepened for paper (color-mix 64% with #2a1c0e)
    onAccent = Color(0xFFF7F1E3),     // --hub-ground-4
    danger = Color(0xFFB42010),
    ok = Color(0xFF2A7040),
)

/** KourOS's own colour (its web manifest's theme_color), for its surfaces. */
val KourosViolet = Color(0xFF4B3F8F)

private fun schemeOf(f: Face, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = f.accent, onPrimary = f.onAccent,
        primaryContainer = KourosViolet, onPrimaryContainer = Color(0xFFEFE6C9),
        secondary = f.accent, onSecondary = f.onAccent,
        // A progress bar's track (Material's default is lavender, which neither face has).
        secondaryContainer = f.line, onSecondaryContainer = f.ink,
        tertiary = f.ok, onTertiary = f.ground,
        background = f.ground, onBackground = f.ink,
        surface = f.surface, onSurface = f.ink,
        surfaceVariant = f.surfaceHigh, onSurfaceVariant = f.inkDim,
        outline = f.line, outlineVariant = f.line,
        error = f.danger, onError = f.ground,
    )
}

@Composable
fun JkosTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = mode.isDark(isSystemInDarkTheme())
    val scheme = schemeOf(if (dark) DarkFace else PaperFace, dark)
    // ⚠️ The app paints its ground with a Box, not a Surface, so nothing set the content colour
    // and any Text without its own colour was BLACK: invisible on the dark face. Seen in the
    // screenshot renders (2026-11-17). The ground's ink is the default now.
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalContentColor provides scheme.onBackground, content = content)
    }
}

/** The few glyphs the app needs, drawn here on a 24-unit grid (no icon library). */
object Glyphs {
    private fun glyph(name: String, draw: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .path(fill = SolidColor(Color.Black)) { draw() }
            .build()

    val Play = glyph("play") { moveTo(8f, 5f); lineTo(19f, 12f); lineTo(8f, 19f); close() }
    val Pause = glyph("pause") {
        moveTo(6f, 5f); lineTo(10f, 5f); lineTo(10f, 19f); lineTo(6f, 19f); close()
        moveTo(14f, 5f); lineTo(18f, 5f); lineTo(18f, 19f); lineTo(14f, 19f); close()
    }
    val Next = glyph("next") {
        moveTo(6f, 6f); lineTo(14.5f, 12f); lineTo(6f, 18f); close()
        moveTo(16f, 6f); lineTo(18f, 6f); lineTo(18f, 18f); lineTo(16f, 18f); close()
    }
    val Previous = glyph("previous") {
        moveTo(18f, 6f); lineTo(9.5f, 12f); lineTo(18f, 18f); close()
        moveTo(6f, 6f); lineTo(8f, 6f); lineTo(8f, 18f); lineTo(6f, 18f); close()
    }
    val Back = glyph("back") {
        moveTo(20f, 11f); lineTo(7.8f, 11f); lineTo(13.4f, 5.4f); lineTo(12f, 4f); lineTo(4f, 12f)
        lineTo(12f, 20f); lineTo(13.4f, 18.6f); lineTo(7.8f, 13f); lineTo(20f, 13f); close()
    }
    val Radio = glyph("radio") {
        // A mast and three arcs, as stepped polygons.
        moveTo(11f, 11f); lineTo(13f, 11f); lineTo(13f, 21f); lineTo(11f, 21f); close()
        moveTo(8f, 6f); lineTo(9.5f, 7.5f); lineTo(8.5f, 9.5f); lineTo(9.5f, 11.5f); lineTo(8f, 13f); lineTo(6.5f, 9.5f); close()
        moveTo(16f, 6f); lineTo(17.5f, 9.5f); lineTo(16f, 13f); lineTo(14.5f, 11.5f); lineTo(15.5f, 9.5f); lineTo(14.5f, 7.5f); close()
        moveTo(5f, 3f); lineTo(6.5f, 4.5f); lineTo(4.5f, 9.5f); lineTo(6.5f, 14.5f); lineTo(5f, 16f); lineTo(2.5f, 9.5f); close()
        moveTo(19f, 3f); lineTo(21.5f, 9.5f); lineTo(19f, 16f); lineTo(17.5f, 14.5f); lineTo(19.5f, 9.5f); lineTo(17.5f, 4.5f); close()
    }
    val Home = glyph("home") {
        moveTo(12f, 3f); lineTo(21f, 11f); lineTo(18.5f, 11f); lineTo(18.5f, 20f); lineTo(14f, 20f)
        lineTo(14f, 14f); lineTo(10f, 14f); lineTo(10f, 20f); lineTo(5.5f, 20f); lineTo(5.5f, 11f); lineTo(3f, 11f); close()
    }
    val Music = glyph("music") {
        // Two note heads, their stems and the beam.
        moveTo(9f, 4f); lineTo(20f, 2.5f); lineTo(20f, 16f); lineTo(18f, 16f); lineTo(18f, 6.8f); lineTo(11f, 7.8f); lineTo(11f, 18f); lineTo(9f, 18f); close()
        moveTo(5f, 15.5f); lineTo(9f, 15.5f); lineTo(11f, 17.5f); lineTo(11f, 19f); lineTo(9f, 21f); lineTo(5f, 21f); lineTo(3.5f, 19f); lineTo(3.5f, 17.5f); close()
        moveTo(14f, 13.5f); lineTo(18f, 13.5f); lineTo(20f, 15.5f); lineTo(20f, 17f); lineTo(18f, 19f); lineTo(14f, 19f); lineTo(12.5f, 17f); lineTo(12.5f, 15.5f); close()
    }
    val Board = glyph("board") {
        // Three rows: a tick box and its line.
        moveTo(3f, 4f); lineTo(7f, 4f); lineTo(7f, 8f); lineTo(3f, 8f); close()
        moveTo(9f, 5f); lineTo(21f, 5f); lineTo(21f, 7f); lineTo(9f, 7f); close()
        moveTo(3f, 10f); lineTo(7f, 10f); lineTo(7f, 14f); lineTo(3f, 14f); close()
        moveTo(9f, 11f); lineTo(21f, 11f); lineTo(21f, 13f); lineTo(9f, 13f); close()
        moveTo(3f, 16f); lineTo(7f, 16f); lineTo(7f, 20f); lineTo(3f, 20f); close()
        moveTo(9f, 17f); lineTo(21f, 17f); lineTo(21f, 19f); lineTo(9f, 19f); close()
    }
    val Search = glyph("search") {
        // A ring (an octagon, outer then inner) and its handle.
        moveTo(7.5f, 3f); lineTo(12.5f, 3f); lineTo(16f, 6.5f); lineTo(16f, 11.5f); lineTo(12.5f, 15f)
        lineTo(7.5f, 15f); lineTo(4f, 11.5f); lineTo(4f, 6.5f); close()
        moveTo(8.3f, 5f); lineTo(6f, 7.3f); lineTo(6f, 10.7f); lineTo(8.3f, 13f); lineTo(11.7f, 13f)
        lineTo(14f, 10.7f); lineTo(14f, 7.3f); lineTo(11.7f, 5f); close()
        moveTo(14.5f, 15.9f); lineTo(15.9f, 14.5f); lineTo(21f, 19.6f); lineTo(19.6f, 21f); close()
    }
    val Queue = glyph("queue") {
        // Three lines, and a play mark beside the last.
        moveTo(3f, 5f); lineTo(17f, 5f); lineTo(17f, 7f); lineTo(3f, 7f); close()
        moveTo(3f, 10f); lineTo(17f, 10f); lineTo(17f, 12f); lineTo(3f, 12f); close()
        moveTo(3f, 15f); lineTo(11f, 15f); lineTo(11f, 17f); lineTo(3f, 17f); close()
        moveTo(14f, 13.5f); lineTo(21f, 17f); lineTo(14f, 20.5f); close()
    }
    val Playlist = glyph("playlist") {
        // Three lines and a note.
        moveTo(3f, 5f); lineTo(15f, 5f); lineTo(15f, 7f); lineTo(3f, 7f); close()
        moveTo(3f, 10f); lineTo(15f, 10f); lineTo(15f, 12f); lineTo(3f, 12f); close()
        moveTo(3f, 15f); lineTo(10f, 15f); lineTo(10f, 17f); lineTo(3f, 17f); close()
        moveTo(17f, 4f); lineTo(21f, 4f); lineTo(21f, 6f); lineTo(19f, 6f); lineTo(19f, 18f)
        lineTo(17.5f, 20f); lineTo(14.5f, 20f); lineTo(13f, 18f); lineTo(14.5f, 16f); lineTo(17f, 16f); close()
    }
    val More = glyph("more") {
        moveTo(10.5f, 4f); lineTo(13.5f, 4f); lineTo(13.5f, 7f); lineTo(10.5f, 7f); close()
        moveTo(10.5f, 10.5f); lineTo(13.5f, 10.5f); lineTo(13.5f, 13.5f); lineTo(10.5f, 13.5f); close()
        moveTo(10.5f, 17f); lineTo(13.5f, 17f); lineTo(13.5f, 20f); lineTo(10.5f, 20f); close()
    }
    val Grip = glyph("grip") {
        for (y in listOf(5f, 11f, 17f)) for (x in listOf(8f, 14f)) {
            moveTo(x, y); lineTo(x + 2.5f, y); lineTo(x + 2.5f, y + 2.5f); lineTo(x, y + 2.5f); close()
        }
    }
    val Close = glyph("close") {
        moveTo(6.4f, 5f); lineTo(12f, 10.6f); lineTo(17.6f, 5f); lineTo(19f, 6.4f); lineTo(13.4f, 12f)
        lineTo(19f, 17.6f); lineTo(17.6f, 19f); lineTo(12f, 13.4f); lineTo(6.4f, 19f); lineTo(5f, 17.6f)
        lineTo(10.6f, 12f); lineTo(5f, 6.4f); close()
    }
    val Add = glyph("add") {
        moveTo(11f, 4f); lineTo(13f, 4f); lineTo(13f, 11f); lineTo(20f, 11f); lineTo(20f, 13f); lineTo(13f, 13f)
        lineTo(13f, 20f); lineTo(11f, 20f); lineTo(11f, 13f); lineTo(4f, 13f); lineTo(4f, 11f); lineTo(11f, 11f); close()
    }
    /** "Play next": the new row goes in at the TOP of what's left (web: IconPlayNext). */
    val PlayNext = glyph("play-next") {
        moveTo(3f, 4f); lineTo(10f, 7.5f); lineTo(3f, 11f); close()
        moveTo(12f, 6.5f); lineTo(21f, 6.5f); lineTo(21f, 8.5f); lineTo(12f, 8.5f); close()
        moveTo(3f, 13f); lineTo(21f, 13f); lineTo(21f, 15f); lineTo(3f, 15f); close()
        moveTo(3f, 18f); lineTo(21f, 18f); lineTo(21f, 20f); lineTo(3f, 20f); close()
    }
    /** "Add to queue": the new row goes at the BOTTOM (web: IconAddQueue). */
    val AddQueue = glyph("add-queue") {
        moveTo(3f, 4f); lineTo(21f, 4f); lineTo(21f, 6f); lineTo(3f, 6f); close()
        moveTo(3f, 9f); lineTo(21f, 9f); lineTo(21f, 11f); lineTo(3f, 11f); close()
        moveTo(3f, 14f); lineTo(10f, 17.5f); lineTo(3f, 21f); close()
        moveTo(12f, 16.5f); lineTo(21f, 16.5f); lineTo(21f, 18.5f); lineTo(12f, 18.5f); close()
    }
    val Account = glyph("account") {
        moveTo(9f, 3f); lineTo(15f, 3f); lineTo(16.5f, 5f); lineTo(16.5f, 9f); lineTo(15f, 11f)
        lineTo(9f, 11f); lineTo(7.5f, 9f); lineTo(7.5f, 5f); close()
        moveTo(4f, 21f); lineTo(5f, 15.5f); lineTo(8f, 13f); lineTo(16f, 13f); lineTo(19f, 15.5f); lineTo(20f, 21f); close()
    }
}
