package net.jkos.app.alpha.ordeck

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.jkos.app.alpha.BuildBadge
import net.jkos.app.alpha.Header
import net.jkos.app.alpha.Screen
import net.jkos.app.alpha.auth.User
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.unit.sp
import net.jkos.app.alpha.look.*

// The Home tab: ORDECK. Until the HUD is built (TODO §10 I) it greets the person and lists the
// tabs their account opens, which are the apps their token's `aud` names.

/** The Home tab's first screen. */
data object HomeRoot : Screen

@Composable
fun HomeTab(user: User, apps: List<Pair<String, () -> Unit>>) {
    val face = Jk.face
    val now = java.time.LocalDateTime.now()
    val greeting = when (now.hour) { in 5..11 -> "Good morning"; in 12..17 -> "Good afternoon"; else -> "Good evening" }
    Column(Modifier.fillMaxSize()) {
        Header("jkOS", onBack = null) { Box(Modifier.padding(end = 6.dp)) { BuildBadge() } }
        Column(Modifier.padding(horizontal = 18.dp).padding(top = 14.dp)) {
            PressTitle("$greeting, ${(user.name ?: user.email).substringBefore(' ')}.", size = 30.sp)
            Eyebrow(
                now.format(java.time.format.DateTimeFormatter.ofPattern("EEEE · MMMM d", java.util.Locale.US)),
                Modifier.padding(top = 6.dp, bottom = 10.dp),
            )
            Rule(strong = true)
            Gap(18)
            Sheet(Modifier.fillMaxWidth()) {
                SheetHead("Your apps", "%02d open to you".format(apps.size))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, open) in apps) {
                        Chip(face.accent, Modifier.fillMaxWidth(), onClick = open, padding = PaddingValues(horizontal = 14.dp, vertical = 14.dp)) {
                            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                            Eyebrow("Open →", color = face.accent)
                        }
                    }
                }
            }
        }
    }
}
