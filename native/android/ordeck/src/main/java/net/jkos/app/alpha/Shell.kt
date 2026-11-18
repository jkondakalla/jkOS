package net.jkos.app.alpha

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import net.jkos.app.alpha.look.*
import net.jkos.app.alpha.auth.AccountApi
import net.jkos.app.alpha.auth.AccountRoot
import net.jkos.app.alpha.auth.AccountTab
import net.jkos.app.alpha.auth.Auth
import net.jkos.app.alpha.auth.AuthState
import net.jkos.app.alpha.auth.User
import net.jkos.app.alpha.beigeboard.BeigeBoardRoot
import net.jkos.app.alpha.beigeboard.BeigeBoardTab
import net.jkos.app.alpha.kouros.KourosScreen
import net.jkos.app.alpha.kouros.KourosTab
import net.jkos.app.alpha.kouros.MiniPlayer
import net.jkos.app.alpha.kouros.RemoteMiniPlayer
import net.jkos.app.alpha.kouros.rememberIsRemote
import net.jkos.app.alpha.kouros.rememberController
import net.jkos.app.alpha.kouros.rememberNowPlaying
import net.jkos.app.alpha.ordeck.HomeRoot
import net.jkos.app.alpha.ordeck.HomeTab
import net.jkos.app.alpha.ordeck.HudModel
import net.jkos.app.alpha.look.TButton

// The app's shell: sign-in, then a bottom bar of tabs, one back stack per tab, and the mini
// player above the bar. Each tab's screens live in that app's own package.

@Composable
fun JkosRoot() {
    val auth by Auth.state.collectAsState()
    // The ground runs under the system bars (edge to edge); the content keeps clear of them.
    Ground(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        when (val a = auth) {
            is AuthState.SignedIn -> SignedIn(a.user, a.aud)
            AuthState.SignedOut -> SignInScreen()
        }
        }
    }
}

// ── sign-in ────────────────────────────────────────────────────────────────────

@Composable
private fun SignInScreen() {
    val context = LocalContext.current
    val message by Auth.message.collectAsState()
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Wordmark("jkOS", size = 56.sp)
        Spacer(Modifier.height(14.dp))
        BuildBadge()
        Spacer(Modifier.height(40.dp))
        TButton(primary = true, onClick = { context.activity()?.let { Auth.beginSignIn(it) } }) {
            Text("Sign in with jkOS")
        }
        Spacer(Modifier.height(16.dp))
        Hush("Opens ${Auth.config.authOrigin} in your browser. Your password never enters this app.")
        message?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.secondary)
        }
    }
}

// ── signed in: the tabs ────────────────────────────────────────────────────────

/** How one tab is drawn in the bar, and the screen its stack starts on. */
private class TabFace(val label: String, val glyph: ImageVector, val root: Screen)

/** The face of a tab, or null for an app this build has no screens for (it then has no tab). */
private fun faceOf(tab: Tab): TabFace? = when (tab) {
    Tab.Home -> TabFace("Home", Glyphs.Home, HomeRoot)
    Tab.Account -> TabFace("Account", Glyphs.Account, AccountRoot)
    is Tab.App -> when (tab.app) {
        "kouros" -> TabFace("KourOS", Glyphs.Music, KourosScreen.Library)
        "beigeboard" -> TabFace("BeigeBoard", Glyphs.Board, BeigeBoardRoot)
        else -> null
    }
}

@Composable
private fun SignedIn(user: User, aud: Set<String>) {
    val tabs = remember(aud) { Tabs.forAud(aud, Auth.config.apiBases.keys.toList()).filter { faceOf(it) != null } }
    if (tabs.isEmpty()) {
        // A session stored before the app kept the audience, or one whose role reaches nothing
        // here. Ask jkAuth for a token: its `aud` then decides.
        LearningAudience()
        return
    }

    // The person's look (mode, accent pair, effects), as soon as they are in: the profile is theirs to read with the
    // app's token. A jkAuth that doesn't take the token yet answers 401, and the last mode
    // seen stays.
    LaunchedEffect(user.id) {
        runCatching { Auth.lookSeen(AccountApi.profile().look) }
    }

    var selected by remember { mutableStateOf(tabs.first()) }
    val current = if (selected in tabs) selected else tabs.first()
    val stacks = remember { mutableStateMapOf<Tab, SnapshotStateList<Screen>>() }
    fun navOf(tab: Tab) = Nav(stacks.getOrPut(tab) { mutableStateListOf(faceOf(tab)!!.root) })
    val nav = navOf(current)

    // Back pops the tab's own stack first; from a tab's first screen it returns to the first tab.
    BackHandler(enabled = nav.canPop || current != tabs.first()) {
        if (nav.canPop) nav.pop() else selected = tabs.first()
    }

    // The home's data outlives a visit to another tab, so Home redraws at once and refreshes behind it.
    val shellScope = rememberCoroutineScope()
    val reachesBoard = tabs.any { it.app == "beigeboard" }
    val hud = remember(user.id, reachesBoard) { HudModel(shellScope, reachesBoard) }

    // The player belongs to KourOS, and exists only when this person can enter KourOS.
    val kouros = tabs.firstOrNull { it.app == "kouros" }
    val controller = if (kouros != null) rememberController() else null
    val now = rememberNowPlaying(controller)

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (current) {
                Tab.Home -> HomeTab(user, hud, buildLabel(), openApp = { app -> tabs.firstOrNull { it.app == app }?.let { t -> selected = t; navOf(t).popToRoot() } })
                Tab.Account -> AccountTab(user, nav.top, nav)
                is Tab.App -> when (current.app) {
                    "kouros" -> KourosTab(nav.top, nav, controller, now)
                    "beigeboard" -> BeigeBoardTab(nav.top, nav)
                }
            }
        }
        val openNowPlaying = {
            if (kouros != null) {
                selected = kouros
                val k = navOf(kouros)
                if (k.top != KourosScreen.NowPlayingPage) k.push(KourosScreen.NowPlayingPage)
            }
        }
        val onNowPlaying = current == kouros && nav.top == KourosScreen.NowPlayingPage
        // As a remote the bar shows what the session's output plays; otherwise this player.
        val remote = kouros != null && rememberIsRemote()
        if (remote && !onNowPlaying) {
            RemoteMiniPlayer(openNowPlaying)
        } else if (!remote && kouros != null && now != null && !onNowPlaying) {
            MiniPlayer(now, controller, openNowPlaying)
        }
        // The tab bar: a masthead turned to the foot — the suite's nav tabs, the current one a well.
        val face = Jk.face
        Row(
            Modifier.fillMaxWidth().drawBehind {
                drawRect(face.ink.copy(alpha = 0.3f), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx()))
            }.padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (tab in tabs) {
                val face0 = faceOf(tab) ?: continue
                val on = tab == current
                val tint = if (on) face.accent else face.muted
                val cell: @Composable () -> Unit = {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable(role = Role.Tab) { if (on) nav.popToRoot() else selected = tab }
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(face0.glyph, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.height(3.dp))
                        Text(
                            face0.label.uppercase(), maxLines = 1,
                            style = MaterialTheme.typography.labelSmall.copy(color = tint, fontSize = 9.sp, shadow = if (on) haloText(face.accent) else null),
                        )
                    }
                }
                if (on) Well(Modifier.weight(1f), radius = JkRadius.sm) { cell() } else Box(Modifier.weight(1f)) { cell() }
            }
        }
    }
}

@Composable
private fun LearningAudience() {
    val scope = rememberCoroutineScope()
    var failed by remember { mutableStateOf<String?>(null) }
    var attemptNo by remember { mutableStateOf(0) }
    LaunchedEffect(attemptNo) {
        failed = null
        // A fresh token carries the audience; Auth publishes it and this screen is replaced.
        failed = when (val r = attempt { Auth.renewAudience() }) {
            is Load.Failed -> r.message
            is Load.Ready -> if (r.value.isEmpty()) "This account can't open any app here." else null
            Load.Loading -> null
        }
    }
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val message = failed
        if (message == null) {
            Lamp("Asking jkAuth")
        } else {
            Hush(message)
            TButton(quiet = true, onClick = { attemptNo++ }) { Text("Retry") }
            TButton(quiet = true, onClick = { scope.launch { Auth.signOut() } }) { Text("Sign out") }
        }
    }
}
