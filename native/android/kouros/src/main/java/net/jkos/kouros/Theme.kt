package net.jkos.kouros

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

// KourOS's palette: its web manifest's theme colour (#4b3f8f), the gold accent, and the cream
// ink jkOS Home's offline screen uses (home/src/main/res/values/themes.xml), on dark surfaces.
object Kouros {
    val Violet = Color(0xFF4B3F8F)
    val Gold = Color(0xFFDBA13C)
    val Cream = Color(0xFFEDE2C8)
    val CreamDim = Color(0xFFA39A86)
    val Night = Color(0xFF141220) // = @color/surface_dark, the window behind the first frame
    val Surface = Color(0xFF1C1930)
    val SurfaceHigh = Color(0xFF282443)
}

private val Scheme = darkColorScheme(
    primary = Kouros.Violet,
    onPrimary = Kouros.Cream,
    primaryContainer = Kouros.Violet,
    onPrimaryContainer = Kouros.Cream,
    secondary = Kouros.Gold,
    onSecondary = Kouros.Night,
    background = Kouros.Night,
    onBackground = Kouros.Cream,
    surface = Kouros.Surface,
    onSurface = Kouros.Cream,
    surfaceVariant = Kouros.SurfaceHigh,
    onSurfaceVariant = Kouros.CreamDim,
    outline = Kouros.CreamDim,
)

@Composable
fun KourosTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = Scheme, content = content)

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
    val Account = glyph("account") {
        moveTo(9f, 3f); lineTo(15f, 3f); lineTo(16.5f, 5f); lineTo(16.5f, 9f); lineTo(15f, 11f)
        lineTo(9f, 11f); lineTo(7.5f, 9f); lineTo(7.5f, 5f); close()
        moveTo(4f, 21f); lineTo(5f, 15.5f); lineTo(8f, 13f); lineTo(16f, 13f); lineTo(19f, 15.5f); lineTo(20f, 21f); close()
    }
}
