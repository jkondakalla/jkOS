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
import net.jkos.app.alpha.kouros.Album
import net.jkos.app.alpha.kouros.LibraryScreen
import net.jkos.app.alpha.kouros.MiniPlayer
import net.jkos.app.alpha.kouros.NowPlaying
import net.jkos.app.alpha.kouros.NowPlayingBody
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
        endTime: String? = null, location: String? = null, notes: String? = null, cadence: String? = null,
    ) = Items.item(JSONObject().apply {
        put("cadence_days", cadence ?: JSONObject.NULL)
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
        item("Lower Body", kind = "routine", id = 30, cadence = "0,2,4", time = "18:00"),
        item("Lower Body", parent = 30, due = d(-2), time = "18:00", done = true, extRef = "routine:30:${d(-2)}", id = 34),
        item("Lower Body", parent = 30, due = d(-5), time = "18:00", done = true, extRef = "routine:30:${d(-5)}", id = 35),
        item("Lower Body", parent = 30, due = d(-7), time = "18:00", done = true, extRef = "routine:30:${d(-7)}", id = 36),
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

    // ── ORDECK: the home, over the web's own preview sample (apps/ordeck/src/hud/sample.ts) —
    // the same items, focus, pins and probes, the clock pinned to the instant the web's sheets
    // draw at — so each card can be laid beside `pnpm widget shot <id>`.

    private val pinned = java.time.ZonedDateTime.of(2026, 9, 28, 9, 41, 27, 0, java.time.ZoneId.of("America/Chicago"))
    private fun sd(days: Long) = pinned.toLocalDate().plusDays(days).toString()
    private val hudItems: List<Item> = listOf(
        item("Standup with the platform team", kind = "event", due = sd(0), time = "09:00", endTime = "09:15", done = true, id = 1),
        item("Review the access-control matrix", due = sd(0), time = "09:30", endTime = "10:30", id = 2),
        item("Reconcile the Q3 change log", due = sd(0), time = "11:00", id = 3),
        item("Lunch", kind = "event", due = sd(0), time = "12:30", endTime = "13:15", id = 4),
        item("Write up the segregation-of-duties finding", due = sd(0), time = "14:00", endTime = "15:30", id = 5),
        item("Walk", kind = "habit", due = sd(0), time = "17:30", id = 6),
        item("Rotate the service-client secrets", due = sd(-2), id = 7),
        item("Draft the audit scoping memo", due = sd(1), time = "10:00", endTime = "11:00", id = 8),
        item("Evidence request: user provisioning", due = sd(3), id = 9),
        item("Quarterly access review", kind = "event", due = sd(7), time = "09:00", endTime = "12:00", id = 10),
        item("File the expense report", due = sd(-5), done = true, id = 11),
    )
    private val hudShelf = Shelf(
        listOf(HudRef("beigeboard", "3", "Reconcile the Q3 change log"), HudRef("beigeboard", "5", "Write up the segregation-of-duties finding"), HudRef("beigeboard", "8", "Draft the audit scoping memo")),
        HudRef("beigeboard", "2", "Review the access-control matrix", "/"),
    )
    private val hudSystems = net.jkos.app.alpha.ordeck.SystemsState(listOf(
        net.jkos.app.alpha.ordeck.Systems.row("auth", true, 12, null), net.jkos.app.alpha.ordeck.Systems.row("beigeboard", true, 18, null),
        net.jkos.app.alpha.ordeck.Systems.row("kouros", true, 24, null), net.jkos.app.alpha.ordeck.Systems.row("lazuros", true, 30, """{"compute_online":false}"""),
    ))
    private val user = net.jkos.app.alpha.auth.User(1, "jag@example.test", "Jag", "admin")

    private fun home(name: String, order: List<String>, dark: Boolean = false, focus: Boolean = true) = captureRoboImage(out(name)) {
        Face(dark) {
            val scope = rememberCoroutineScope()
            val model = remember {
                net.jkos.app.alpha.ordeck.HudModel(scope, reachesBoard = true).also {
                    it.preload(order, hudItems, if (focus) hudShelf else hudShelf.copy(focus = null), hudSystems)
                }
            }
            net.jkos.app.alpha.ordeck.HomeTab(user, model, "ALPHA · staging · 0.1.0-alpha-staging", { _, _ -> }, now = pinned)
        }
    }

    /** A phone arrangement with every card the app draws (and Weather, which it names at the foot). */
    private val everyCard = listOf("clock", "focus", "today", "pinned", "bb-week", "calendar", "systems", "notifications", "weather")

    @Test fun home() = home("17-home", net.jkos.app.alpha.ordeck.HudOrder.order(null), focus = false)
    @Test @Config(qualifiers = "w411dp-h3400dp-xxhdpi") fun homeEveryCard() = home("18-home-every-card", everyCard, focus = false)
    @Test @Config(qualifiers = "w411dp-h3400dp-xxhdpi") fun homeEveryCardDark() = home("19-home-every-card-dark", everyCard, dark = true, focus = false)
    @Test fun homeFocus() = home("20-home-focus", everyCard)
    /** Landscape: the cards stay a card's width, centred. */
    @Test @Config(qualifiers = "w891dp-h411dp-land-xxhdpi") fun homeLandscape() = home("22-home-landscape", everyCard, focus = false)
    /** A small phone at a large font scale: the clock keeps to the screen; the rows wrap. */
    @Test @Config(qualifiers = "w360dp-h1600dp-xxhdpi", fontScale = 1.5f) fun homeLargeText() = home("23-home-large-text", everyCard, focus = false)

    /** A tap on an item opens BeigeBoard's own sheet over the home (a dialog: its own window). */
    @Test fun homeItemSheet() {
        registerRoborazziActivityToRobolectricIfNeeded()
        ActivityScenario.launch(RoborazziActivity::class.java).use { s ->
            s.onActivity { a ->
                a.setContent {
                    Face {
                        val scope = rememberCoroutineScope()
                        val model = remember { net.jkos.app.alpha.ordeck.HudModel(scope, reachesBoard = true).also { it.preload(everyCard, hudItems, hudShelf, hudSystems) } }
                        net.jkos.app.alpha.ordeck.HomeTab(user, model, "ALPHA · staging · 0.1.0-alpha-staging", { _, _ -> }, now = pinned, preOpen = 3)
                    }
                }
            }
            captureScreenRoboImage(out("21-home-item-sheet"))
        }
    }

    // ── KourOS: covers are drawn as their empty tiles (no network here), as the web's fixtures are.

    private val albums = listOf(
        Album("Substance", "New Order", 1987, 12, 0, 1, null), Album("So Tonight That I Might See", "Mazzy Star", 1993, 10, 0, 2, null),
        Album("Ceremony", "New Order", 1981, 2, 0, 3, null), Album("Treasure", "Cocteau Twins", 1984, 10, 0, 4, null),
        Album("Low", "David Bowie", 1977, 11, 0, 5, null), Album("Disintegration", "The Cure", 1989, 12, 0, 6, null),
    )

    private val playing = NowPlaying(
        trackId = 7, book = null, rate = 1f, title = "Ceremony", artist = "New Order", album = "Substance",
        hasArtwork = false, isPlaying = true, durationMs = 264_000, hasNext = true, hasPrevious = true,
    )

    @Test fun kourosLibrary() = captureRoboImage(out("13-kouros-library")) {
        Face { androidx.compose.foundation.layout.Column { LibraryScreen({}, preAlbums = albums) } }
    }

    @Test fun kourosNowPlaying() = captureRoboImage(out("14-kouros-now")) {
        Face { NowPlayingBody(playing, 97_000, null, {}, {}, {}, {}, {}) }
    }

    @Test fun kourosNowPlayingDark() = captureRoboImage(out("15-kouros-now-dark")) {
        Face(dark = true) {
            androidx.compose.foundation.layout.Column {
                NowPlayingBody(playing, 97_000, null, {}, {}, {}, {}, {})
            }
        }
    }

    // ── KourOS: books and the queue ──

    private val books = listOf(
        net.jkos.app.alpha.kouros.Book(1, "The Left Hand of Darkness", null, "Ursula K. Le Guin", "George Guidall", "Hainish Cycle", 4.0, 1969, 51_840.0, false),
        net.jkos.app.alpha.kouros.Book(2, "Piranesi", null, "Susanna Clarke", "Chiwetel Ejiofor", null, null, 2020, 30_600.0, false),
        net.jkos.app.alpha.kouros.Book(3, "A Wizard of Earthsea", null, "Ursula K. Le Guin", "Rob Inglis", "Earthsea", 1.0, 1968, 27_000.0, false),
        net.jkos.app.alpha.kouros.Book(4, "The Dispossessed", "An Ambiguous Utopia", "Ursula K. Le Guin", "Don Leslie", "Hainish Cycle", 5.0, 1974, 64_800.0, false),
    )
    private val chapters = listOf("Prologue", "A Parade in Erhenrang", "The Mad King", "The Fortieth Day", "Domestication", "One Way into Orgoreyn", "The Question of Sex", "Another Way into Orgoreyn")
        .mapIndexed { i, t -> net.jkos.app.alpha.kouros.Chapter(i * 6480.0, (i + 1) * 6480.0, t) }
    private val bookDetail = net.jkos.app.alpha.kouros.BookDetail(books[0],
        "<p>A lone human emissary is sent to Winter, a world whose people can choose — and change — their gender. A landmark of science fiction.</p>",
        listOf(net.jkos.app.alpha.kouros.BookFile(0, 51_840.0)), chapters)
    private val bookProgress = net.jkos.app.alpha.kouros.Progress(9, 1, 16_200.0, 51_840.0, false, "2026-11-17T21:04:00.000Z")

    @Test fun kourosBooks() = captureRoboImage(out("24-kouros-books")) {
        Face { net.jkos.app.alpha.kouros.BooksPane("", {}, pre = books to listOf(bookProgress)) }
    }

    @Test @Config(qualifiers = "w411dp-h1400dp-xxhdpi") fun kourosBook() = captureRoboImage(out("25-kouros-book")) {
        Face { net.jkos.app.alpha.kouros.BookScreen(net.jkos.app.alpha.kouros.KourosScreen.BookPage(1, books[0].title), null, null, {}, pre = bookDetail to bookProgress) }
    }

    @Test fun kourosBookPlayer() = captureRoboImage(out("26-kouros-book-player")) {
        Face(dark = true) {
            val info = net.jkos.app.alpha.kouros.BookInfo(1, 0, 51_840_000, chapters)
            val now = NowPlaying(trackId = null, book = info, rate = 1.25f, title = books[0].title, artist = "Ursula K. Le Guin", album = books[0].title,
                hasArtwork = false, isPlaying = true, durationMs = 51_840_000, hasNext = false, hasPrevious = false)
            net.jkos.app.alpha.kouros.BookPlayerBody(now, info, 16_200_000, {}, {}, {}, {})
        }
    }

    @Test fun kourosQueue() = captureRoboImage(out("27-kouros-queue")) {
        Face {
            val q = net.jkos.app.alpha.kouros.QueueState(listOf(
                net.jkos.app.alpha.kouros.QueueEntry("1", 1, false, "Elegia", "New Order", false, 293_000),
                net.jkos.app.alpha.kouros.QueueEntry("2", 2, false, "Ceremony", "New Order", false, 264_000),
                net.jkos.app.alpha.kouros.QueueEntry("3", 3, false, "Fade Into You", "Mazzy Star", false, 295_000),
                net.jkos.app.alpha.kouros.QueueEntry("4", 4, false, "Lorelei", "Cocteau Twins", false, 223_000),
                net.jkos.app.alpha.kouros.QueueEntry("5", 5, false, "Warszawa", "David Bowie", false, 380_000),
                net.jkos.app.alpha.kouros.QueueEntry("6", 6, false, "Plainsong", "The Cure", false, 312_000),
            ), current = 1)
            net.jkos.app.alpha.kouros.QueueBody(q, {}, onMove = { _, _ -> }, onPlay = {}, onRemove = {})
        }
    }

    @Test fun kourosMiniPlayer() = captureRoboImage(out("16-kouros-mini")) {
        Face(dark = true) { androidx.compose.foundation.layout.Column { androidx.compose.foundation.layout.Spacer(Modifier.weight(1f)); MiniPlayer(playing, null) {} } }
    }
}
