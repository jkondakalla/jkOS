package net.jkos.app.alpha.ordeck

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.jkos.app.alpha.BuildBadge
import net.jkos.app.alpha.Header
import net.jkos.app.alpha.Screen
import net.jkos.app.alpha.auth.User

// The Home tab: ORDECK. Until the HUD is built (TODO §10 I) it greets the person and lists the
// tabs their account opens, which are the apps their token's `aud` names.

/** The Home tab's first screen. */
data object HomeRoot : Screen

@Composable
fun HomeTab(user: User, apps: List<Pair<String, () -> Unit>>) {
    Column(Modifier.fillMaxSize()) {
        Header("jkOS", onBack = null)
        Column(Modifier.padding(horizontal = 24.dp)) {
            Text("Hello, ${user.name ?: user.email}.", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            BuildBadge()
            Spacer(Modifier.height(24.dp))
            Text("Your apps", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for ((label, open) in apps) {
            Row(Modifier.fillMaxWidth().clickable(onClick = open).padding(horizontal = 24.dp, vertical = 14.dp)) {
                Text(label, style = MaterialTheme.typography.titleMedium)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        }
    }
}
