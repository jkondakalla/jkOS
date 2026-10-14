package net.jkos.selector

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.google.androidbrowserhelper.trusted.LauncherActivity

/**
 * jkOS Alpha's home: one row per suite app, from the generated selector_names/selector_urls.
 * A tap starts LauncherActivity on that URL, which opens it as a Trusted Web Activity; Back
 * from the app comes back here.
 *
 * The URLs are resources this APK was built with — nothing here builds a URL from input, and
 * LauncherActivity is not exported, so the list is the only thing that can start a session.
 */
class SelectorActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_selector)

        val version = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        findViewById<TextView>(R.id.build).text = getString(
            R.string.build_line, getString(R.string.channel).uppercase(), getString(R.string.environment), version,
        )

        val names = resources.getStringArray(R.array.selector_names)
        val urls = resources.getStringArray(R.array.selector_urls)
        check(names.size == urls.size) { "selector_names and selector_urls differ in length" }

        val list = findViewById<LinearLayout>(R.id.apps)
        names.zip(urls).forEachIndexed { i, (name, url) ->
            if (i > 0) list.addView(rule())
            val row = layoutInflater.inflate(R.layout.selector_item, list, false)
            row.findViewById<TextView>(R.id.name).text = name
            row.findViewById<TextView>(R.id.url).text = url.removePrefix("https://")
            row.setOnClickListener { open(url) }
            list.addView(row)
        }
    }

    private fun open(url: String) {
        // NEW_TASK: LauncherActivity relaunches itself with it otherwise. The task affinity is
        // ours, so the app still opens above this list and Back returns to it.
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .setClass(this, LauncherActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, getString(R.string.no_browser, url), Toast.LENGTH_LONG).show()
        }
    }

    private fun rule() = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, resources.displayMetrics.density.toInt().coerceAtLeast(1))
        setBackgroundColor(getColor(R.color.selector_rule))
    }
}
