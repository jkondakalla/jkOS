package net.jkos.app.alpha.beigeboard

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.jkos.app.alpha.Header
import net.jkos.app.alpha.Nav
import net.jkos.app.alpha.Screen

// The BeigeBoard tab. Its screens are TODO §10 H; until they land the tab says so, and makes
// no call to BeigeBoard's API.

/** The BeigeBoard tab's first screen. */
data object BeigeBoardRoot : Screen

@Composable
fun BeigeBoardTab(@Suppress("UNUSED_PARAMETER") screen: Screen, @Suppress("UNUSED_PARAMETER") nav: Nav) {
    Column(Modifier.fillMaxSize()) {
        Header("BeigeBoard", onBack = null)
        Column(Modifier.padding(24.dp)) {
            Text("Not in this build yet.", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                "Today, tasks, goals, the calendar and routines arrive here in a later alpha build. " +
                    "Until then, BeigeBoard is in your browser.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
