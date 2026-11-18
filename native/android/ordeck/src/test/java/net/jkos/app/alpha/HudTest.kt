package net.jkos.app.alpha

import net.jkos.app.alpha.ordeck.HudOrder
import net.jkos.app.alpha.ordeck.SysRow
import net.jkos.app.alpha.ordeck.SysStatus
import net.jkos.app.alpha.ordeck.Systems
import net.jkos.app.alpha.ordeck.SystemsState
import net.jkos.app.alpha.ordeck.Tone
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The HUD's order on the phone, held to the web's loadHudState + layoutForBreakpoint by the shared vectors. */
class HudOrderTest {
    private val doc = JSONObject(File(System.getProperty("jkos.hudOrderCases") ?: error("jkos.hudOrderCases not set")).readText())

    @Test fun everyCaseIsTheWebsOrder() {
        val cases = doc.getJSONArray("cases")
        assertTrue(cases.length() >= 12)
        for (k in 0 until cases.length()) {
            val c = cases.getJSONObject(k)
            val prefs = if (c.isNull("preferences")) null else c.getJSONObject("preferences")
            val want = c.getJSONArray("expect").let { a -> (0 until a.length()).map { a.getString(it) } }
            assertEquals(c.getString("name"), want, HudOrder.order(prefs))
        }
    }

    @Test fun compactionPacksUpwardAndNeverSideways() {
        val out = HudOrder.compactVertical(listOf(HudOrder.Cell("a", 1, 9, 1, 2), HudOrder.Cell("b", 0, 4, 2, 1)), 2)
        assertEquals(listOf(HudOrder.Cell("b", 0, 0, 2, 1), HudOrder.Cell("a", 1, 1, 1, 2)), out)
    }
}

/** ORDECK's home, the pure half: what the HUD's cards read, as the web's useHudData.ts reads it. */
class SystemsTest {
    @Test fun aHealthBodySaysWhetherTheAppIsDegraded() {
        assertNull(Systems.degradedReason("""{"status":"ok","service":"beigeboard"}"""))
        assertEquals("cache cold", Systems.degradedReason("""{"status":"ok","degraded":"cache cold"}"""))
        assertEquals("degraded", Systems.degradedReason("""{"status":"ok","degraded":true}"""))
        assertNull(Systems.degradedReason("""{"status":"ok","degraded":""}"""))
        assertEquals("gpu asleep", Systems.degradedReason("""{"status":"ok","compute_online":false}"""))
        assertNull(Systems.degradedReason("""{"compute_online":true}"""))
        // Non-JSON health is fine (the web's probe swallows the parse), and so is none.
        assertNull(Systems.degradedReason("OK"))
        assertNull(Systems.degradedReason(null))
    }

    @Test fun aProbeIsARow() {
        assertEquals(SysRow("auth", SysStatus.Up, "12 ms"), Systems.row("auth", true, 12, "{}"))
        assertEquals(SysRow("auth", SysStatus.Up, "1 ms"), Systems.row("auth", true, 0, null))
        assertEquals(SysRow("lazuros", SysStatus.Warn, "gpu asleep"), Systems.row("lazuros", true, 40, """{"compute_online":false}"""))
        // Refused (the gate's 302 included) is down, whatever the body says.
        assertEquals(SysRow("kouros", SysStatus.Down, "down"), Systems.row("kouros", false, 3, """{"degraded":"x"}"""))
    }

    @Test fun theHeadCountsWarnAsUp() {
        val s = SystemsState(listOf(
            Systems.row("auth", true, 12, null), Systems.row("beigeboard", false, 0, null),
            Systems.row("lazuros", true, 30, """{"compute_online":false}"""), Systems.row("kouros", true, 24, null),
        ))
        assertEquals(3, s.up)
        assertEquals(4, s.total)
        assertEquals("3 / 4 UP", s.summary)
        assertEquals(listOf(Tone.Ok, Tone.Danger, Tone.Warn, Tone.Ok), s.rows.map { it.tone })
        assertEquals("0 / 2 UP", Systems.probing(listOf("auth", "kouros")).summary)
    }

    @Test fun tonesRankAsTheRenderersToneRank() {
        // @jkos/widget-render's TONE_RANK: danger 0, warn 1, accent 2, ok 3, muted 4.
        assertEquals(listOf(Tone.Danger, Tone.Warn, Tone.Accent, Tone.Ok, Tone.Muted), Tone.entries.sortedBy { it.ordinal })
    }
}

/**
 * The slices the cards read, over the web's own preview sample (apps/ordeck/src/hud/sample.ts):
 * the same items, focus, pins and probes at the same pinned instant, so each expectation is what
 * `pnpm widget shot <card>` draws for the web.
 */
class SlicesTest {
    private val now = java.time.ZonedDateTime.of(2026, 9, 28, 9, 41, 27, 0, java.time.ZoneId.of("America/Chicago"))
    private val day0 = now.toLocalDate()
    private fun sd(n: Long) = day0.plusDays(n).toString()
    private fun item(id: Long, title: String, due: String?, time: String?, end: String?, done: Boolean = false, kind: String = "task") =
        net.jkos.app.alpha.beigeboard.Items.item(JSONObject().apply {
            put("id", id); put("title", title); put("kind", kind); put("completed", if (done) 1 else 0)
            put("due_date", due ?: JSONObject.NULL); put("scheduled_time", time ?: JSONObject.NULL); put("scheduled_end", end ?: JSONObject.NULL)
        })
    private val items = listOf(
        item(1, "Standup with the platform team", sd(0), "09:00", "09:15", true, "event"),
        item(2, "Review the access-control matrix", sd(0), "09:30:00", "10:30"),
        item(3, "Reconcile the Q3 change log", sd(0), "11:00", null),
        item(4, "Lunch", sd(0), "12:30", "13:15", false, "event"),
        item(5, "Write up the segregation-of-duties finding", sd(0), "14:00", "15:30"),
        item(6, "Walk", sd(0), "17:30", null, false, "habit"),
        item(7, "Rotate the service-client secrets", sd(-2), null, null),
        item(8, "Draft the audit scoping memo", sd(1), "10:00", "11:00"),
        item(9, "Evidence request: user provisioning", sd(3), null, null),
        item(10, "Quarterly access review", sd(7), "09:00", "12:00", false, "event"),
        item(11, "File the expense report", sd(-5), null, null, true),
    )

    @Test fun theClockReadsAsTheWebsSheet() {
        val c = net.jkos.app.alpha.ordeck.ClockFace.of(now)
        assertEquals(listOf("09:41", "27", "MONDAY · SEP 28", "UTC 14:41 · DAY 271", "2026-09-28"), listOf(c.hm, c.ss, c.dateLine, c.utcLine, c.iso))
    }

    @Test fun todayIsTheDaysItemsInTimeOrderWithWhatIsHappeningNow() {
        val d = net.jkos.app.alpha.ordeck.DaySlice.of(items, sd(0), "09:41")
        assertEquals(listOf(1L, 2, 3, 4, 5, 6), d.tasks.map { it.id })
        assertEquals("09:30", d.tasks[1].time)   // the wire's seconds are cut, as the web's hhmm
        assertEquals(listOf(Tone.Ok, Tone.Accent, Tone.Muted, Tone.Muted, Tone.Muted, Tone.Muted), d.tasks.map { it.tone })
        assertEquals("1 / 6", d.progressLabel)
        assertEquals(listOf(false, true, true, false, true, true), d.tasks.map { it.checkable })
        assertTrue(d.canAdd)
        assertEquals(false, net.jkos.app.alpha.ordeck.DaySlice.of(items, sd(0), "09:41", reachable = false).canAdd)
    }

    @Test fun nowIsTheWindowOrAnHourFromTheStart() {
        val isNow = net.jkos.app.alpha.ordeck.DaySlice.Companion::isNow
        assertTrue(isNow("11:00", null, false, "11:59"))
        assertEquals(false, isNow("11:00", null, false, "12:00"))
        assertTrue(isNow("23:30", null, false, "00:10"))           // the hour wraps past midnight
        assertEquals(false, isNow("09:00", "09:00", false, "09:00")) // an empty window is never now
        assertEquals(false, isNow("09:00", "10:00", true, "09:30"))  // done is not now
        assertEquals(false, isNow(null, null, false, "09:30"))
    }

    @Test fun theMonthCountsEachDaysItemsOnASundayFirstGrid() {
        val m = net.jkos.app.alpha.ordeck.MonthSlice.of(items, day0)
        assertEquals(mapOf(sd(0) to (6 to 1), sd(-2) to (1 to 0), sd(1) to (1 to 0), sd(-5) to (1 to 1)), m.days)
        // September 2026 opens on a Tuesday: two blanks, thirty days, three more to close the week.
        assertEquals(35, m.cells.size)
        assertEquals(listOf(null, null), m.cells.take(2))
        assertEquals(java.time.LocalDate.of(2026, 9, 1), m.cells[2])
    }

    @Test fun focusAndPinsAreUpgradedFromTheLiveRows() {
        val f = net.jkos.app.alpha.ordeck.FocusSlice.of(net.jkos.app.alpha.auth.HudRef("beigeboard", "2", "old label", "/"), items)
        assertEquals("Review the access-control matrix", f.title)
        assertEquals("NOW · 09:30 · TASK", f.meta)
        val other = net.jkos.app.alpha.ordeck.FocusSlice.of(net.jkos.app.alpha.auth.HudRef("kouros", "2", "A snapshot"), items)
        assertEquals("A snapshot", other.title)
        assertEquals("NOW · —", other.meta)
        assertEquals(false, net.jkos.app.alpha.ordeck.FocusSlice.of(null, items).active)

        val pins = net.jkos.app.alpha.ordeck.Pinned.of(listOf("3", "5", "8", "11").map { net.jkos.app.alpha.auth.HudRef("beigeboard", it, "label $it") }, items)
        assertEquals(listOf("11:00", "14:00", "10:00", "—"), pins.map { it.timeLabel })
        assertEquals(listOf(Tone.Accent, Tone.Accent, Tone.Accent, Tone.Ok), pins.map { it.tone })
    }

    @Test fun alertsAreTheSystemsThenTheDayMostUrgentFirst() {
        val sys = SystemsState(listOf(Systems.row("auth", true, 12, null), Systems.row("beigeboard", true, 18, null),
            Systems.row("kouros", true, 24, null), Systems.row("lazuros", true, 30, """{"compute_online":false}""")))
        val a = net.jkos.app.alpha.ordeck.Alerts.of(net.jkos.app.alpha.ordeck.DaySlice.of(items, sd(0), "09:41"), sys, "09:41")
        assertEquals(listOf("LAZUROS" to "gpu asleep", "Review the access-control matrix" to "happening now"), a.map { it.text to it.detail })
        assertEquals("2 ALERTS", net.jkos.app.alpha.ordeck.Alerts.summary(a))
        // After lunch: the 11:00 is past its hour and not done, so it is overdue; a down app outranks it.
        val later = net.jkos.app.alpha.ordeck.Alerts.of(net.jkos.app.alpha.ordeck.DaySlice.of(items, sd(0), "12:10"),
            SystemsState(listOf(Systems.row("kouros", false, 0, null))), "12:10")
        assertEquals(listOf("KOUROS DOWN", "Review the access-control matrix", "Reconcile the Q3 change log"), later.map { it.text })
        assertEquals(listOf(Tone.Danger, Tone.Warn, Tone.Warn), later.map { it.tone })
        assertEquals("ALL CLEAR", net.jkos.app.alpha.ordeck.Alerts.summary(emptyList()))
    }

    @Test fun theAiSwitchIsOnUnlessTurnedOff() {
        assertTrue(net.jkos.app.alpha.ordeck.AiSwitch.enabled(null))
        assertTrue(net.jkos.app.alpha.ordeck.AiSwitch.enabled(JSONObject("""{"lazuros":{}}""")))
        assertEquals(false, net.jkos.app.alpha.ordeck.AiSwitch.enabled(JSONObject("""{"lazuros":{"enabled":false}}""")))
        assertTrue(net.jkos.app.alpha.ordeck.AiSwitch.enabled(JSONObject("""{"lazuros":{"enabled":true}}""")))
    }
}

/** A routine's week strip and streak, and the calendar's colours, as the web's lib/routines.ts and theme.ts derive them. */
class CadenceTest {
    private fun item(id: Long, kind: String = "task", due: String? = null, done: Boolean = false, parent: Long? = null, extRef: String? = null,
                     cadence: String? = null, count: Int? = null, skips: String? = null, time: String? = null, accent: String? = null, source: String? = null) =
        net.jkos.app.alpha.beigeboard.Items.item(JSONObject().apply {
            put("id", id); put("kind", kind); put("title", "t$id"); put("completed", if (done) 1 else 0)
            put("due_date", due ?: JSONObject.NULL); put("parent_id", parent ?: JSONObject.NULL); put("ext_ref", extRef ?: JSONObject.NULL)
            put("cadence_days", cadence ?: JSONObject.NULL); put("cadence_count", count ?: JSONObject.NULL); put("cadence_skips", skips ?: JSONObject.NULL)
            put("scheduled_time", time ?: JSONObject.NULL); put("accent", accent ?: JSONObject.NULL); put("source", source ?: JSONObject.NULL)
        })
    private val C = net.jkos.app.alpha.beigeboard.Cadence
    private fun occ(id: Long, date: String, done: Boolean = false) = item(id, due = date, done = done, parent = 1, extRef = "routine:1:$date")

    @Test fun theCommittedDaysAndTheTarget() {
        assertEquals(listOf(0, 3), C.days(item(1, "routine", cadence = "3, 0,9,x,3")))
        assertEquals(2, C.weeklyTarget(item(1, "routine", cadence = "0,3")))
        assertEquals(4, C.weeklyTarget(item(1, "routine", cadence = "0,3", count = 4)))
        assertEquals("3×/WK · 18:00", C.line(item(1, "routine", cadence = "0,2,4", time = "18:00:00")))
        assertEquals("", C.line(item(1, "routine")))
    }

    @Test fun eachDayOfTheWeekIsWhatItHolds() {
        val r = item(1, "routine", cadence = "0,2,4", skips = "2026-11-20")
        val items = listOf(
            r, occ(10, "2026-11-16", done = true), occ(11, "2026-11-18"), occ(12, "2026-11-21"),
            // Filed under the routine by hand (no routine: ext_ref): not an occurrence, never counted.
            item(13, due = "2026-11-19", parent = 1, done = true),
        )
        val states = C.week(r, items, "2026-11-16", "2026-11-18").map { it.state }
        assertEquals(listOf(net.jkos.app.alpha.beigeboard.CellState.Done, net.jkos.app.alpha.beigeboard.CellState.Off, net.jkos.app.alpha.beigeboard.CellState.Open,
            net.jkos.app.alpha.beigeboard.CellState.Off, net.jkos.app.alpha.beigeboard.CellState.Skipped, net.jkos.app.alpha.beigeboard.CellState.Planned,
            net.jkos.app.alpha.beigeboard.CellState.Off), states)
        val missed = C.week(r, listOf(r, occ(10, "2026-11-16")), "2026-11-16", "2026-11-18").first().state
        assertEquals(net.jkos.app.alpha.beigeboard.CellState.Missed, missed)
        // A committed weekday with nothing minted is idle, not off.
        assertEquals(net.jkos.app.alpha.beigeboard.CellState.Idle, C.week(r, listOf(r), "2026-11-16", "2026-11-18")[2].state)
    }

    @Test fun theStreakCountsBackAndTodayNeitherBreaksNorCounts() {
        val r = item(1, "routine", cadence = "0,2,4")
        val kept = listOf(r, occ(10, "2026-11-11", true), occ(11, "2026-11-13", true), occ(12, "2026-11-16", true))
        assertEquals(3, C.streak(r, kept + occ(13, "2026-11-18"), "2026-11-18"))
        assertEquals(4, C.streak(r, kept + occ(13, "2026-11-18", true), "2026-11-18"))
        assertEquals(0, C.streak(r, listOf(r, occ(10, "2026-11-13", true), occ(11, "2026-11-16")), "2026-11-18"))
        // A future occurrence doesn't count, done or not.
        assertEquals(3, C.streak(r, kept + occ(14, "2026-11-20", true), "2026-11-18"))
    }

    @Test fun anAgendaRowTakesItsOwnColourItsSourcesOrItsGoals() {
        val goal = item(50, "goal", accent = "#C0392B")
        val byId = mapOf(50L to goal)
        assertEquals(0xFF112233, net.jkos.app.alpha.beigeboard.agendaTint(item(1, "event", accent = "#112233", source = "google"), byId))
        assertEquals(0xFF3A7BD5, net.jkos.app.alpha.beigeboard.agendaTint(item(2, "event", source = "google"), byId))
        assertNull(net.jkos.app.alpha.beigeboard.agendaTint(item(3, "event", source = "somewhere"), byId))
        assertEquals(0xFFC0392B, net.jkos.app.alpha.beigeboard.agendaTint(item(4, parent = 50), byId))
        assertNull(net.jkos.app.alpha.beigeboard.agendaTint(item(5), byId))
    }
}
