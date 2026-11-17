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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.launch
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
import net.jkos.app.alpha.kouros.rememberController
import net.jkos.app.alpha.kouros.rememberNowPlaying
import net.jkos.app.alpha.ordeck.HomeRoot
import net.jkos.app.alpha.ordeck.HomeTab

// The app's shell: sign-in, then a bottom bar of tabs, one back stack per tab, and the mini
// player above the bar. Each tab's screens live in that app's own package.

@Composable
fun JkosRoot() {
    val auth by Auth.state.collectAsState()
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        when (val a = auth) {
            is AuthState.SignedIn -> SignedIn(a.user, a.aud)
            AuthState.SignedOut -> SignInScreen()
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
        Text("jkOS", style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(8.dp))
        BuildBadge()
        Spacer(Modifier.height(40.dp))
        Button(onClick = { context.activity()?.let { Auth.beginSignIn(it) } }) {
            Text("Sign in with jkOS")
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Opens ${Auth.config.authOrigin} in your browser. Your password never enters this app.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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

    // The person's theme mode, as soon as they are in: the profile is theirs to read with the
    // app's token. A jkAuth that doesn't take the token yet answers 401, and the last mode
    // seen stays.
    LaunchedEffect(user.id) {
        runCatching { Auth.themeModeSeen(AccountApi.profile().themeMode) }
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

    // The player belongs to KourOS, and exists only when this person can enter KourOS.
    val kouros = tabs.firstOrNull { it.app == "kouros" }
    val controller = if (kouros != null) rememberController() else null
    val now = rememberNowPlaying(controller)

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (current) {
                Tab.Home -> HomeTab(user, tabs.mapNotNull { t -> faceOf(t)?.let { it.label to { selected = t } } }.drop(1))
                Tab.Account -> AccountTab(user, nav.top, nav)
                is Tab.App -> when (current.app) {
                    "kouros" -> KourosTab(nav.top, nav, controller, now)
                    "beigeboard" -> BeigeBoardTab(nav.top, nav)
                }
            }
        }
        if (kouros != null && now != null && !(current == kouros && nav.top == KourosScreen.NowPlayingPage)) {
            MiniPlayer(now, controller) {
                selected = kouros
                val k = navOf(kouros)
                if (k.top != KourosScreen.NowPlayingPage) k.push(KourosScreen.NowPlayingPage)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
            for (tab in tabs) {
                val face = faceOf(tab) ?: continue
                val on = tab == current
                val tint = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                Column(
                    Modifier
                        .weight(1f)
                        .clickable(role = Role.Tab) { if (on) nav.popToRoot() else selected = tab }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(face.glyph, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
                    Text(face.label, style = MaterialTheme.typography.labelSmall, color = tint, maxLines = 1)
                }
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
            CircularProgressIndicator()
        } else {
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { attemptNo++ }) { Text("Retry") }
            TextButton(onClick = { scope.launch { Auth.signOut() } }) { Text("Sign out") }
        }
    }
}
