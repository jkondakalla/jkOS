package net.jkos.app.alpha

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

// The suite's dark face (packages/design/tokens/hub.css): ORDECK's near-black ground, the
// cream ink and the amber accent, with KourOS's violet kept for its own surfaces.
object Palette {
    val Ground = Color(0xFF0F0F0F)      // ORDECK's theme_color, = @color/surface_dark
    val Surface = Color(0xFF1A1814)
    val SurfaceHigh = Color(0xFF2A261E)
    val Ink = Color(0xFFEFE6C9)         // --hub-ink (dark)
    val InkDim = Color(0xFFA39A86)
    val Amber = Color(0xFFFFB000)       // --hub-accent (dark)
    val OnAmber = Color(0xFF1C1408)     // --hub-ink (light): text on the accent
    val Violet = Color(0xFF4B3F8F)      // KourOS's theme_color
    val Danger = Color(0xFFFF4530)      // --hub-danger (dark)
}

private val Scheme = darkColorScheme(
    primary = Palette.Amber,
    onPrimary = Palette.OnAmber,
    primaryContainer = Palette.Violet,
    onPrimaryContainer = Palette.Ink,
    secondary = Palette.Amber,
    onSecondary = Palette.OnAmber,
    background = Palette.Ground,
    onBackground = Palette.Ink,
    surface = Palette.Surface,
    onSurface = Palette.Ink,
    surfaceVariant = Palette.SurfaceHigh,
    onSurfaceVariant = Palette.InkDim,
    outline = Palette.InkDim,
    error = Palette.Danger,
)

@Composable
fun JkosTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = Scheme, content = content)

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
    val Account = glyph("account") {
        moveTo(9f, 3f); lineTo(15f, 3f); lineTo(16.5f, 5f); lineTo(16.5f, 9f); lineTo(15f, 11f)
        lineTo(9f, 11f); lineTo(7.5f, 9f); lineTo(7.5f, 5f); close()
        moveTo(4f, 21f); lineTo(5f, 15.5f); lineTo(8f, 13f); lineTo(16f, 13f); lineTo(19f, 15.5f); lineTo(20f, 21f); close()
    }
}
