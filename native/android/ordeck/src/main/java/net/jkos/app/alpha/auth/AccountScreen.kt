package net.jkos.app.alpha.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.jkos.app.alpha.BuildBadge
import net.jkos.app.alpha.Header
import net.jkos.app.alpha.Nav
import net.jkos.app.alpha.Screen

// The Account tab: jkAuth's screens. Who you are, which build this is, and sign out.

/** The Account tab's first screen. */
data object AccountRoot : Screen

@Composable
fun AccountTab(user: User, @Suppress("UNUSED_PARAMETER") screen: Screen, @Suppress("UNUSED_PARAMETER") nav: Nav) {
    val scope = rememberCoroutineScope()
    var signingOut by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Header("Account", onBack = null)
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(user.name ?: user.email, style = MaterialTheme.typography.titleLarge)
            Text(user.email, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Role: ${user.role}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Text("Environment: ${Auth.config.environment}")
            for ((app, base) in Auth.config.apiBases) {
                Text("$app: $base", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("Signed in by: ${Auth.config.authOrigin}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            BuildBadge()
            Spacer(Modifier.height(24.dp))
            Button(enabled = !signingOut, onClick = {
                signingOut = true
                scope.launch { Auth.signOut() }
            }) { Text(if (signingOut) "Signing out…" else "Sign out") }
            Text(
                "Signing out also ends this phone's session on jkOS.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
