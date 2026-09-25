package net.jkos.home

import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The device's own apps, behind CornerHold. Settings and "Choose home app" come first:
 * whatever state the portal is in, this is the way out — to fix Wi-Fi, or to hand the device
 * back to a normal launcher.
 *
 * It sees only apps with a launcher icon: the manifest's <queries> names exactly the
 * MAIN/LAUNCHER intent, not QUERY_ALL_PACKAGES.
 */
class DrawerActivity : ComponentActivity() {

    private class Entry(val label: String, val icon: Drawable?, val intent: Intent)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_drawer)
        val list = findViewById<ListView>(R.id.list)
        ViewCompat.setOnApplyWindowInsetsListener(list) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val entries = listOf(
            Entry(getString(R.string.drawer_settings), getDrawable(android.R.drawable.ic_menu_preferences), Intent(Settings.ACTION_SETTINGS)),
            Entry(getString(R.string.drawer_home_app), getDrawable(android.R.drawable.ic_menu_revert), Intent(Settings.ACTION_HOME_SETTINGS)),
        ) + launchable()

        list.adapter = Adapter(entries)
        list.setOnItemClickListener { _, _, position, _ ->
            runCatching { startActivity(entries[position].intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            finish()
        }
    }

    private fun launchable(): List<Entry> {
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION") // the flags overload is API 33+; minSdk is 26
        val found = packageManager.queryIntentActivities(main, 0)
        return found.filter { it.activityInfo.packageName != packageName }
            .map { ri ->
                Entry(
                    ri.loadLabel(packageManager).toString(),
                    ri.loadIcon(packageManager),
                    Intent(main).setClassName(ri.activityInfo.packageName, ri.activityInfo.name)
                        .addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED),
                )
            }
            .sortedBy { it.label.lowercase() }
    }

    private class Adapter(private val entries: List<Entry>) : BaseAdapter() {
        override fun getCount() = entries.size
        override fun getItem(position: Int) = entries[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView ?: View.inflate(parent.context, R.layout.drawer_item, null)
            val e = entries[position]
            view.findViewById<ImageView>(R.id.icon).setImageDrawable(e.icon)
            view.findViewById<TextView>(R.id.label).text = e.label
            return view
        }
    }
}
