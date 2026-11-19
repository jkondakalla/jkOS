package net.jkos.app.alpha

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import net.jkos.app.alpha.look.*
import net.jkos.app.alpha.auth.Auth
import net.jkos.app.alpha.auth.SignedOutException
import net.jkos.app.alpha.look.TButton

// What every tab's screens share: the back stack, the header, and the one way a load is drawn.

/** One entry of a tab's back stack. Each app's package declares its own screens. */
interface Screen

/** A tab's back stack, as its screens use it. Back pops it (no navigation library). */
class Nav(private val stack: SnapshotStateList<Screen>) {
    val top: Screen get() = stack.last()
    val canPop: Boolean get() = stack.size > 1
    fun push(screen: Screen) { stack.add(screen) }
    fun pop() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun popToRoot() { while (stack.size > 1) stack.removeAt(stack.lastIndex) }
}

fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** "ALPHA · staging · 0.1.0-alpha-staging" — always in reach, so a tester knows what they hold. */
fun buildLabel() = with(Auth.config) { "${channel.uppercase()} · $environment · $versionName" }

@Composable
fun BuildBadge() = Pill(buildLabel(), tint = Jk.face.accent)

/**
 * A pushed page's head: back, the page's name pressed in Fraunces, its actions, over the
 * masthead's feathered rule.
 */
@Composable
fun Header(title: String, onBack: (() -> Unit)?, actions: @Composable () -> Unit = {}) {
    val face = Jk.face
    Row(
        Modifier.fillMaxWidth().mastheadRule(face.ink).padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Glyphs.Back, contentDescription = "Back", tint = face.muted) }
        } else {
            Spacer(Modifier.width(14.dp))
        }
        Box(Modifier.weight(1f)) {
            if (onBack == null) Wordmark(title, size = 24.sp)
            else Text(
                title, style = MaterialTheme.typography.titleLarge, color = face.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        actions()
    }
}

/** Something to load, with its loading and failed states drawn the same way everywhere. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

suspend fun <T> attempt(block: suspend () -> T): Load<T> = try {
    Load.Ready(block())
} catch (e: CancellationException) {
    throw e
} catch (e: SignedOutException) {
    Load.Failed("Signed out.")
} catch (e: Exception) {
    Load.Failed(e.message ?: "Something went wrong.")
}

@Composable
fun <T> Loaded(state: Load<T>, retry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Lamp("Loading") }
        is Load.Failed -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Hush(state.message)
            Gap(10)
            TButton(onClick = retry) { Text("Retry") }
        }
        is Load.Ready -> content(state.value)
    }
}

/**
 * One half of a toggle group (Task / Event, a weekday): chosen is a solid chip in the accent with
 * its name knocked out; not chosen is an absence — a hairline and faint ink (.jk-chip-off).
 */
@Composable
fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    val face = Jk.face
    val shape = RoundedCornerShape(JkRadius.xs)
    if (selected) {
        Chip(face.accent, solid = true, onClick = onClick, padding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelMedium.copy(
                color = if (face.dark) face.accent else Color(0xFFF7EFDC), fontWeight = FontWeight.SemiBold, shadow = haloText(face.accent),
            ))
        }
    } else {
        Text(
            label.uppercase(),
            Modifier.clip(shape).border(1.dp, face.line, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelMedium.copy(color = face.faint),
        )
    }
}

/**
 * A dialog drawn as the suite draws one: a sheet on card stock with its title in the serif and a
 * line under it, never Material's dialog. [content] lays out the body and its actions.
 */
@Composable
fun SheetDialog(onDismiss: () -> Unit, title: String? = null, sub: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Sheet(Modifier.fillMaxWidth(), padding = PaddingValues(top = 16.dp, bottom = 10.dp)) {
            if (title != null) {
                Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 8.dp)) {
                    Text(title, style = TextStyle(fontFamily = JkFonts.Serif, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Jk.face.ink), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (!sub.isNullOrEmpty()) Text(sub, style = TextStyle(fontFamily = JkFonts.Sans, fontSize = 13.sp, color = Jk.face.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            content()
        }
    }
}

/** A sheet dialog's buttons, at its foot on the right. */
@Composable
fun DialogActions(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 14.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), content = content)
}

