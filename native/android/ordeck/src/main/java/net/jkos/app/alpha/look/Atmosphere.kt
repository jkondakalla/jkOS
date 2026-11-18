package net.jkos.app.alpha.look

import android.graphics.Bitmap
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import kotlin.math.roundToInt
import kotlin.random.Random

// The suite's atmosphere, as buildJkOSTheme() and hub.css lay it on a web page:
//   grain   film grain on the GROUND only — multiplied into paper, screened onto the tube
//   rake    paper, with halation on: a slow beam of light raking across the sheet
//   buzz    the tube, with halation on: a faint phosphor glow in the centre
//   scan    the scan-line veil, when the person turned it on (BeigeBoard's ScanLines)
// None of it sits under content's own surfaces except the overlays, which take no touches.

/**
 * True where nothing may tick or loop: the screenshot renders, whose test clock would advance an
 * endless animation forever waiting for it to settle. The rake and the masthead clock hold still.
 */
val LocalStill = staticCompositionLocalOf { false }

/** hub.css's grain tile: 160 CSS px of desaturated fractal noise at the face's opacity. */
private fun grainTile(px: Int, opacity: Float): ImageBitmap {
    // A fixed seed: the sheet is the same sheet every time it is drawn.
    val rnd = Random(0x6A6B)
    val n = 160
    val small = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
    val pixels = IntArray(n * n) {
        // feTurbulence's fractal noise sits around mid-grey, and so does its alpha.
        val v = (128 + (rnd.nextFloat() - 0.5f) * 96).roundToInt().coerceIn(0, 255)
        val a = ((0.25f + rnd.nextFloat() * 0.25f) * opacity * 255).roundToInt().coerceIn(0, 255)
        (a shl 24) or (v shl 16) or (v shl 8) or v
    }
    small.setPixels(pixels, 0, n, 0, 0, n, n)
    // Scaled to CSS px (dp) with filtering, so a speck is a soft dot, not a hard device pixel.
    return Bitmap.createScaledBitmap(small, px, px, true).asImageBitmap()
}

private fun motionOff(context: android.content.Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

/** The page's ground: the face's paper with its grain, then the content, then the veils. */
@Composable
fun Ground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val face = Jk.face
    val density = LocalDensity.current.density
    val tile = remember(face.dark, density) {
        grainTile((160 * density).roundToInt(), if (face.dark) 0.135f else 0.495f)
    }
    val grain = remember(tile) { ShaderBrush(ImageShader(tile, TileMode.Repeated, TileMode.Repeated)) }
    Box(
        modifier.drawBehind {
            drawRect(face.paper)
            drawRect(grain, blendMode = if (face.dark) BlendMode.Screen else BlendMode.Multiply)
        },
    ) {
        content()
        if (face.halation) Ambient(face)
        if (face.scanLines) ScanVeil(face)
    }
}

/** The rake on paper, the buzz on the tube (hub.css .jk-rake / .jk-buzz). */
@Composable
private fun BoxScope.Ambient(face: JkFace) {
    if (face.dark) {
        // A radial phosphor bloom, screened in at ~5.6% (crtBuzz breathes 0.05 → 0.062).
        Canvas(Modifier.matchParentSize()) {
            val glow = Brush.radialGradient(
                0f to Color(0xFFFFF0D2), 0.6f to Color(0x33FFDCAA), 0.78f to Color.Transparent,
                center = Offset(size.width / 2, size.height * 0.4f), radius = size.maxDimension * 0.6f,
            )
            drawRect(glow, alpha = 0.056f, blendMode = BlendMode.Screen)
        }
        return
    }
    val context = LocalContext.current
    if (LocalStill.current || remember { motionOff(context) }) return
    // rakeSweep: 26 s, in from the left, out past the right, never fully lit.
    val t by rememberInfiniteTransition(label = "rake").animateFloat(
        0f, 1f, infiniteRepeatable(tween(26_000, easing = LinearEasing), RepeatMode.Restart), label = "rake-t",
    )
    Canvas(Modifier.matchParentSize()) {
        val opacity = when {
            t < 0.2f -> t / 0.2f * 0.25f
            t < 0.5f -> 0.25f + (t - 0.2f) / 0.3f * 0.25f
            t < 0.8f -> 0.5f - (t - 0.5f) / 0.3f * 0.25f
            else -> 0.25f * (1f - (t - 0.8f) / 0.2f)
        }
        val w = size.width * 0.6f
        val x = size.width * (-0.4f + t * 1.0f)
        rotate(8f, pivot = Offset(x + w / 2, size.height / 2)) {
            drawRect(
                Brush.horizontalGradient(
                    0f to Color.Transparent, 0.45f to Color(0xE6FFFBEB), 0.6f to Color(0x40784F1E), 1f to Color.Transparent,
                    startX = x, endX = x + w,
                ),
                topLeft = Offset(x, -size.height * 0.3f),
                size = androidx.compose.ui.geometry.Size(w, size.height * 1.6f),
                alpha = opacity, blendMode = BlendMode.Softlight,
            )
        }
    }
}

/** BeigeBoard's ScanLines: a 1px line every 4px, ink at 2 × strength %. */
@Composable
private fun BoxScope.ScanVeil(face: JkFace) {
    val ink = if (face.dark) Color.White else Color.Black
    val line = ink.copy(alpha = (0.02f * face.scanStrength.toFloat()).coerceIn(0f, 1f))
    Canvas(Modifier.matchParentSize()) {
        val step = 4.dp(density)
        var y = 3.dp(density)
        while (y < size.height) {
            drawRect(line, topLeft = Offset(0f, y), size = androidx.compose.ui.geometry.Size(size.width, 1.dp(density)))
            y += step
        }
    }
}

private fun Int.dp(density: Float) = this * density

/** A page that fills its parent with the ground. */
@Composable
fun GroundPage(content: @Composable BoxScope.() -> Unit) = Ground(Modifier.fillMaxSize(), content)
