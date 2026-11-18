package net.jkos.app.alpha.ordeck

import net.jkos.app.alpha.auth.HudRef
import net.jkos.app.alpha.beigeboard.Item
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.util.Locale

// What the HUD's cards read: ORDECK's slices (apps/ordeck/src/pages/hud/useHudData.ts), over
// the same BeigeBoard items, shelf and probes the web reads. Pure, no Android import: the JVM
// test holds each one to the web's sample (apps/ordeck/src/hud/sample.ts).

private fun pad(n: Int) = n.toString().padStart(2, '0')

/** clockState: the time, ticking. */
data class ClockFace(val hm: String, val ss: String, val dateLine: String, val utcLine: String, val iso: String) {
    companion object {
        fun of(now: ZonedDateTime): ClockFace {
            val utc = now.withZoneSameInstant(ZoneOffset.UTC)
            val wd = now.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, Locale.US).uppercase()
            val mo = now.month.getDisplayName(java.time.format.TextStyle.SHORT, Locale.US).uppercase()
            return ClockFace(
                hm = "${pad(now.hour)}:${pad(now.minute)}",
                ss = pad(now.second),
                dateLine = "$wd · $mo ${pad(now.dayOfMonth)}",
                utcLine = "UTC ${pad(utc.hour)}:${pad(utc.minute)} · DAY ${now.dayOfYear.toString().padStart(3, '0')}",
                iso = now.toLocalDate().toString(),
            )
        }
    }
}

/** A BeigeBoard time as the HUD prints it: "09:30" (the wire may carry seconds). */
private fun hhmm(v: String?): String? = v?.takeIf { it.isNotBlank() }?.take(5)

/** One of today's items on the Today card (TodayTask). */
data class DayTask(
    val id: Long, val time: String?, val endTime: String?, val title: String, val tag: String, val done: Boolean, val now: Boolean,
) {
    val timeLabel: String get() = time ?: "—"
    val tone: Tone get() = if (done) Tone.Ok else if (now) Tone.Accent else Tone.Muted
    /** A task can be ticked off; an event happens (BeigeBoard draws it without a check). */
    val checkable: Boolean get() = tag != "event"
}

/** selectToday + viewToday. [reachable] is false when this person can't open BeigeBoard at all. */
data class DaySlice(val reachable: Boolean, val loaded: Boolean, val offline: Boolean, val tasks: List<DayTask>) {
    val doneCount: Int get() = tasks.count { it.done }
    val progressLabel: String get() = "$doneCount / ${tasks.size}"
    val progress: Float get() = if (tasks.isEmpty()) 0f else doneCount.toFloat() / tasks.size
    val canAdd: Boolean get() = reachable && loaded && !offline

    companion object {
        /** Anything due today or ending today, by time (untimed last), as the web's selectToday. */
        fun of(items: List<Item>, today: String, hm: String, reachable: Boolean = true, loaded: Boolean = true, offline: Boolean = false): DaySlice {
            val tasks = items.filter { it.dueDate == today || it.endDate == today }
                .map { DayTask(it.id, hhmm(it.scheduledTime), hhmm(it.scheduledEnd), it.title, it.kind, it.completed, false) }
                .sortedBy { it.time ?: "99" }
                .map { it.copy(now = isNow(it.time, it.endTime, it.done, hm)) }
            return DaySlice(reachable, loaded, offline, tasks)
        }

        /** In [start, end), wrapping past midnight when end <= start. */
        private fun inWindow(hm: String, start: String, end: String) = when {
            end == start -> false
            end < start -> hm >= start || hm < end
            else -> hm >= start && hm < end
        }

        /** Now if the time is inside its window, or within an hour of its start when it has no end. */
        fun isNow(time: String?, endTime: String?, done: Boolean, hm: String): Boolean {
            if (time == null || done) return false
            if (endTime != null) return inWindow(hm, time, endTime)
            val (h, m) = time.split(':').map { it.toIntOrNull() ?: 0 }
            val endMin = h * 60 + m + 60
            return inWindow(hm, time, "${pad((endMin / 60) % 24)}:${pad(endMin % 60)}")
        }
    }
}

/** selectMonth: how many items fall on each day of this month, and how many of them are done. */
data class MonthSlice(val year: Int, val month: Int, val days: Map<String, Pair<Int, Int>>) {
    /** A Sunday-first grid, as the web's calendar card draws it: nulls before the 1st, then each day. */
    val cells: List<LocalDate?> get() {
        val first = LocalDate.of(year, month, 1)
        val lead = first.dayOfWeek.value % 7
        val all = List<LocalDate?>(lead) { null } + (0 until first.lengthOfMonth()).map { first.plusDays(it.toLong()) }
        return all + List((7 - all.size % 7) % 7) { null }
    }

    companion object {
        fun of(items: List<Item>, today: LocalDate): MonthSlice {
            val prefix = "%04d-%02d-".format(today.year, today.monthValue)
            val days = items.filter { it.dueDate?.startsWith(prefix) == true }.groupBy { it.dueDate!! }
                .mapValues { (_, xs) -> xs.size to xs.count { it.completed } }
            return MonthSlice(today.year, today.monthValue, days)
        }
    }
}

/** selectFocus: the one item in focus across the suite, upgraded from the live row when it is BeigeBoard's. */
data class FocusSlice(val active: Boolean, val app: String = "", val id: String? = null, val title: String = "",
                      val timeLabel: String = "—", val tag: String = "", val done: Boolean = false) {
    val meta: String get() = "${if (done) "DONE" else "NOW"} · $timeLabel" + if (tag.isNotEmpty()) " · ${tag.uppercase()}" else ""

    companion object {
        fun of(focus: HudRef?, items: List<Item>): FocusSlice {
            focus ?: return FocusSlice(active = false)
            val live = live(focus.app, focus.id, items)
            return FocusSlice(true, focus.app, focus.id, live?.title ?: focus.label, hhmm(live?.scheduledTime) ?: "—", live?.kind ?: "", live?.completed ?: false)
        }
    }
}

/** One pin on the Pinned card (PinnedTask). */
data class PinRow(val app: String, val id: String, val title: String, val timeLabel: String, val done: Boolean, val tone: Tone)

/** selectPinned. */
object Pinned {
    fun of(pins: List<HudRef>, items: List<Item>): List<PinRow> = pins.map { p ->
        val live = live(p.app, p.id, items)
        val done = live?.completed ?: false
        PinRow(p.app, p.id, live?.title ?: p.label, hhmm(live?.scheduledTime) ?: "—", done,
            if (done) Tone.Ok else toneOf(p.tone) ?: Tone.Accent)
    }

    private fun toneOf(s: String?): Tone? = Tone.entries.firstOrNull { it.name.equals(s, ignoreCase = true) }
}

/** A reference into BeigeBoard is upgraded from its live row ({app}:{id}, the weave ext_ref); any other app's is its snapshot. */
private fun live(app: String, id: String, items: List<Item>): Item? =
    if (app == "beigeboard") items.firstOrNull { it.id.toString() == id } else null

/** One alert on the Alerts card. [icon] is "alert" or "clock". */
data class Alert(val id: String, val icon: String, val tone: Tone, val text: String, val detail: String)

/** deriveNotifications: one feed over the slices already held — systems, then today — most urgent first. */
object Alerts {
    fun of(today: DaySlice, systems: SystemsState, hm: String): List<Alert> {
        val sys = systems.rows.mapNotNull { r ->
            when (r.status) {
                SysStatus.Down -> Alert("sys-${r.name}", "alert", Tone.Danger, "${r.name.uppercase()} DOWN", "system offline")
                SysStatus.Warn -> Alert("sys-${r.name}", "alert", Tone.Warn, r.name.uppercase(), r.detail)
                else -> null
            }
        }
        val day = if (!today.reachable || today.offline) emptyList() else today.tasks.mapNotNull { t ->
            when {
                t.now -> Alert("now-${t.id}", "clock", Tone.Accent, t.title, "happening now")
                t.time != null && !t.done && t.time < hm -> Alert("od-${t.id}", "alert", Tone.Warn, t.title, "overdue · ${t.timeLabel}")
                else -> null
            }
        }
        return (sys + day).sortedBy { it.tone.ordinal }
    }

    fun summary(alerts: List<Alert>): String =
        if (alerts.isEmpty()) "ALL CLEAR" else "${alerts.size} ALERT${if (alerts.size > 1) "S" else ""}"
}

/** The LazurOS kill switch (`preferences.lazuros.enabled`, on unless the person turned it off). */
object AiSwitch {
    fun enabled(preferences: org.json.JSONObject?): Boolean {
        val l = preferences?.optJSONObject("lazuros") ?: return true
        if (!l.has("enabled")) return true
        return when (val v = l.opt("enabled")) {
            null, org.json.JSONObject.NULL, false -> false
            is Number -> v.toDouble() != 0.0
            is String -> v.isNotEmpty()
            else -> true
        }
    }
}
