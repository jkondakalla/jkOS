package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.auth.*

import android.os.Build
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

// The listening session's transport (TODO §10 G3): this device registered, the live event stream
// held open (reconnecting with backoff, and reopened with a fresh token on `reauth`), and the
// write doors. The web's twin is apps/kouros/src/session/client.ts. The stream goes through
// KourOS's base like every other call, with the app's Bearer token (AppApi).

/** The session as the server last said it (store.js toSession). */
data class ListeningSession(
    val rev: Long,
    val activeDevice: String?,
    val items: List<String>,
    val cursor: Int,
    val context: String?,
    val itemRef: String?,
    val positionMs: Long,
    val playing: Boolean,
    val rate: Double,
    val sleepMode: String?,
    val sleepRemainingMs: Long?,
    val reportedAt: String?,
    /** The output's shuffle and repeat ("off" | "all" | "one"), as its queue's policy says. */
    val shuffle: Boolean = false,
    val repeat: String = "off",
) {
    /** Where the session is at [serverNowMs]: the web's extrapolateMs. */
    fun positionAt(serverNowMs: Long): Long {
        var ms = positionMs.toDouble()
        val at = reportedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        if (playing && at != null) ms += max(0L, serverNowMs - at) * (if (rate > 0) rate else 1.0)
        return max(0L, ms.roundToLong())
    }
}

data class SessionDevice(val id: String, val name: String, val kind: String, val online: Boolean, val volume: Double?, val muted: Boolean)

data class SessionCommand(val id: String, val from: String?, val op: String, val args: JSONObject)

enum class LinkStatus { STARTING, LIVE, RECONNECTING, UNAVAILABLE }

data class LinkState(
    val status: LinkStatus = LinkStatus.STARTING,
    val session: ListeningSession? = null,
    val devices: List<SessionDevice> = emptyList(),
    /** The server clock minus this one's, from the sample with the shortest round trip. */
    val clockOffsetMs: Long = 0,
)

/** The session's wire shapes, and the stream's framing. Pure, so the JVM test holds them. */
object SessionWire {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k)

    fun session(o: JSONObject?): ListeningSession? {
        if (o == null) return null
        val q = o.optJSONObject("queue")
        val items = q?.optJSONArray("items") ?: JSONArray()
        return ListeningSession(
            rev = o.optLong("rev"),
            activeDevice = o.str("active_device"),
            items = (0 until items.length()).map { items.get(it).toString() },
            cursor = q?.optInt("cursor", -1) ?: -1,
            context = o.str("context"),
            itemRef = o.str("item_ref"),
            positionMs = o.optLong("position_ms"),
            playing = o.optBoolean("playing"),
            rate = o.optDouble("rate", 1.0).takeUnless { it.isNaN() } ?: 1.0,
            sleepMode = o.str("sleep_mode"),
            sleepRemainingMs = if (o.isNull("sleep_remaining_ms")) null else o.optLong("sleep_remaining_ms"),
            reportedAt = o.str("reported_at"),
            shuffle = q?.optJSONObject("policy")?.optBoolean("shuffle") == true,
            repeat = q?.optJSONObject("policy")?.optString("repeat")?.takeIf { it in setOf("off", "all", "one") } ?: "off",
        )
    }

    fun devices(a: JSONArray?): List<SessionDevice> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { i ->
        val d = a.optJSONObject(i) ?: return@mapNotNull null
        SessionDevice(
            d.optString("id"), d.str("name") ?: "A device", d.str("kind") ?: "desktop", d.optBoolean("online"),
            if (d.isNull("volume")) null else d.optDouble("volume"), d.optBoolean("muted"),
        )
    }

    fun command(o: JSONObject) = SessionCommand(o.optString("id"), o.str("from"), o.optString("op"), o.optJSONObject("args") ?: JSONObject())

    /** The web's backoffMs: 3 s doubling to 30 s, ±20 %. */
    fun backoffMs(attempt: Int, rand: Double): Long {
        val base = min(30_000.0, 3_000.0 * Math.pow(2.0, max(0, attempt).toDouble()))
        return (base * (0.8 + 0.4 * rand)).roundToLong()
    }

    /** A new device id: a version-4 UUID, as validate.js's DEVICE_ID accepts. */
    fun newDeviceId(): String = UUID.randomUUID().toString().lowercase()

    private val DEVICE_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    fun isDeviceId(s: String?) = s != null && DEVICE_ID.matches(s)
}

/**
 * Server-sent events, a line at a time (the web's parseSse, for a reader that already splits
 * lines). A blank line ends an event; `:` lines are comments (the server's pings); `data:` lines
 * join with newlines; an event with no data is no event.
 */
class SseParser {
    private var event = "message"
    private val data = mutableListOf<String>()

    /** Feed one line; returns (event, data) when [line] ends one. */
    fun feed(line: String): Pair<String, String>? {
        val l = line.removeSuffix("\r")
        if (l.isEmpty()) {
            val out = if (data.isEmpty()) null else event to data.joinToString("\n")
            event = "message"
            data.clear()
            return out
        }
        if (l.startsWith(":")) return null
        val colon = l.indexOf(':')
        val field = if (colon < 0) l else l.substring(0, colon)
        var value = if (colon < 0) "" else l.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "event" -> event = value
            "data" -> data += value
        }
        return null
    }
}

/** The one link this install keeps to the session. Process-wide: the playback service runs it. */
object SessionLink {
    private const val TAG = "KourOS"
    private const val ID_KEY = "kouros.device_id"
    private val api = AppApi("kouros")

    private val _state = MutableStateFlow(LinkState())
    val state: StateFlow<LinkState> = _state
    private val _commands = MutableSharedFlow<SessionCommand>(extraBufferCapacity = 64)
    /** Commands addressed to this device (the server sends them to the output only, and volume by name). */
    val commands: SharedFlow<SessionCommand> = _commands

    /** This device's part, as the playback service's SessionOutput last decided it. The screens
     *  read it: as a REMOTE, what they play is sent to the output as a command. */
    internal val role = MutableStateFlow(SessionMode.SOLO)

    private var job: Job? = null
    private var scope: CoroutineScope? = null
    private var clockRtt = Long.MAX_VALUE

    /** This install's device id: made once, kept in the sealed prefs. One install is one device. */
    val deviceId: String by lazy {
        Auth.pref(ID_KEY)?.takeIf(SessionWire::isDeviceId) ?: SessionWire.newDeviceId().also { Auth.setPref(ID_KEY, it) }
    }

    fun serverNow(): Long = System.currentTimeMillis() + _state.value.clockOffsetMs

    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        this.scope = scope
        job = scope.launch { run() }
    }

    fun stop() {
        job?.cancel()
        job = null
        _state.value = LinkState()
        role.value = SessionMode.SOLO
    }

    private fun emit(f: (LinkState) -> LinkState) { _state.value = f(_state.value) }

    private fun adopt(s: ListeningSession?) {
        if (s == null) return
        val have = _state.value.session
        if (have == null || s.rev >= have.rev) emit { it.copy(session = s) }
    }

    private suspend fun run() {
        var attempt = 0
        var registered = false
        while (true) {
            try {
                if (!registered) {
                    when (register()) {
                        Registered.OK -> registered = true
                        Registered.UNAVAILABLE -> { emit { it.copy(status = LinkStatus.UNAVAILABLE) }; return }
                        Registered.RETRY -> { delay(SessionWire.backoffMs(attempt++, Math.random())); continue }
                    }
                }
                val (ended, hello) = stream()
                if (hello) attempt = 0
                when (ended) {
                    Ended.UNAVAILABLE -> { emit { it.copy(status = LinkStatus.UNAVAILABLE) }; return }
                    Ended.UNKNOWN_DEVICE -> { registered = false; continue }
                    Ended.REAUTH -> continue
                    Ended.DROPPED -> Unit
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOutException) {
                emit { it.copy(status = LinkStatus.UNAVAILABLE) }
                return
            } catch (e: Exception) {
                Log.w(TAG, "session link: ${e.message}")
            }
            emit { it.copy(status = LinkStatus.RECONNECTING) }
            delay(SessionWire.backoffMs(attempt++, Math.random()))
        }
    }

    private enum class Registered { OK, UNAVAILABLE, RETRY }
    private enum class Ended { REAUTH, UNKNOWN_DEVICE, UNAVAILABLE, DROPPED }

    private fun identity(volume: Float? = null): JSONObject = JSONObject().apply {
        put("deviceId", deviceId)
        // A starting name: the listener can rename it on the web, and re-registering keeps theirs.
        put("name", "${Build.MODEL ?: "Android"} (jkOS Alpha)".take(60))
        put("kind", "phone")
        put("platform", "Android")
        if (volume != null) put("volume", volume.coerceIn(0f, 1f).toDouble())
    }

    private suspend fun register(): Registered = try {
        api.call("POST", "/api/session/devices", identity().toString())
        Registered.OK
    } catch (e: ApiException) {
        if (e.code == 404 || e.code == 403 || e.code == 401) Registered.UNAVAILABLE else Registered.RETRY
    }

    private suspend fun stream(): Pair<Ended, Boolean> {
        val sse = SseParser()
        var hello = false
        val status = try { api.stream("/api/session/events?device=$deviceId") { line ->
            val (event, data) = sse.feed(line) ?: return@stream
            val o = runCatching { JSONObject(data) }.getOrNull() ?: return@stream
            when (event) {
                "hello" -> {
                    hello = true
                    emit { it.copy(status = LinkStatus.LIVE, devices = SessionWire.devices(o.optJSONArray("devices"))) }
                    adopt(SessionWire.session(o.optJSONObject("session")))
                    sampleClock(o.optString("serverNow"), sentAt = null)
                    scope?.launch { refreshSnapshot() }   // a timed clock sample, as the web takes on hello
                }
                "session" -> adopt(SessionWire.session(o.optJSONObject("session")))
                "devices" -> emit { it.copy(devices = SessionWire.devices(o.optJSONArray("devices"))) }
                "command" -> _commands.tryEmit(SessionWire.command(o))
                // The token is about to expire: the server ends the stream, and it reopens with a fresh one.
                "reauth" -> throw ReauthException()
            }
        } } catch (e: ReauthException) {
            return Ended.REAUTH to hello
        }
        return when {
            status == 404 -> Ended.UNKNOWN_DEVICE to hello
            status == 401 || status == 403 -> Ended.UNAVAILABLE to hello
            else -> Ended.DROPPED to hello
        }
    }

    private class ReauthException : java.io.IOException("reauth")

    /** One clock sample; the shortest round trip wins (the web's betterClock). */
    private fun sampleClock(serverNow: String?, sentAt: Long?) {
        val server = serverNow?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return
        val now = System.currentTimeMillis()
        val rtt = if (sentAt != null) now - sentAt else Long.MAX_VALUE - 1
        if (rtt > clockRtt) return
        clockRtt = rtt
        val mid = if (sentAt != null) (sentAt + now) / 2 else now
        emit { it.copy(clockOffsetMs = server - mid) }
    }

    // ── the write doors ──

    /** The output's report. A 409 NOT_ACTIVE means another device is the output now. */
    suspend fun report(body: JSONObject): Int = try {
        val r = api.call("POST", "/api/session/state", body.toString())
        adopt(SessionWire.session(runCatching { JSONObject(r.text).optJSONObject("session") }.getOrNull()))
        r.code
    } catch (e: ApiException) {
        e.code
    }

    /** A command to the output, with the suite's idempotency key so a retry is one command. */
    suspend fun command(op: String, args: JSONObject = JSONObject()): Int {
        val body = SessionCore.commandBody(op, args, deviceId, UUID.randomUUID().toString())
        return try { api.call("POST", "/api/session/commands", body.toString()).code } catch (e: ApiException) { e.code }
    }

    /** Make [to] the output. [play] null keeps the session's playing state. */
    suspend fun transfer(to: String, play: Boolean? = null): Boolean = try {
        val body = JSONObject().put("to", to).apply { if (play != null) put("play", play) }
        val r = api.call("POST", "/api/session/transfer", body.toString())
        adopt(SessionWire.session(runCatching { JSONObject(r.text).optJSONObject("session") }.getOrNull()))
        true
    } catch (e: ApiException) {
        false
    }

    /** GET /api/session: the snapshot and a timed clock sample. */
    suspend fun refreshSnapshot(sentAt: Long = System.currentTimeMillis()) {
        val o = runCatching { JSONObject(api.get("/api/session")) }.getOrNull() ?: return
        sampleClock(o.optString("serverNow"), sentAt)
        adopt(SessionWire.session(o.optJSONObject("session")))
        emit { it.copy(devices = SessionWire.devices(o.optJSONArray("devices"))) }
    }
}
