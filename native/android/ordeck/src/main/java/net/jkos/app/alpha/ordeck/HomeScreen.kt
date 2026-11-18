package net.jkos.app.alpha.ordeck

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.jkos.app.alpha.Glyphs
import net.jkos.app.alpha.Load
import net.jkos.app.alpha.Screen
import net.jkos.app.alpha.activity
import net.jkos.app.alpha.attempt
import net.jkos.app.alpha.auth.AccountApi
import net.jkos.app.alpha.auth.Auth
import net.jkos.app.alpha.auth.HudShelf
import net.jkos.app.alpha.auth.User
import net.jkos.app.alpha.beigeboard.Board
import net.jkos.app.alpha.beigeboard.Days
import net.jkos.app.alpha.look.*
import java.time.LocalDate
import java.time.ZonedDateTime

// The Home tab: ORDECK's HUD, as the phone's home screen. The person's own cards, in the order
// they arranged them for a phone on the web (HudOrder), one column, pull to refresh. Arranging
// stays on the web: the app opens it in the browser.

/** The Home tab's first screen. */
data object HomeRoot : Screen

/**
 * The cards this app draws: ORDECK's own (apps/ordeck/widgets/). Weather isn't one: its
 * AccuWeather key lives in the browser's storage, and an APK must not carry one. Another app's
 * card (KourOS's, LazurOS's) is the web's alone for now, and is counted at the foot.
 */
val DRAWN = setOf("clock", "today", "calendar", "bb-week", "focus", "pinned", "systems", "notifications")

/**
 * What the home reads: one profile read (the arrangement, the shelf, the AI switch), BeigeBoard's
 * items through a [Board] (so a tick or an add here is the same write the BeigeBoard tab makes),
 * and the health probes. Held by the shell, so going back to Home redraws at once and refreshes
 * behind it.
 */
class HudModel(private val scope: CoroutineScope, val reachesBoard: Boolean) {
    val board = Board(scope)

    /** The card ids in order; null until the profile has answered once. */
    var order by mutableStateOf<List<String>?>(null)
        private set
    /** Set when the arrangement couldn't be read and the default is showing. */
    var orderNote by mutableStateOf<String?>(null)
        private set
    var aiEnabled by mutableStateOf(true)
        private set
    var systems by mutableStateOf(SystemsState(emptyList()))
        private set
    var refreshing by mutableStateOf(false)
        private set

    /** The profile, the board and the probes. [pull] shows the pull-to-refresh spinner until the profile and probes answer. */
    fun refresh(pull: Boolean = false) {
        if (reachesBoard) board.load(withShelf = false)
        scope.launch {
            if (pull) refreshing = true
            try { readProfile(); probe() } finally { refreshing = false }
        }
    }

    /** The probes alone (every 30 s, as the web's systems card). */
    fun reprobe() { scope.launch { probe() } }

    private suspend fun readProfile() {
        when (val r = attempt { AccountApi.preferences() }) {
            is Load.Ready -> {
                order = HudOrder.order(r.value)
                orderNote = null
                board.adopt(HudShelf.read(r.value))
                aiEnabled = AiSwitch.enabled(r.value)
            }
            is Load.Failed -> if (order == null) {
                order = HudOrder.order(null)
                orderNote = "Couldn't read your arrangement (${r.message}), so this is the default."
            }
            Load.Loading -> Unit
        }
    }

    private suspend fun probe() {
        val probes = HealthApi.probes(aiEnabled)
        if (systems.rows.map { it.name } != probes.map { it.app }) systems = Systems.probing(probes.map { it.app })
        systems = SystemsState(coroutineScope { probes.map { async { HealthApi.probe(it) } }.awaitAll() })
    }

    /** Draw these without asking anyone (the screenshot renders). */
    internal fun preload(order: List<String>, items: List<net.jkos.app.alpha.beigeboard.Item>, shelf: net.jkos.app.alpha.auth.Shelf, systems: SystemsState) {
        this.order = order
        board.preload(items, shelf)
        this.systems = systems
    }
}

/**
 * The home screen. [openApp] switches to an app's tab (a card's source, a pinned item). [now] pins
 * the clock (the renders); otherwise it ticks. While the screen is up and the app is in front,
 * the profile and board refresh every minute and the probes every 30 s, as the web's HUD polls.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTab(user: User, model: HudModel, build: String, openApp: (String) -> Unit, now: ZonedDateTime? = null) {
    val face = Jk.face
    val context = LocalContext.current
    val still = LocalStill.current
    var tick by remember { mutableStateOf(now ?: ZonedDateTime.now()) }
    if (now == null && !still) {
        LaunchedEffect(Unit) { while (true) { delay(1000 - System.currentTimeMillis() % 1000); tick = ZonedDateTime.now() } }
    }
    if (now == null) {
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        LaunchedEffect(model, lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                model.refresh()
                var n = 0
                while (true) {
                    delay(30_000)
                    if (++n % 2 == 0) model.refresh() else model.reprobe()
                }
            }
        }
    }
    val arrange = {
        context.activity()?.let { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(it, Uri.parse(Auth.config.portalUrl)) }
        Unit
    }
    val openBoard: (() -> Unit)? = if (model.reachesBoard) ({ openApp("beigeboard") }) else null

    val clock = ClockFace.of(tick)
    val today: LocalDate = tick.toLocalDate()
    val items = model.board.items
    val boardState = model.board.state
    val day = DaySlice.of(
        items, clock.iso, clock.hm, reachable = model.reachesBoard,
        loaded = boardState !is Load.Loading, offline = boardState is Load.Failed || model.board.stale,
    )
    val focus = FocusSlice.of(model.board.shelf.focus, items)
    val order = model.order
    // Focus mode (the web's RoomHUD): with something in focus and the Focus card placed, every
    // other card dims around it.
    val dimOthers = focus.active && order?.contains("focus") == true

    Column(Modifier.fillMaxSize()) {
        TopStrip(model.systems, arrange)
        val pull = rememberPullToRefreshState()
        PullToRefreshBox(
            isRefreshing = model.refreshing, onRefresh = { model.refresh(pull = true) },
            modifier = Modifier.weight(1f),
            state = pull,
            indicator = {
                PullToRefreshDefaults.Indicator(state = pull, isRefreshing = model.refreshing, modifier = Modifier.align(Alignment.TopCenter), containerColor = face.card, color = face.accent)
            },
        ) {
            if (order == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Lamp("Loading") }
                return@PullToRefreshBox
            }
            val drawn = order.filter { it in DRAWN }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                model.orderNote?.let { note -> item(key = "note") { Hush(note) } }
                items(drawn, key = { it }) { id ->
                    Box(Modifier.alpha(if (dimOthers && id != "focus") 0.32f else 1f)) {
                        when (id) {
                            "clock" -> ClockCard(clock)
                            "today" -> TodayCard(day, { itemId, _ -> model.board.byId[itemId]?.let(model.board::toggleDone) }, { t -> model.board.add(t, "task", clock.iso, null) }, openBoard)
                            "calendar" -> CalendarCard(MonthSlice.of(items, today), today)
                            "bb-week" -> WeekCard(Days.week(clock.iso).map { LocalDate.parse(it) to Days.on(items, it) }, today, openBoard)
                            "focus" -> FocusCard(focus, model.board::endFocus, openBoard?.takeIf { focus.app == "beigeboard" })
                            "pinned" -> PinnedCard(Pinned.of(model.board.shelf.pins, items), model.reachesBoard, openBoard?.let { o -> { _: PinRow -> o() } })
                            "systems" -> SystemsCard(model.systems)
                            "notifications" -> AlertsCard(Alerts.of(day, model.systems, clock.hm))
                        }
                    }
                }
                model.board.note?.let { note -> item(key = "board-note") { Hush(note) } }
                item(key = "foot") { Foot(order, arrange) }
                item(key = "strip") { BottomStrip(user, build) }
            }
        }
    }
}

/** The web's top strip: the jk mark, ORDECK, how many systems answer, and the way to arrange the HUD. */
@Composable
private fun TopStrip(systems: SystemsState, arrange: () -> Unit) {
    val face = Jk.face
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(face.accent),
            contentAlignment = Alignment.Center,
        ) { Text("jk", style = TextStyle(fontFamily = JkFonts.Mono, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, color = face.accentContrast)) }
        Spacer(Modifier.width(12.dp))
        Text("ORDECK", style = TextStyle(fontFamily = JkFonts.Mono, fontWeight = FontWeight.SemiBold, fontSize = 10.5.sp, letterSpacing = 0.24.em, color = face.faint))
        Spacer(Modifier.weight(1f))
        val dot = when {
            systems.total == 0 -> face.ghost
            systems.up == systems.total -> face.ok
            systems.up == 0 -> face.danger
            else -> face.warn
        }
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(dot))
        Spacer(Modifier.width(7.dp))
        StripText(if (systems.total == 0) "Probing" else "${systems.up} of ${systems.total} systems up")
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(JkRadius.button)).clickable(role = Role.Button, onClick = arrange)
                .semantics { contentDescription = "Arrange the HUD on the web" },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(32.dp).border(1.dp, face.line, RoundedCornerShape(JkRadius.button)), contentAlignment = Alignment.Center) {
                Icon(Glyphs.Arrange, contentDescription = null, tint = face.muted, modifier = Modifier.size(15.dp))
            }
        }
    }
}

/** What the phone doesn't draw, said once at the foot, and the way to change the arrangement. */
@Composable
private fun Foot(order: List<String>, arrange: () -> Unit) {
    val weather = "weather" in order
    val others = order.count { it !in DRAWN && it != "weather" }
    Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (order.none { it in DRAWN }) Hush("Your HUD has no cards arranged for a phone.")
        if (weather) Hush("Weather is on the web HUD only: its key lives in your browser, and the app doesn't carry one.")
        if (others > 0) Hush("$others more card${if (others == 1) " is" else "s are"} on the web HUD only.")
        TButton(onClick = arrange, quiet = true) { Text("Arrange on the web ↗") }
    }
}

/** The web's bottom strip: ORDECK, the face, who is signed in; and the build, so a tester knows what they hold. */
@Composable
private fun BottomStrip(user: User, build: String) {
    val face = Jk.face
    Column(Modifier.fillMaxWidth().padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Rule()
        Row(verticalAlignment = Alignment.CenterVertically) {
            StripText("ORDECK · ${if (face.dark) "Phosphor" else "Paper"} · ${(user.name ?: user.email)}", color = face.ghost, modifier = Modifier.weight(1f))
            Box(Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(face.ok))
            Spacer(Modifier.width(7.dp))
            StripText("Ready", color = face.ghost)
        }
        StripText(build, color = face.ghost)
    }
}
