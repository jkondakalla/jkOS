package net.jkos.app.alpha.ordeck

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.beigeboard.Item
import net.jkos.app.alpha.look.*
import java.time.LocalDate
import java.time.format.TextStyle as DateStyle
import java.util.Locale

// The HUD's cards, drawn for a phone: one column, thumb-sized targets, text a step up from the
// web's grid (its 12.5px rows were set for a desk). The chrome is the widget renderer's
// (.hud-card, .hud-eyebrow, .hud-p-row, .hud-p-mark — packages/widget-render/src/widgets.css)
// at ORDECK's radius; the bespoke cards are ORDECK's molecules (apps/ordeck/src/hud/host.tsx).

/** ORDECK's card radius (its injectJkOSTheme `lg`: 16px), rounder than BeigeBoard's sheet. */
private val CARD_RADIUS = 16.dp

/** A tone, as the face draws it. */
@Composable
fun toneColor(t: Tone): Color = with(Jk.face) {
    when (t) { Tone.Ok -> ok; Tone.Warn -> warn; Tone.Danger -> danger; Tone.Accent -> accent; Tone.Muted -> faint }
}

private val mono = TextStyle(fontFamily = JkFonts.Mono)

// ── chrome ─────────────────────────────────────────────────────────────────────

/** .hud-card: card stock, a hairline (the accent's when [lit]), the raised shadow. */
@Composable
fun HudCard(modifier: Modifier = Modifier, lit: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(CARD_RADIUS)
    Column(
        modifier
            .fillMaxWidth()
            .drawBehind {
                if (lit && face.dark) boxShadow(face.accent.mix(30.0, Color.Transparent), CARD_RADIUS, 18.dp)
                else boxShadow(face.ink.copy(alpha = if (face.dark) 0.35f else 0.10f), CARD_RADIUS, 10.dp, dy = 2.dp)
            }
            .clip(shape)
            .background(face.card)
            .border(1.dp, if (lit) face.accent.mix(55.0, Color.Transparent) else face.line, shape)
            .padding(16.dp),
        content = content,
    )
}

/** .hud-w-head: the card's name and where it comes from. A source that opens its app reads as a link. */
@Composable
fun CardHead(eyebrow: String, source: String? = null, onSource: (() -> Unit)? = null) {
    val face = Jk.face
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            eyebrow.uppercase(), Modifier.weight(1f).semantics { heading() },
            style = mono.copy(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.16.em, color = face.faint),
            maxLines = 1,
        )
        if (source != null) {
            val label = if (onSource != null) "${source.uppercase()} ›" else source.uppercase()
            Text(
                label,
                (if (onSource != null) Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onSource).padding(horizontal = 6.dp, vertical = 8.dp) else Modifier)
                    .offset(x = if (onSource != null) 6.dp else 0.dp),
                style = mono.copy(fontSize = 11.sp, letterSpacing = 0.04.em, color = if (onSource != null) face.faint else face.ghost),
                maxLines = 1,
            )
        }
    }
}

/** .hud-p-meter: a label, its reading, and the suite's bar. */
@Composable
fun Meter(label: String, reading: String, value: Float, modifier: Modifier = Modifier) {
    val face = Jk.face
    Column(modifier.fillMaxWidth().padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label.uppercase(), Modifier.weight(1f), style = mono.copy(fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.14.em, color = face.muted))
            Text(reading, style = mono.copy(fontSize = 11.5.sp, letterSpacing = 0.06.em, color = face.faint, fontFeatureSettings = "tnum"))
        }
        Bar(value, height = 6.dp, radius = 4.dp)
    }
}

/** .hud-p-mark: a toned dot in a soft ring of its own tone. */
@Composable
fun Mark(tone: Tone, modifier: Modifier = Modifier) {
    val c = toneColor(tone)
    Box(modifier.size(13.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(13.dp).clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.16f)))
        Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(c))
    }
}

/**
 * .hud-p-row, for a thumb: a lead (a time), a title, a detail at the end, and on its left a mark
 * — or, for something that can be ticked off, the suite's round check in the mark's place.
 */
@Composable
fun HudRow(
    title: String, modifier: Modifier = Modifier, lead: String? = null, detail: String? = null,
    tone: Tone = Tone.Muted, done: Boolean = false, onCheck: ((Boolean) -> Unit)? = null, onClick: (() -> Unit)? = null,
    first: Boolean = false,
) {
    val face = Jk.face
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind { if (!first) drawRect(face.line.mix(55.0, Color.Transparent), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .defaultMinSize(minHeight = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // One leading column, 18dp, for the mark or the check's stamp, so every row's time and
        // title start at the same x. The check keeps its whole 44dp target, centred on the stamp.
        Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
            if (onCheck != null) {
                Box(Modifier.wrapContentWidth(unbounded = true)) {
                    Check(done, onCheck, tint = toneColor(tone), size = 18.dp, label = if (done) "Mark not done" else "Mark done")
                }
            } else {
                Mark(tone)
            }
        }
        Spacer(Modifier.width(12.dp))
        if (lead != null) {
            // What is happening now keeps the web's accent where a check took the mark's place.
            Text(lead, Modifier.padding(end = 10.dp), style = mono.copy(fontSize = 12.sp, color = if (tone == Tone.Accent && onCheck != null) face.accent else face.faint, fontFeatureSettings = "tnum"), maxLines = 1)
        }
        Text(
            title, Modifier.weight(1f),
            style = TextStyle(
                fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, fontSize = 14.5.sp, lineHeight = 19.sp,
                color = if (done) face.faint else face.ink, textDecoration = if (done) TextDecoration.LineThrough else null,
            ),
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (detail != null) {
            Text(detail, Modifier.padding(start = 10.dp), style = mono.copy(fontSize = 11.5.sp, color = face.faint), maxLines = 1)
        }
    }
}

/** A card's quiet line: a state, an empty list (.hud-w-note / the web's "note" text). */
@Composable
fun CardNote(text: String, modifier: Modifier = Modifier) = Hush(text, modifier.padding(vertical = 6.dp))

// ── the cards ──────────────────────────────────────────────────────────────────

/**
 * The clock: raw on the ground, no chrome (.hud-clock). The time is pressed in the accent on
 * paper and glows on the tube (.jk-press-lg), the seconds faint beside it.
 */
@Composable
fun ClockCard(face0: ClockFace) {
    val face = Jk.face
    val big = TextStyle(fontFamily = JkFonts.Mono, fontWeight = FontWeight.SemiBold, fontSize = 72.sp, lineHeight = 72.sp, letterSpacing = (-0.01).em, fontFeatureSettings = "tnum")
    Column(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 6.dp, bottom = 2.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            if (face.dark) {
                Text(face0.hm, style = big.copy(color = face.accent, shadow = if (face.halation) Shadow(face.accent.mix(55.0, Color.Transparent), Offset.Zero, 28f) else null))
            } else {
                Box {
                    Text(face0.hm, Modifier.offset(y = 2.dp), style = big.copy(color = face.accent.mix(48.0, face.deepenInk), shadow = Shadow(Color(0x3D302214), Offset(0f, 4f), 8f)))
                    Text(face0.hm, style = big.copy(color = face.accent, shadow = Shadow(face.accent.mix(58.0, face.deepenInk), Offset(0f, 2f), 0f)))
                }
            }
            Text(face0.ss, Modifier.padding(start = 10.dp, bottom = 9.dp), style = mono.copy(fontSize = 24.sp, fontWeight = FontWeight.Medium, color = face.faint, fontFeatureSettings = "tnum"))
        }
        Text(face0.dateLine, Modifier.padding(top = 10.dp), style = mono.copy(fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.16.em, color = face.muted))
        Text(face0.utcLine, Modifier.padding(top = 4.dp), style = mono.copy(fontSize = 11.sp, letterSpacing = 0.12.em, color = face.faint))
    }
}

/** Today: the day's progress, its items (tick a task off in place), and a quick add for today. */
@Composable
fun TodayCard(day: DaySlice, onCheck: (Long, Boolean) -> Unit, onAdd: (String) -> Unit, openBoard: (() -> Unit)?, openItem: (Long) -> Unit = {}) {
    HudCard {
        CardHead("Today", "BeigeBoard", openBoard)
        when {
            !day.reachable -> CardNote("BeigeBoard isn't one of your apps.")
            !day.loaded -> CardNote("Loading…")
            day.offline && day.tasks.isEmpty() -> CardNote("BeigeBoard is offline.")
            day.tasks.isEmpty() -> CardNote("Nothing scheduled today.")
            else -> {
                if (day.offline) CardNote("BeigeBoard is offline: this is the last day it sent.")
                Meter("Done", day.progressLabel, day.progress)
                day.tasks.forEachIndexed { k, t ->
                    HudRow(
                        t.title, lead = t.timeLabel, tone = t.tone, done = t.done, first = k == 0,
                        onCheck = if (t.checkable && !day.offline) { on -> onCheck(t.id, on) } else null,
                        onClick = { openItem(t.id) },
                    )
                }
            }
        }
        if (day.canAdd) QuickAdd(onAdd)
    }
}

/** The Today card's form: one field and ADD (.hud-w-form-bar). The keyboard's Done adds too. */
@Composable
private fun QuickAdd(onAdd: (String) -> Unit) {
    var title by remember { mutableStateOf("") }
    val submit = { if (title.isNotBlank()) { onAdd(title.trim()); title = "" } }
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Field(
            title, { title = it }, Modifier.weight(1f), singleLine = true,
            placeholder = { Text("Add a task for today…", style = mono.copy(fontSize = 14.sp)) },
            textStyle = mono.copy(fontSize = 14.sp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
        )
        TButton(onClick = submit, enabled = title.isNotBlank(), modifier = Modifier.height(52.dp)) {
            Text("ADD", style = mono.copy(fontSize = 11.sp, letterSpacing = 0.12.em))
        }
    }
}

/** The month: a Sunday-first grid, today in a well, a dot on each day with items (green when all are done). */
@Composable
fun CalendarCard(month: MonthSlice, today: LocalDate) {
    val face = Jk.face
    HudCard {
        val name = java.time.Month.of(month.month).getDisplayName(DateStyle.FULL, Locale.US).uppercase()
        CardHead("Calendar", "$name ${month.year}")
        Row(Modifier.fillMaxWidth()) {
            for (d in listOf("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")) {
                Text(d, Modifier.weight(1f).padding(vertical = 4.dp), style = mono.copy(fontSize = 10.sp, letterSpacing = 0.08.em, color = face.ghost, textAlign = androidx.compose.ui.text.style.TextAlign.Center))
            }
        }
        month.cells.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth().padding(vertical = 1.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (day in week) {
                    Box(Modifier.weight(1f).height(40.dp), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val isToday = day == today
                            val info = month.days[day.toString()]
                            Column(
                                Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(JkRadius.xs)).background(if (isToday) face.accentSoft else Color.Transparent),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                Text(
                                    day.dayOfMonth.toString(),
                                    style = mono.copy(
                                        fontSize = 13.sp, lineHeight = 13.sp, fontFeatureSettings = "tnum",
                                        color = if (isToday) face.accentInk else face.muted, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                                    ),
                                )
                                Spacer(Modifier.height(4.dp))
                                Box(Modifier.size(4.dp).clip(RoundedCornerShape(50)).background(
                                    when { info == null -> Color.Transparent; info.second == info.first -> face.ok; else -> face.accent },
                                ))
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The week, as a phone reads one: seven days, Monday first, each with what falls on it. (The
 * web's card is the calendar kit's time grid, which a two-column phone tier squeezes to slivers.)
 */
@Composable
fun WeekCard(days: List<Pair<LocalDate, List<Item>>>, today: LocalDate, openBoard: (() -> Unit)?, openItem: (Long) -> Unit = {}) {
    val face = Jk.face
    HudCard {
        CardHead("Week", "BeigeBoard", openBoard)
        days.forEachIndexed { k, (date, items) ->
            val isToday = date == today
            Row(
                Modifier.fillMaxWidth()
                    .drawBehind { if (k > 0) drawRect(face.line.mix(55.0, Color.Transparent), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.width(54.dp)) {
                    Text(date.dayOfWeek.getDisplayName(DateStyle.SHORT, Locale.US).uppercase(), style = mono.copy(fontSize = 10.sp, letterSpacing = 0.14.em, color = if (isToday) face.accent else face.faint))
                    Text(
                        date.dayOfMonth.toString(),
                        style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 22.sp,
                            color = if (isToday) face.accent else face.ink, shadow = if (isToday) haloText(face.accent) else null),
                    )
                }
                Column(Modifier.weight(1f).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    if (items.isEmpty()) Text("—", style = mono.copy(fontSize = 12.sp, color = face.ghost))
                    for (it in items.take(4)) {
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).clickable { openItem(it.id) }.defaultMinSize(minHeight = 28.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(it.scheduledTime?.take(5) ?: "", Modifier.width(48.dp), style = mono.copy(fontSize = 11.5.sp, color = face.faint, fontFeatureSettings = "tnum"), maxLines = 1)
                            Text(
                                it.title, Modifier.weight(1f),
                                style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, fontSize = 13.5.sp,
                                    color = if (it.completed) face.faint else face.ink, textDecoration = if (it.completed) TextDecoration.LineThrough else null),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    if (items.size > 4) Text("+${items.size - 4} more", style = mono.copy(fontSize = 10.5.sp, letterSpacing = 0.08.em, color = face.faint))
                }
            }
        }
    }
}

/** Focus: the one thing being worked on, suite-wide, lit while it is set; END FOCUS clears it. */
@Composable
fun FocusCard(focus: FocusSlice, onEnd: () -> Unit, openItem: (() -> Unit)?) {
    val face = Jk.face
    HudCard(lit = focus.active) {
        CardHead("Focus", "BeigeBoard")
        if (!focus.active) {
            Text("Nothing in focus", style = TextStyle(fontFamily = JkFonts.Serif, fontSize = 16.sp, color = face.faint))
            Text("FOCUS A TASK IN BEIGEBOARD TO SEE IT HERE", Modifier.padding(top = 6.dp), style = mono.copy(fontSize = 10.sp, letterSpacing = 0.08.em, color = face.ghost))
            return@HudCard
        }
        Text(
            focus.title,
            (if (openItem != null) Modifier.clickable(onClick = openItem) else Modifier).padding(vertical = 6.dp),
            style = TextStyle(
                fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 23.sp, lineHeight = 28.sp,
                color = face.ink.copy(alpha = if (focus.done) 0.7f else 1f), textDecoration = if (focus.done) TextDecoration.LineThrough else null,
            ),
        )
        Text(focus.meta, style = mono.copy(fontSize = 11.5.sp, letterSpacing = 0.06.em, color = face.faint))
        Spacer(Modifier.height(14.dp))
        Text(
            "END FOCUS",
            Modifier.clip(RoundedCornerShape(JkRadius.sm))
                .border(1.dp, face.accent.mix(40.0, Color.Transparent), RoundedCornerShape(JkRadius.sm))
                .clickable(role = Role.Button, onClick = onEnd)
                .defaultMinSize(minHeight = 40.dp)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            style = mono.copy(fontSize = 11.sp, letterSpacing = 0.1.em, color = face.accent),
        )
    }
}

/** Pinned: what the person pinned from any app, upgraded from the live row when it is BeigeBoard's. */
@Composable
fun PinnedCard(pins: List<PinRow>, reachable: Boolean, openItem: (PinRow) -> Unit) {
    HudCard {
        CardHead("Pinned", "BeigeBoard")
        when {
            pins.isEmpty() && !reachable -> CardNote("Nothing pinned.")
            pins.isEmpty() -> CardNote("Nothing pinned — pin a task in BeigeBoard.")
            else -> pins.forEachIndexed { k, p ->
                HudRow(p.title, lead = p.timeLabel, tone = p.tone, done = p.done, first = k == 0,
                    onClick = if (p.app == "beigeboard") ({ openItem(p) }) else null)
            }
        }
    }
}

/** Systems: how many apps answer, and each one's probe. */
@Composable
fun SystemsCard(s: SystemsState) {
    HudCard {
        CardHead("Systems")
        if (s.rows.isEmpty()) { CardNote("No probes."); return@HudCard }
        Meter("Up", s.summary, if (s.total == 0) 0f else s.up.toFloat() / s.total)
        s.rows.forEachIndexed { k, r -> HudRow(r.name, detail = r.detail, tone = r.tone, first = k == 0) }
    }
}

/** Alerts: one feed across the suite, most urgent first. */
@Composable
fun AlertsCard(alerts: List<Alert>) {
    val face = Jk.face
    HudCard {
        CardHead("Alerts", Alerts.summary(alerts))
        if (alerts.isEmpty()) { CardNote("All clear."); return@HudCard }
        alerts.forEachIndexed { k, a ->
            Row(
                Modifier.fillMaxWidth()
                    .drawBehind { if (k > 0) drawRect(face.line.mix(55.0, Color.Transparent), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
                    .padding(vertical = 9.dp),
                verticalAlignment = Alignment.Top,
            ) {
                AlertGlyph(a.icon, toneColor(a.tone), Modifier.padding(top = 2.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.text, style = TextStyle(fontFamily = JkFonts.Sans, fontWeight = FontWeight.Medium, fontSize = 14.5.sp, lineHeight = 19.sp, color = face.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(a.detail, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = face.muted), maxLines = 1)
                }
            }
        }
    }
}

/** The feed's two stroked icons, as the renderer's ICONS draws them: a warning triangle and a clock. */
@Composable
private fun AlertGlyph(name: String, tint: Color, modifier: Modifier = Modifier, size: Dp = 17.dp) {
    Canvas(modifier.size(size)) {
        val s = this.size.width / 24f
        val stroke = Stroke(width = 1.8f * s, cap = StrokeCap.Round)
        if (name == "clock") {
            drawCircle(tint, radius = 9f * s, style = stroke)
            drawLine(tint, Offset(12f * s, 7f * s), Offset(12f * s, 12f * s), 1.8f * s, StrokeCap.Round)
            drawLine(tint, Offset(12f * s, 12f * s), Offset(15f * s, 14f * s), 1.8f * s, StrokeCap.Round)
        } else {
            drawPath(Path().apply { moveTo(12f * s, 3f * s); lineTo(22f * s, 20f * s); lineTo(2f * s, 20f * s); close() }, tint, style = stroke)
            drawLine(tint, Offset(12f * s, 9.5f * s), Offset(12f * s, 13.5f * s), 1.8f * s, StrokeCap.Round)
            drawCircle(tint, radius = 1.1f * s, center = Offset(12f * s, 16.8f * s))
        }
    }
}

/** A row of mono caps for the strips above and below the cards. */
@Composable
fun StripText(text: String, color: Color = Jk.face.faint, size: TextUnit = 10.sp, modifier: Modifier = Modifier) =
    Text(text.uppercase(), modifier, style = mono.copy(fontSize = size, letterSpacing = 0.14.em, color = color), maxLines = 1, overflow = TextOverflow.Ellipsis)

/** Weight-1 spacer for a strip row. */
@Composable
fun RowScope.Push() = Spacer(Modifier.weight(1f))
