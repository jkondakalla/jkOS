package net.jkos.app.alpha.look

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// The suite's primitives (@jkos/ui's primitives.tsx over hub.css), drawn in Compose. A screen
// builds from these, not from Material's defaults, so the app prints like the web: the same
// names, the same recipes, the same flip between the faces — paper presses and debosses, the
// tube glows. Radii are BeigeBoard's scale (its injectJkOSTheme call), the suite's roundest.

object JkRadius {
    val xs = 4.dp
    val sm = 7.dp
    val base = 8.dp
    val lg = 11.dp
    val button = 8.dp
}

// ── light: shadows and glows ────────────────────────────────────────────────────

/**
 * A soft shadow or glow behind a rounded box: CSS `box-shadow: x y blur spread color`.
 * Drawn with a blur mask (hardware-accelerated from API 28; below that, a crisp edge).
 */
fun DrawScope.boxShadow(color: Color, radius: Dp, blur: Dp, dy: Dp = 0.dp, spread: Dp = 0.dp) {
    if (color.alpha == 0f) return
    drawIntoCanvas { canvas ->
        val paint = Paint()
        val fp = paint.asFrameworkPaint()
        fp.color = color.toArgb()
        if (blur > 0.dp) fp.maskFilter = BlurMaskFilter(blur.toPx() / 2, BlurMaskFilter.Blur.NORMAL)
        val s = spread.toPx()
        canvas.drawRoundRect(-s, dy.toPx() - s, size.width + s, size.height + dy.toPx() + s, radius.toPx(), radius.toPx(), paint)
    }
}

/** An inset 1px line along the top edge (the bevel's catch-light), inside a rounded box. */
private fun DrawScope.topCatch(color: Color, radius: Dp) {
    if (color.alpha == 0f) return
    drawRoundRect(
        Brush.verticalGradient(0f to color, 1.dp.toPx() / size.height to Color.Transparent),
        cornerRadius = CornerRadius(radius.toPx()),
    )
}

/** A recess: shade falling inward from the top lip (the well and the field). */
private fun DrawScope.innerShade(color: Color, radius: Dp, depth: Dp) {
    drawRoundRect(
        Brush.verticalGradient(0f to color, (depth.toPx() / size.height).coerceAtMost(1f) to Color.Transparent),
        cornerRadius = CornerRadius(radius.toPx()),
    )
}

/** Text that glows on the tube (--hub-halo-text) and prints flat on paper. */
@Composable
fun haloText(color: Color, percent: Double = 55.0, blur: Float = 12f): Shadow? {
    val face = Jk.face
    return if (face.dark && face.halation) Shadow(color.mix(percent, Color.Transparent), Offset.Zero, blur * 2) else null
}

// ── type ───────────────────────────────────────────────────────────────────────

/** .jk-mono-eyebrow: tracked mono caps, faint. Meta, counts, states ("DAY 322 · 06 EVENTS"). */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = Jk.face.faint, size: TextUnit = 10.sp, maxLines: Int = 1) {
    Text(
        text.uppercase(), modifier,
        style = TextStyle(fontFamily = JkFonts.Mono, fontSize = size, letterSpacing = 0.2.em, color = color),
        maxLines = maxLines, overflow = TextOverflow.Ellipsis,
    )
}

/** .jk-lab: Fraunces caps, tracked — a section's name ("THE BENCH", "GOALS IN PRESS"). */
@Composable
fun Lab(text: String, modifier: Modifier = Modifier, color: Color = Jk.face.muted, small: Boolean = true) {
    Text(
        text.uppercase(), modifier,
        style = TextStyle(
            fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold,
            fontSize = if (small) 11.sp else 12.sp, letterSpacing = if (small) 0.14.em else 0.15.em,
            color = color, shadow = if (color == Jk.face.accent) haloText(color) else null,
        ),
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/** A section's name in the accent (the web's `<Lab size="sm" style={{color: accent}}>`). */
@Composable
fun AccentLab(text: String, modifier: Modifier = Modifier) = Lab(text, modifier, color = Jk.face.accent)

/**
 * .jk-press-lg: the page's big accent title, raised off paper (a catch-light above, two deep
 * lips below) and haloed on the tube. Fraunces display.
 */
@Composable
fun PressTitle(
    text: String, modifier: Modifier = Modifier, size: TextUnit = 30.sp, color: Color = Jk.face.accent,
    italic: Boolean = false, weight: FontWeight = FontWeight.Bold,
) {
    val face = Jk.face
    val base = TextStyle(
        fontFamily = JkFonts.SerifDisplay, fontWeight = weight, fontSize = size,
        lineHeight = size * 1.08, letterSpacing = (-0.02).em, fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    )
    if (face.dark) {
        Text(text, modifier, style = base.copy(color = color, shadow = if (face.halation) Shadow(color.mix(55.0, Color.Transparent), Offset.Zero, 24f) else null))
        return
    }
    Box(modifier) {
        // The two lower lips and the soft fall-off, then the face with its catch-light.
        Text(text, Modifier.offset(y = 2.dp), style = base.copy(color = color.mix(48.0, face.deepenInk), shadow = Shadow(Color(0x3D302214), Offset(0f, 4f), 8f)))
        Text(text, style = base.copy(color = color, shadow = Shadow(color.mix(58.0, face.deepenInk), Offset(0f, 2f), 0f)))
    }
}

/** The wordmark: the app's name in Fraunces semibold italic, pressed in the accent. */
@Composable
fun Wordmark(text: String, modifier: Modifier = Modifier, size: TextUnit = 24.sp) =
    PressTitle(text, modifier, size, italic = true, weight = FontWeight.SemiBold)

/** .jk-seg: a readout — phosphor numerals on the tube, printed lining figures on paper. */
@Composable
fun Seg(text: String, modifier: Modifier = Modifier, size: TextUnit = 15.sp, color: Color = Jk.face.accent) {
    val face = Jk.face
    val style = if (face.dark) {
        TextStyle(fontFamily = JkFonts.Seg, fontWeight = FontWeight.Bold, fontSize = size, letterSpacing = 0.05.em, color = color,
            shadow = Shadow(color.mix(face.palette.accentGlow.a * 100, Color.Transparent), Offset.Zero, 16f))
    } else {
        TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = size, letterSpacing = 0.03.em, color = color,
            fontFeatureSettings = "lnum, tnum")
    }
    Text(text, modifier, style = style, maxLines = 1)
}

/** .jk-folio: a running head — rules above and below, serif caps, the number in accent italic. */
@Composable
fun Folio(label: String, number: String? = null, modifier: Modifier = Modifier) {
    val face = Jk.face
    val style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.2.em, color = face.ink)
    Row(
        modifier
            .drawBehind {
                drawRect(face.ink, size = Size(size.width, 1.5.dp.toPx()))
                drawRect(face.ink, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx()))
            }
            .padding(horizontal = 2.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label.uppercase(), style = style)
        if (number != null) Text(number.uppercase(), style = style.copy(color = face.accent, fontStyle = FontStyle.Italic, shadow = haloText(face.accent)))
    }
}

/** .jk-press-sm / -ink: an item's title on a chip — Fraunces semibold, tinted on the tube. */
@Composable
fun ChipTitle(text: String, tint: Color, done: Boolean = false, modifier: Modifier = Modifier, size: TextUnit = 14.sp, maxLines: Int = 1) {
    val face = Jk.face
    val color = when {
        done -> face.faint
        else -> face.ink
    }
    Text(
        text, modifier,
        style = TextStyle(
            fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = size, letterSpacing = (-0.005).em, color = color,
            textDecoration = if (done) TextDecoration.LineThrough else null,
            shadow = if (done) null else if (face.dark) Shadow(tint.mix(45.0, Color.Transparent), Offset.Zero, 18f)
            else Shadow(Color.White.copy(alpha = 0.55f), Offset(0f, 1.5f), 0f),
        ),
        maxLines = maxLines, overflow = TextOverflow.Ellipsis,
    )
}

// ── surfaces ───────────────────────────────────────────────────────────────────

/** .jk-sheet: the card — card stock, a hairline, the card shadow and a lit top edge. */
@Composable
fun Sheet(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(horizontal = 18.dp, vertical = 16.dp), content: @Composable ColumnScope.() -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(JkRadius.lg)
    Column(
        modifier
            .drawBehind { boxShadow(face.ink.copy(alpha = 0.10f), JkRadius.lg, 8.dp, dy = 2.dp) }
            .clip(shape)
            .background(face.card)
            .drawBehind { topCatch(face.bevelLight, JkRadius.lg) }
            .border(1.dp, face.line, shape)
            .padding(padding),
        content = content,
    )
}

/** A Sheet's head: the accent Lab on the left, a mono eyebrow on the right. */
@Composable
fun SheetHead(title: String, meta: String? = null, onMeta: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        AccentLab(title, Modifier.weight(1f))
        if (meta != null) {
            Eyebrow(meta, if (onMeta != null) Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = onMeta).padding(4.dp) else Modifier)
        }
    }
}

/**
 * .jk-chip: an item on the sheet, in its own tint. Paper raises it (a lit top edge, a tinted
 * lip, a drop shadow); the tube makes it emit (a glow and a tinted ring). [done] sinks it.
 */
@Composable
fun Chip(
    tint: Color, modifier: Modifier = Modifier, done: Boolean = false, solid: Boolean = false,
    onClick: (() -> Unit)? = null, padding: PaddingValues = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
    content: @Composable RowScope.() -> Unit,
) {
    val face = Jk.face
    val r = JkRadius.xs
    val shape = RoundedCornerShape(r)
    val fill = when {
        done -> tint.mix(7.0, face.card)
        solid && face.dark -> tint.mix(26.0, Color(0xFF0E0B07))
        solid -> tint.mix(82.0, face.deepenInk)
        else -> tint.mix(14.0, face.card)
    }
    Row(
        modifier
            .drawBehind {
                when {
                    done -> Unit
                    face.dark -> boxShadow(tint.mix(if (solid) 35.0 else 48.0, Color.Transparent), r, 14.dp)
                    else -> {
                        boxShadow(Color(0x47302214), r, 5.dp, dy = 2.dp)
                        if (!solid) drawRoundRect(tint.mix(28.0, face.line), topLeft = Offset(0f, 1.dp.toPx()), size = size, cornerRadius = CornerRadius(r.toPx()))
                    }
                }
            }
            .clip(shape)
            .background(fill)
            .drawWithContent {
                drawContent()
                when {
                    done -> drawRoundRect(tint.mix(if (face.dark) 25.0 else 20.0, Color.Transparent), cornerRadius = CornerRadius(r.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                    face.dark -> drawRoundRect(tint.mix(if (solid) 52.0 else 42.0, Color.Transparent), cornerRadius = CornerRadius(r.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                    else -> topCatch(Color.White.copy(alpha = if (solid) 0.2f else 0.6f), r)
                }
            }
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding)
            .then(if (done) Modifier else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        content = content,
    )
}

/**
 * .jk-well: a region sunk into the sheet in a tint — debossed on paper, an emissive ring and
 * glow on the tube. The selected nav tab is a well.
 */
@Composable
fun Well(modifier: Modifier = Modifier, tint: Color = Jk.face.accent, radius: Dp = JkRadius.lg, content: @Composable BoxScope.() -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(radius)
    Box(
        modifier
            .drawBehind {
                if (face.dark) boxShadow(tint.mix(38.0, Color.Transparent), radius, 10.dp)
                else drawRoundRect(Color.White.copy(alpha = 0.45f), topLeft = Offset(0f, 1.dp.toPx()), size = size, cornerRadius = CornerRadius(radius.toPx()))
            }
            .clip(shape)
            .background(tint.mix(14.0, face.card))
            .drawWithContent {
                if (!face.dark) innerShade(face.ink.copy(alpha = 0.32f), radius, 4.dp)
                drawContent()
                if (face.dark) drawRoundRect(tint.mix(30.0, Color.Transparent), cornerRadius = CornerRadius(radius.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
            },
        content = content,
    )
}

/** A hairline rule in the line colour. [strong] is the ink rule under a page's title. */
@Composable
fun Rule(modifier: Modifier = Modifier, strong: Boolean = false) {
    val face = Jk.face
    Box(modifier.fillMaxWidth().height(if (strong) 2.dp else 1.dp).background(if (strong) face.ink else face.line))
}

// ── controls ───────────────────────────────────────────────────────────────────

/**
 * .jk-tbtn: the text button — printed, not typed. Fraunces semibold, tracked, a hairline box.
 * [quiet] fades it; [primary] is the badge (.jk-bubble-primary), the one loud action.
 */
@Composable
fun TButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    quiet: Boolean = false, primary: Boolean = false, content: @Composable RowScope.() -> Unit,
) {
    val face = Jk.face
    val r = JkRadius.sm
    val shape = RoundedCornerShape(r)
    val ink = when {
        !enabled -> face.ghost
        primary -> face.accent
        quiet -> face.faint
        else -> face.muted
    }
    val base = modifier
        .defaultMinSize(minHeight = 40.dp)
        .semantics(mergeDescendants = true) {}
    val drawn = if (primary && enabled) {
        base
            .drawBehind {
                if (face.dark) boxShadow(face.accent.mix(38.0, Color.Transparent), r, 10.dp)
                else boxShadow(Color(0x47302214), r, 5.dp, dy = 2.dp)
            }
            .clip(shape)
            .background(face.accent.mix(14.0, face.card))
            .drawWithContent {
                drawContent()
                if (face.dark) drawRoundRect(face.accent.mix(30.0, Color.Transparent), cornerRadius = CornerRadius(r.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                else topCatch(Color.White.copy(alpha = 0.6f), r)
            }
    } else {
        base.clip(shape).border(1.dp, if (quiet || !enabled) face.line.mix(55.0, Color.Transparent) else face.line, shape)
    }
    CompositionLocalProvider(
        LocalContentColor provides ink,
        LocalTextStyle provides MaterialTheme.typography.labelLarge.copy(color = ink, shadow = if (primary && enabled) haloText(face.accent) else null),
    ) {
        Row(
            drawn.clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 13.dp, vertical = 9.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

/**
 * .jk-check: the drawn check — paper stock in a strong hairline, filled with the tint and
 * ticked when done, glowing on the tube. At BeigeBoard's radius it reads as a round stamp.
 */
@Composable
fun Check(checked: Boolean, onChange: ((Boolean) -> Unit)?, tint: Color = Jk.face.accent, modifier: Modifier = Modifier, size: Dp = 20.dp, label: String? = null) {
    val face = Jk.face
    val shape = RoundedCornerShape(if (size >= 18.dp) size / 2 else JkRadius.sm)
    Box(
        modifier
            .size(44.dp)
            .then(if (onChange != null) Modifier.clickable(role = Role.Checkbox) { onChange(!checked) } else Modifier)
            .semantics { if (label != null) contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(size)
                .drawBehind { if (checked && face.dark) boxShadow(tint.mix(40.0, Color.Transparent), size / 2, 8.dp) }
                .clip(shape)
                .background(if (checked) tint else face.paper2)
                .border(1.dp, if (checked) tint else face.lineStrong, shape),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) Text("✓", style = TextStyle(fontSize = (size.value * 0.6f).sp, color = face.onAccent, fontWeight = FontWeight.Bold))
        }
    }
}

/**
 * <Bar>: one well, one fill. The fill runs from the tint deepened toward the meter ink to the
 * tint itself, with a faint glow; the track is the page's paper in a hairline.
 */
@Composable
fun Bar(value: Float, modifier: Modifier = Modifier, tint: Color = Jk.face.accent, height: Dp = 5.dp, radius: Dp = 3.dp) {
    val face = Jk.face
    val v = value.coerceIn(0f, 1f)
    val shape = RoundedCornerShape(radius)
    Box(modifier.fillMaxWidth().height(height).clip(shape).background(face.paper).border(1.dp, face.line, shape)) {
        if (v > 0f) Box(
            Modifier.fillMaxHeight().fillMaxWidth(v)
                .background(Brush.horizontalGradient(listOf(tint.mix(72.0, face.deepenInkMeter), tint))),
        )
    }
}

/**
 * <VU>: a segmented meter, lit up to [value]. The lit segments glow on the tube. The track is a
 * recess (the day meter's well).
 */
@Composable
fun VU(value: Float, modifier: Modifier = Modifier, segments: Int = 24, tint: Color = Jk.face.accent, height: Dp = 14.dp) {
    val face = Jk.face
    val lit = Math.round(value.coerceIn(0f, 1f) * segments)
    Row(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(2.dp))
            .background(if (face.dark) Color.Black.copy(alpha = 0.4f) else face.deepenInk.copy(alpha = 0.55f))
            .border(1.dp, face.line, RoundedCornerShape(2.dp))
            .drawWithContent { drawContent(); innerShade(Color.Black.copy(alpha = 0.45f), 2.dp, 4.dp) }
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        repeat(segments) { i ->
            val on = i < lit
            Box(
                Modifier.weight(1f).fillMaxHeight()
                    .drawBehind { if (on && face.dark) boxShadow(tint.mix(60.0, Color.Transparent), 1.dp, 4.dp) }
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (on) tint else face.line),
            )
        }
    }
}

/** .jk-pill: a status — tracked mono caps in a ring, OK-green unless tinted, glowing on the tube. */
@Composable
fun Pill(text: String, modifier: Modifier = Modifier, tint: Color = Jk.face.ok) {
    val shape = RoundedCornerShape(JkRadius.lg)
    Text(
        text.uppercase(),
        modifier.clip(shape).border(1.dp, tint.mix(40.0, Color.Transparent), shape).padding(horizontal = 11.dp, vertical = 5.dp),
        style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 10.sp, letterSpacing = 0.16.em, color = tint, shadow = haloText(tint, 35.0, 8f)),
        maxLines = 1,
    )
}

/** RecLamp: a lit dot, with its label in tracked caps ("● LIVE"). */
@Composable
fun Lamp(label: String?, modifier: Modifier = Modifier, color: Color = Jk.face.accent) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(7.dp)
                .drawBehind { boxShadow(color.copy(alpha = 0.8f), 3.5.dp, 8.dp) }
                .clip(RoundedCornerShape(50))
                .background(color),
        )
        if (label != null) Text(
            label.uppercase(),
            style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, letterSpacing = 0.22.em, color = color),
        )
    }
}

/**
 * .jk-field: where the person writes. Mono, a debossed slot on paper (a shade from the top lip)
 * and the darkest glass on the tube; engaged, the rim takes the accent. Material's field does
 * the typing (keyboard, IME, label); this dresses it.
 */
@Composable
fun Field(
    value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, readOnly: Boolean = false,
    label: (@Composable () -> Unit)? = null, placeholder: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    singleLine: Boolean = false, minLines: Int = 1, maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    textStyle: TextStyle = LocalTextStyle.current,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val face = Jk.face
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val r = JkRadius.xs
    val mono = TextStyle(fontFamily = JkFonts.Mono, fontSize = 15.sp, color = face.ink).merge(textStyle.copy(color = face.ink).let { if (textStyle.fontFamily != null) it else it.copy(fontFamily = JkFonts.Mono) })
    OutlinedTextField(
        value = value, onValueChange = onValueChange,
        modifier = modifier.drawWithContent {
            drawContent()
            // The recess, over the field's own face (Material draws the container).
            if (!face.dark) innerShade(face.ink.copy(alpha = if (focused) 0.30f else 0.22f), r, if (focused) 5.dp else 3.dp)
            else innerShade(Color.Black.copy(alpha = 0.5f), r, 5.dp)
        },
        enabled = enabled, readOnly = readOnly, label = label, placeholder = placeholder, trailingIcon = trailingIcon,
        singleLine = singleLine, minLines = minLines, maxLines = maxLines, textStyle = mono,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        interactionSource = interaction,
        shape = RoundedCornerShape(r),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = face.fieldFaceFocus, unfocusedContainerColor = face.fieldFace, disabledContainerColor = face.fieldFace,
            focusedBorderColor = face.accent.mix(75.0, face.line), unfocusedBorderColor = face.line, disabledBorderColor = face.line.mix(55.0, Color.Transparent),
            cursorColor = face.accent, focusedTextColor = face.ink, unfocusedTextColor = face.ink, disabledTextColor = face.faint,
            focusedLabelColor = face.accent, unfocusedLabelColor = face.faint,
            focusedPlaceholderColor = face.faint, unfocusedPlaceholderColor = face.faint,
        ),
    )
}

// ── navigation ─────────────────────────────────────────────────────────────────

/**
 * .jk-masthead-tab: a nav tab. Tracked mono caps over an optional sub-label; the selected tab
 * is a well, its name in the accent (haloed on the tube).
 */
@Composable
fun MastTab(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, sub: String? = null) {
    val face = Jk.face
    val content: @Composable () -> Unit = {
        Column(
            Modifier.fillMaxWidth().clickable(role = Role.Tab, onClick = onClick).padding(horizontal = 4.dp, vertical = if (sub != null) 7.dp else 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                label.uppercase(),
                style = TextStyle(
                    fontFamily = JkFonts.Mono, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, fontSize = 11.sp,
                    letterSpacing = 0.16.em, color = if (selected) face.accent else face.muted,
                    shadow = if (selected) haloText(face.accent) else null,
                ),
                maxLines = 1,
            )
            if (sub != null) Text(
                sub.uppercase(),
                style = TextStyle(fontFamily = JkFonts.Mono, fontSize = 8.sp, letterSpacing = 0.2.em, color = if (selected) face.accent.mix(70.0, face.faint) else face.faint.mix(75.0, Color.Transparent)),
                maxLines = 1,
            )
        }
    }
    if (selected) Well(modifier, radius = JkRadius.sm) { content() } else Box(modifier) { content() }
}

/** .jk-masthead::after: the ink at 30% under the masthead, feathered at both ends. */
fun Modifier.mastheadRule(ink: Color): Modifier = drawBehind {
    val y = size.height - 1.dp.toPx()
    drawRect(
        Brush.horizontalGradient(0f to Color.Transparent, 0.06f to ink, 0.94f to ink, 1f to Color.Transparent),
        topLeft = Offset(0f, y), size = Size(size.width, 1.dp.toPx()), alpha = 0.3f,
    )
}

/** An empty state: an italic serif line, faint (the web's "Nothing benched for the week."). */
@Composable
fun Hush(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier,
        style = TextStyle(fontFamily = JkFonts.Serif, fontStyle = FontStyle.Italic, fontSize = 14.sp, lineHeight = 20.sp, color = Jk.face.faint),
    )
}

/** A gap of [h] dp, for the column rhythm. */
@Composable
fun Gap(h: Int) = Spacer(Modifier.height(h.dp))

/** A gap of [w] dp in a row. */
@Composable
fun RowScope.HGap(w: Int) = Spacer(Modifier.width(w.dp))

// ── hardware: the fader and the knob ───────────────────────────────────────────

/**
 * .jk-slider: the house fader. A recessed hairline track filled with the accent up to the
 * playhead, under a metal fader CAP (a short upright bar, the accent at its rim).
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun JkSlider(
    value: Float, onValueChange: (Float) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    onValueChangeFinished: (() -> Unit)? = null, valueRange: ClosedFloatingPointRange<Float> = 0f..1f, steps: Int = 0,
    tint: Color = Jk.face.accent,
) {
    val face = Jk.face
    androidx.compose.material3.Slider(
        value = value, onValueChange = onValueChange, modifier = modifier, enabled = enabled,
        onValueChangeFinished = onValueChangeFinished, valueRange = valueRange, steps = steps,
        thumb = {
            Box(
                Modifier.size(width = 12.dp, height = 22.dp)
                    .drawBehind {
                        if (face.dark) boxShadow(tint.mix(45.0, Color.Transparent), 3.dp, 8.dp)
                        else boxShadow(Color(0x47302214), 3.dp, 4.dp, dy = 1.dp)
                    }
                    .clip(RoundedCornerShape(3.dp))
                    .background(Brush.verticalGradient(listOf(face.metal(0), face.metal(2))))
                    .border(1.dp, tint.mix(70.0, face.lineStrong), RoundedCornerShape(3.dp)),
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.size(width = 6.dp, height = 1.5.dp).background(tint)) }
        },
        track = { state ->
            val range = state.valueRange
            val f = ((state.value - range.start) / (range.endInclusive - range.start)).coerceIn(0f, 1f)
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(face.paper).border(1.dp, face.line, RoundedCornerShape(2.dp))) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(f).background(if (enabled) tint else face.ghost))
            }
        },
    )
}

/** The face's metal tones (--color-metal-0…2), for hardware. */
fun JkFace.metal(i: Int): Color = when (i) { 0 -> palette.metal0.color; 1 -> palette.metal1.color; else -> palette.metal2.color }

/**
 * The transport knob: the one round, lit control — a domed accent button with a catch-light,
 * a drop shadow on paper and a bloom on the tube. Its glyph is the warm ink.
 */
@Composable
fun Knob(onClick: () -> Unit, label: String, modifier: Modifier = Modifier, size: Dp = 64.dp, enabled: Boolean = true, content: @Composable () -> Unit) {
    val face = Jk.face
    val tint = if (enabled) face.accent else face.ghost
    Box(
        modifier
            .size(size)
            .drawBehind {
                if (face.dark) boxShadow(tint.mix(55.0, Color.Transparent), size / 2, 22.dp)
                else boxShadow(Color(0x59302214), size / 2, 10.dp, dy = 3.dp)
            }
            .clip(RoundedCornerShape(50))
            .drawBehind {
                // The dome: lit from the upper left, as the web's knob.
                drawCircle(Brush.radialGradient(
                    listOf(tint.mix(55.0, Color.White), tint, tint.mix(80.0, face.deepenInk)),
                    center = Offset(this.size.width * 0.4f, this.size.height * 0.32f), radius = this.size.width * 0.78f,
                ))
            }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        CompositionLocalProvider(LocalContentColor provides Color(0xFF2A1C0E)) { content() }
    }
}
