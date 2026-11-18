package net.jkos.app.alpha.beigeboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// The Workshop's cards, as the web draws them (apps/beigeboard/src/views/workshop): a routine's
// card with its streak and its week (cadence.tsx RoutineCard), and a library entry's card with
// its ladder drawn in full (LibraryBrowser.tsx EntryCard). Thumb-sized for a phone.

/** A heading in the bold serif, ink, with paper's catch-light under it (the web's `Press` on a rail). */
@Composable
fun SerifHead(text: String, size: androidx.compose.ui.unit.TextUnit, modifier: Modifier = Modifier) {
    val face = Jk.face
    Text(
        text, modifier,
        style = TextStyle(
            fontFamily = JkFonts.SerifDisplay, fontWeight = FontWeight.Bold, fontSize = size, lineHeight = size * 1.05, letterSpacing = (-0.02).em,
            color = face.ink, shadow = if (face.dark) null else androidx.compose.ui.graphics.Shadow(Color.White.copy(alpha = 0.55f), androidx.compose.ui.geometry.Offset(0f, 1.5f), 0f),
        ),
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/** The web's RailHead: a section's name in the bold serif, and a count in mono caps beside it. */
@Composable
fun RailHead(label: String, meta: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
        SerifHead(label, 19.sp)
        Spacer(Modifier.weight(1f))
        Eyebrow(meta, Modifier.padding(bottom = 3.dp))
    }
}

/** A quiet button in a dashed hairline (the web's `TButton quiet` with `borderStyle: dashed`): the way something new arrives. */
@Composable
fun DashedButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val face = Jk.face
    Box(
        modifier
            .clip(RoundedCornerShape(JkRadius.sm))
            .drawBehind {
                drawRoundRect(face.line, cornerRadius = CornerRadius(JkRadius.sm.toPx()),
                    style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
            }
            .clickable(role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = 44.dp)
            .padding(horizontal = 13.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, letterSpacing = 0.04.em, color = face.faint))
    }
}

/**
 * A routine's week as seven segments (.jk-vu with the per-slot faces): done lit in the
 * routine's tint, missed a struck wash, a day nothing was asked of held below the unlit line.
 */
@Composable
fun WeekStrip(cells: List<WeekCell>, tint: Color, modifier: Modifier = Modifier, height: Int = 7) {
    val face = Jk.face
    Row(modifier.fillMaxWidth().height(height.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (c in cells) {
            val fill = when (c.state) {
                CellState.Done -> tint
                CellState.Missed -> if (face.dark) tint.mix(18.0, face.paper) else face.deepenInk.mix(22.0, face.line)
                else -> face.line
            }
            Box(
                Modifier.weight(1f).fillMaxHeight()
                    .alpha(if (c.state == CellState.Off) 0.24f else 1f)
                    .drawBehind { if (c.state == CellState.Done && face.dark) boxShadow(tint.mix(60.0, Color.Transparent), 1.dp, 4.dp) }
                    .clip(RoundedCornerShape(1.dp))
                    .background(fill),
            )
        }
    }
}

/**
 * A routine's card (the web's RoutineCard): its tint, its name, how many sessions in a row it
 * has kept, this week's seven days, its cadence and what it is. A parked routine is faded.
 */
@Composable
fun RoutineCard(r: Routine, items: List<Item>, today: String, onClick: () -> Unit) {
    val face = Jk.face
    val tint = r.item.accent?.let { a -> runCatching { Color(android.graphics.Color.parseColor(a)) }.getOrNull() } ?: face.accent
    val parked = (r.item.status ?: "active") != "active"
    val cells = Cadence.week(r.item, items, Days.weekStart(today), today)
    val streak = Cadence.streak(r.item, items, today)
    val shape = RoundedCornerShape(JkRadius.base)
    Column(
        Modifier.fillMaxWidth().alpha(if (parked) 0.55f else 1f)
            .clip(shape).border(1.dp, face.line, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(tint))
            Spacer(Modifier.width(10.dp))
            Text(r.item.title, Modifier.weight(1f),
                style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = (-0.015).em, color = face.ink),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (parked) { Spacer(Modifier.width(8.dp)); Pill("Parked", tint = face.secondary) }
            Spacer(Modifier.width(8.dp))
            Seg(streak.toString(), size = 16.sp)
            Spacer(Modifier.width(5.dp))
            Eyebrow("In a row", size = 8.sp)
        }
        WeekStrip(cells, tint)
        // The cadence in mono caps, as the web's card; what the routine is, in the sans under it
        // (the web squeezes it into 170px of caps beside the cadence, too tight to read on a phone).
        Cadence.line(r.item).takeIf { it.isNotEmpty() }?.let { Eyebrow(it) }
        Text(r.summary ?: "No steps yet", style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, lineHeight = 18.sp, color = face.muted), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A library entry's card (the web's EntryCard): what it is, what a step inherits, the slug a
 * step names it by, how it climbs (the ladder in full: whether it is the RIGHT ladder is the
 * question), and its tags.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntryCard(e: LibraryEntry, onClick: () -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(JkRadius.sm)
    Column(
        Modifier.fillMaxWidth().clip(shape).border(1.dp, face.line, shape).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(e.title, Modifier.weight(1f),
                style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = (-0.01).em, color = face.ink),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            val dose = listOfNotNull(e.unit, e.loadUnit).joinToString(" · ")
            if (dose.isNotEmpty()) Eyebrow(dose, Modifier.padding(start = 8.dp))
        }
        Eyebrow(e.slug + if (e.source == "starter") " · starter" else "")
        if (e.variants.size > 1) {
            Text(
                buildAnnotatedString {
                    e.variants.forEachIndexed { i, v ->
                        if (i > 0) withStyle(SpanStyle(color = face.faint)) { append(" › ") }
                        withStyle(SpanStyle(color = if (i == 0) face.ink else face.muted, fontWeight = if (i == 0) FontWeight.SemiBold else FontWeight.Normal)) { append(v) }
                    }
                },
                style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 12.5.sp, lineHeight = 17.sp),
            )
        }
        if (e.tags.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (t in e.tags.take(4)) Eyebrow("#$t")
            }
        }
    }
}
