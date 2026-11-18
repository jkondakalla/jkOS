package net.jkos.app.alpha.screens

import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.test.core.app.ActivityScenario
import com.github.takahirom.roborazzi.RoborazziActivity
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.github.takahirom.roborazzi.registerRoborazziActivityToRobolectricIfNeeded
import net.jkos.app.alpha.JkosTheme
import androidx.compose.runtime.CompositionLocalProvider
import net.jkos.app.alpha.look.Ground
import net.jkos.app.alpha.look.LocalStill
import net.jkos.app.alpha.Nav
import net.jkos.app.alpha.Screen
import net.jkos.app.alpha.auth.HudRef
import net.jkos.app.alpha.auth.Shelf
import net.jkos.app.alpha.auth.Look
import net.jkos.app.alpha.auth.ThemeMode
import net.jkos.app.alpha.beigeboard.*
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.LocalDate

/**
 * Renders of BeigeBoard's screens, drawn by the real Compose code on Robolectric with a sample
 * board, so they can be looked at before the app runs on a device. Not a gate: run with
 *   pnpm android:build -- :ordeck:testDebugUnitTest -Pjkos.screens
 * and the PNGs land in native/android/ordeck/build/screens/. Nothing here calls the network:
 * every screen is handed its data.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreensTest {
    private val dir = System.getProperty("jkos.screensDir") ?: "build/screens"
    private fun out(name: String) = File(dir, "$name.png").path

    private val today = LocalDate.now()
    private fun d(days: Long) = today.plusDays(days).toString()

    private var nextId = 100L
    private fun item(
        title: String, kind: String = "task", due: String? = null, time: String? = null, end: String? = null,
        parent: Long? = null, done: Boolean = false, accent: String? = null, id: Long = nextId++, extRef: String? = null,
        endTime: String? = null, location: String? = null, notes: String? = null,
    ) = Items.item(JSONObject().apply {
        put("id", id); put("kind", kind); put("title", title); put("completed", if (done) 1 else 0)
        put("due_date", due ?: JSONObject.NULL); put("scheduled_time", time ?: JSONObject.NULL); put("end_date", end ?: JSONObject.NULL)
        put("scheduled_end", endTime ?: JSONObject.NULL); put("parent_id", parent ?: JSONObject.NULL); put("accent", accent ?: JSONObject.NULL)
        put("ext_ref", extRef ?: JSONObject.NULL); put("location", location ?: JSONObject.NULL); put("notes", notes ?: JSONObject.NULL)
    })

    private val items: List<Item> = listOf(
        item("Run a half marathon", kind = "goal", id = 1, accent = "#C0392B"),
        item("Base building", kind = "milestone", parent = 1, id = 2),
        item("Easy 5 km", parent = 2, due = d(0), time = "07:00", id = 3),
        item("Buy trail shoes", parent = 2, due = d(-2), id = 4),
        item("Long run, 12 km", parent = 2, due = d(3), done = false, id = 5),
        item("Tempo intervals", parent = 2, due = d(-5), done = true, id = 6),
        item("Race week", kind = "milestone", parent = 1, id = 7),
        item("Pick up race bib", parent = 7, due = d(20), id = 8),
        item("Ship the jkOS alpha", kind = "goal", id = 10, accent = "#2E7D5B"),
        item("BeigeBoard on the phone", kind = "milestone", parent = 10, id = 11),
        item("Run the H1 device checks", parent = 11, due = d(0), time = "10:30", id = 12),
        item("Review verification-metadata.xml", parent = 11, due = d(0), id = 13),
        item("Deploy staging", parent = 11, due = d(0), done = true, id = 14),
        item("Write the release notes", parent = 10, due = d(1), id = 15),
        item("Call the bank", due = d(0), time = "15:00", id = 20),
        item("Dentist", kind = "event", due = d(0), time = "16:30", endTime = "17:15", location = "Main St Dental", id = 21),
        item("Team offsite", kind = "event", due = d(-1), end = d(1), time = "09:00", id = 22),
        item("Renew passport", due = d(-9), id = 23),
        item("Lower Body", kind = "routine", id = 30),
        item("Lower Body", parent = 30, due = d(0), time = "18:00", extRef = "routine:30:${d(0)}", id = 31),
        item("Lower Body", parent = 30, due = d(3), time = "18:00", extRef = "routine:30:${d(3)}", id = 32),
        item("Lower Body", parent = 30, due = d(7), time = "18:00", extRef = "routine:30:${d(7)}", id = 33),
        item("Grocery run", due = d(2), id = 40),
        item("Book club", kind = "event", due = d(4), time = "19:00", id = 41),
    )

    private val shelf = Shelf(listOf(HudRef("beigeboard", "12", "Run the H1 device checks")), HudRef("beigeboard", "3", "Easy 5 km"))

    @Composable
    private fun Face(dark: Boolean = false, content: @Composable () -> Unit) {
        JkosTheme(Look(mode = if (dark) ThemeMode.Dark else ThemeMode.Light)) {
            CompositionLocalProvider(LocalStill provides true) { Ground(Modifier.fillMaxSize()) { content() } }
        }
    }

    @Composable
    private fun rememberBoard(section: BoardSection = BoardSection.Today): Board {
        val scope = rememberCoroutineScope()
        return remember { Board(scope).also { it.preload(items, shelf); it.section = section } }
    }

    private fun nav(screen: Screen) = Nav(mutableStateListOf(screen))

    private fun board(name: String, section: BoardSection, dark: Boolean = false) = captureRoboImage(out(name)) {
        Face(dark) { val b = rememberBoard(section); BoardScreen(BeigeBoardRoot, b, nav(BeigeBoardRoot)) }
    }

    // The long screens are drawn on a taller page so all of them shows.
    @Test @Config(qualifiers = "w411dp-h1500dp-xxhdpi") fun today() = board("01-today", BoardSection.Today)
    @Test @Config(qualifiers = "w411dp-h1500dp-xxhdpi") fun todayDark() = board("02-today-dark", BoardSection.Today, dark = true)
    @Test fun goals() = board("03-goals", BoardSection.Goals)

    @Test fun goal() = captureRoboImage(out("04-goal")) {
        Face { val b = rememberBoard(); val page = BeigeBoardScreen.GoalPage(1); BoardScreen(page, b, nav(page)) }
    }

    @Test fun calendarWeek() = board("05-calendar-week", BoardSection.Calendar)

    @Test fun calendarMonth() = captureRoboImage(out("06-calendar-month")) {
        Face { val b = rememberBoard(BoardSection.Calendar); CalendarPane(b, {}, startOnMonth = true) }
    }

    /** A dialog is its own window, so this one is captured as the whole screen. */
    @Test fun itemSheet() {
        registerRoborazziActivityToRobolectricIfNeeded()
        ActivityScenario.launch(RoborazziActivity::class.java).use { s ->
            s.onActivity { a ->
                a.setContent {
                    Face {
                        val b = rememberBoard()
                        TodayScreen(b) {}
                        ItemSheet(b.byId.getValue(12), b, {}, preDeps = Deps(true, listOf(b.byId.getValue(13)), listOf(b.byId.getValue(15)))) {}
                    }
                }
            }
            captureScreenRoboImage(out("07-item-sheet"))
        }
    }

    private val routine = Routine(items.first { it.id == 30L }, "Mon, Thu at 6:00 PM · 3 steps · double progression on the squat")
    private val sessions = (2..7).map { c ->
        Session(c, if (c < 6) "build" else "peak", c == 5, null, listOf(
            RxStep("squat", "Back Squat", "3 × ${5 + (c % 3)} @ ${185 + 10 * (c / 3)} lb"),
            RxStep("rdl", "Romanian Deadlift", "3 × 8 @ ${135 + 5 * c} lb"),
            RxStep("plank", "Plank", "3 × ${40 + 5 * c} sec"),
        ))
    }
    private val series = listOf(
        StepSeries("squat", "Back Squat", (0..7).map { c -> Point(c, d(-7L * (8 - c)), true, c == 5, 5.0 + c % 3, (5.0 + c % 3) - if (c == 4) 2 else 0, c != 4) }),
        StepSeries("rdl", "Romanian Deadlift", (0..7).map { c -> Point(c, d(-7L * (8 - c)), true, false, 8.0, 8.0, true) }),
    )
    private val view = RoutineView(
        RoutineDoc(routine.item, JSONObject("""{"slug":"lower-body","title":"Lower Body"}"""), listOf(Warning("steps[2]", "NO_PROGRESSION", "Plank never gets harder: give it a progression or a ladder"))),
        Metric("volume", "reps", "Squat reps this month", 300.0, 186.0, 62),
        sessions,
        listOf(Revision(3, true, "3 steps · double progression", "Heavier squats", d(-3)), Revision(2, false, "3 steps", null, d(-30)), Revision(1, false, "2 steps", "First version", d(-60))),
    )

    @Test fun routines() = captureRoboImage(out("08-routines")) {
        Face {
            val b = rememberBoard(BoardSection.Routines)
            RoutinesPane(b, {}, routines = listOf(routine, Routine(item("Morning Mobility", kind = "routine"), "Daily at 7:00 AM · 6 steps"), Routine(item("Piano Practice", kind = "routine"), "Tue, Sat · scales, then a piece")))
        }
    }

    @Test @Config(qualifiers = "w411dp-h2300dp-xxhdpi") fun routine() = captureRoboImage(out("09-routine")) {
        Face { val b = rememberBoard(); RoutineScreen(30, b, {}, {}, preloaded = view, preSeries = series) }
    }

    @Test fun goalDark() = captureRoboImage(out("12-goal-dark")) {
        Face(dark = true) { val b = rememberBoard(); val page = BeigeBoardScreen.GoalPage(1); BoardScreen(page, b, nav(page)) }
    }

    @Test fun document() = captureRoboImage(out("10-routine-import")) {
        Face {
            val b = rememberBoard()
            DocumentScreen(30, b, {}, preText = """{
  "slug": "lower-body",
  "title": "Lower Body",
  "days": ["mon", "thu"],
  "time": "18:00",
  "spec": { "steps": [ { "ref": "back-squat", "progression": { "type": "double", "range": [5, 8], "increment": 10 } } ] }
}""", preReport = ImportReport(true, listOf("Would update “lower-body”"), "Mon, Thu at 6:00 PM · 1 step", listOf(Warning(null, "FEW_STEPS", "One step: is that the whole session?")), sessions.take(2)))
        }
    }

    @Test fun library() = captureRoboImage(out("11-library")) {
        Face {
            val b = rememberBoard()
            RoutinesPane(b, {}, entries = listOf(
                LibraryEntry(1, "exercise", "back-squat", "Back Squat", null, "reps", "lb", listOf("legs"), emptyList(), "starter"),
                LibraryEntry(2, "exercise", "push-up", "Push-up", null, "reps", "bw", listOf("push"), listOf("Incline", "Knee", "Full", "Diamond"), "starter"),
                LibraryEntry(3, "exercise", "nordic-curl", "Nordic Curl", null, "reps", "bw", emptyList(), listOf("Band-Assisted", "Eccentric-Only", "Full"), "you"),
                LibraryEntry(4, "recipe", "overnight-oats", "Overnight Oats", null, "g", null, listOf("breakfast"), emptyList(), "you"),
                LibraryEntry(5, "practice", "c-major-scale", "C Major Scale", null, "min", null, emptyList(), emptyList(), "you"),
            ), startOnLibrary = true)
        }
    }
}
