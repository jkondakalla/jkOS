package net.jkos.app.alpha.auth

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.jkos.app.alpha.BuildBadge
import net.jkos.app.alpha.Choice
import net.jkos.app.alpha.Header
import net.jkos.app.alpha.Load
import net.jkos.app.alpha.Nav
import net.jkos.app.alpha.Screen
import net.jkos.app.alpha.activity
import net.jkos.app.alpha.attempt
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// The Account tab: jkAuth's screens. Who you are, how the suite looks, where you are signed
// in, and the way out. Password and two-factor stay jkAuth's own pages, in the browser.

/** The Account tab's first screen. */
data object AccountRoot : Screen

@Composable
private fun SectionTitle(text: String) {
    // The suite's section name: Fraunces caps in the accent, over a hairline (jkAuth's account page).
    Column(Modifier.padding(top = 24.dp, bottom = 8.dp)) {
        AccentLab(text)
        Gap(6)
        Rule()
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** "2026-11-16 18:04" from the suite's wire timestamp, in UTC as jkAuth's own page shows it. */
internal fun shortStamp(iso: String): String =
    if (iso.length >= 16 && iso[10] == 'T') iso.substring(0, 10) + " " + iso.substring(11, 16) + " UTC" else iso

@Composable
fun AccountTab(user: User, @Suppress("UNUSED_PARAMETER") screen: Screen, @Suppress("UNUSED_PARAMETER") nav: Nav) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val mode = Auth.look.collectAsState().value.mode

    // The profile carries the theme mode and the version a theme write must be built on.
    var profile by remember { mutableStateOf<Load<Profile>>(Load.Loading) }
    var devices by remember { mutableStateOf<Load<List<Device>>>(Load.Loading) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        profile = attempt { AccountApi.profile().also { Auth.lookSeen(it.look) } }
        devices = attempt { AccountApi.devices() }
    }

    var name by remember(user.name) { mutableStateOf(user.name ?: "") }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var signingOut by remember { mutableStateOf(false) }

    /** Run one change, say what happened, and re-read what the server now holds. */
    fun change(done: String, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        note = null
        scope.launch {
            note = when (val r = attempt { block() }) {
                is Load.Failed -> r.message
                else -> done
            }
            busy = false
            reload++
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header("Account", onBack = null)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 24.dp, end = 24.dp, bottom = 24.dp)) {
            item {
                Gap(14)
                PressTitle(user.name ?: user.email, size = 30.sp)
                Row(Modifier.padding(top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Eyebrow(user.email, Modifier.weight(1f))
                    Pill(user.role, tint = Jk.face.accent)
                }
                Rule(strong = true)
                note?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.secondary)
                }

                SectionTitle("Display name")
                Field(
                    value = name, onValueChange = { name = it.take(100) }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                TButton(quiet = true, 
                    enabled = !busy && name.trim().isNotEmpty() && name.trim() != (user.name ?: ""),
                    onClick = {
                        val wanted = name.trim()
                        change("Name saved.") {
                            AccountApi.setName(wanted)
                            Auth.userChanged(AccountApi.profile().user)
                        }
                    },
                ) { Text("Save name") }

                SectionTitle("Appearance")
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                    for (m in ThemeMode.entries) {
                        Choice(m.label, selected = m == mode) {
                            val p = (profile as? Load.Ready)?.value ?: return@Choice
                            if (m == mode) return@Choice
                            change("Theme saved for every jkOS app.") {
                                AccountApi.setThemeMode(m, p.prefsVersion)
                                Auth.themeModeSeen(m)
                            }
                        }
                    }
                }
                Note(
                    when (profile) {
                        is Load.Failed -> "Couldn't read your settings. Pull this tab up again to retry."
                        else -> "The same setting the web apps follow."
                    },
                )

                SectionTitle("Your devices")
                Note("Each sign-in is one entry. Signing one out ends it on jkOS at once.")
            }

            when (val d = devices) {
                Load.Loading -> item { Note("Loading…") }
                is Load.Failed -> item {
                    Hush(d.message)
                    TButton(quiet = true, onClick = { reload++ }) { Text("Retry") }
                }
                is Load.Ready -> items(d.value, key = { it.familyId }) { dev ->
                    DeviceRow(dev, busy) {
                        change("Signed that device out.") { AccountApi.revoke(dev.familyId) }
                    }
                }
            }

            item {
                SectionTitle("Password and two-factor")
                Note("These stay on jkOS's own pages, so a password is never typed into this app.")
                TButton(onClick = {
                    context.activity()?.let {
                        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(it, Uri.parse(AccountApi.securityPage))
                    }
                }) { Text("Open account security") }

                SectionTitle("This build")
                BuildBadge()
                Spacer(Modifier.height(4.dp))
                Note("Environment: ${Auth.config.environment}")
                for ((app, base) in Auth.config.apiBases) Note("$app: $base")
                Note("Signed in by: ${Auth.config.authOrigin}")

                Spacer(Modifier.height(24.dp))
                TButton(primary = true, enabled = !signingOut, onClick = {
                    signingOut = true
                    scope.launch { Auth.signOut() }
                }) { Text(if (signingOut) "Signing out…" else "Sign out") }
                Note("Signing out also ends this phone's session on jkOS.")
            }
        }
    }
}

@Composable
private fun DeviceRow(dev: Device, busy: Boolean, revoke: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    when {
                        dev.isThisDevice -> "This device"
                        dev.clientId == null -> "A browser"
                        dev.clientId == Auth.config.clientId -> "jkOS Alpha on another device"
                        else -> dev.clientId
                    },
                    style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (dev.revoked) Jk.face.faint else if (dev.isThisDevice) Jk.face.accent else Jk.face.ink,
                )
                Note(
                    if (dev.revoked) "Signed out (${dev.revokedReason ?: "revoked"}) · started ${shortStamp(dev.createdAt)}"
                    else "Last used ${shortStamp(dev.lastUsedAt)} · started ${shortStamp(dev.createdAt)}",
                )
            }
            if (!dev.revoked && !dev.isThisDevice) {
                Spacer(Modifier.width(8.dp))
                TButton(quiet = true, enabled = !busy, onClick = revoke) { Text("Sign out") }
            }
        }
        Spacer(Modifier.height(8.dp))
        Rule()
    }
}
