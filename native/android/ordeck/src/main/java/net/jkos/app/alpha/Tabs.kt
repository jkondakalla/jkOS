package net.jkos.app.alpha

// Which tabs the app shows. Pure: no Android import, so the JVM test holds it.

/**
 * The tabs of the bottom bar, in order.
 *   Home      ORDECK, the suite's portal
 *   App       one per suite app this build can call (shell.xml's api_apps, in that order)
 *   Account   jkAuth: who you are, your devices
 */
sealed interface Tab {
    /** The suite app this tab belongs to — the id a token's `aud` names. */
    val app: String

    data object Home : Tab { override val app = "ordeck" }
    data class App(override val app: String) : Tab
    data object Account : Tab { override val app = "auth" }
}

object Tabs {
    /**
     * ⚠️ A TAB EXISTS ONLY FOR AN APP IN THE TOKEN'S `aud`. That is least privilege in the UI,
     * read from a claim the token already carries: a role that may not enter an app is not
     * shown a door to it. The servers enforce the same claim on every request, so this hides
     * nothing a person could otherwise reach; it keeps them from a screen of refusals.
     *
     * [apiApps] is the build's derived list of apps it has an API base for. An app in `aud`
     * with no base in this build gets no tab either: there is nothing the app could call.
     */
    fun forAud(aud: Set<String>, apiApps: List<String>): List<Tab> =
        (listOf(Tab.Home) + apiApps.map { Tab.App(it) } + Tab.Account).filter { it.app in aud }
}
