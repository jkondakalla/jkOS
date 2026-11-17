package net.jkos.app.alpha

import net.jkos.app.alpha.auth.AccountModels
import net.jkos.app.alpha.auth.AuthModels
import net.jkos.app.alpha.auth.ThemeMode
import net.jkos.app.alpha.auth.Claims
import net.jkos.app.alpha.auth.Pkce
import net.jkos.app.alpha.auth.TokenGrant
import net.jkos.app.alpha.auth.User
import net.jkos.app.alpha.auth.authorizeUrl
import net.jkos.app.alpha.auth.constantTimeEquals
import net.jkos.app.alpha.auth.parseRedirect
import net.jkos.app.alpha.kouros.Album
import net.jkos.app.alpha.kouros.Listen
import net.jkos.app.alpha.kouros.ListenLedger
import net.jkos.app.alpha.kouros.Models
import net.jkos.app.alpha.kouros.PlayContext
import java.util.Base64

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The pure half of jkOS Alpha — everything here runs on the JVM, no device. */
class PkceTest {
    @Test fun rfc7636AppendixBVector() {
        // RFC 7636 Appendix B: the published verifier → challenge pair.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun freshAttemptsAreWellFormedAndDistinct() {
        val a = Pkce.create()
        val b = Pkce.create()
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a.verifier)) // 32 bytes, base64url, no padding
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a.challenge))
        assertTrue(Regex("^[A-Za-z0-9_-]{22}$").matches(a.state))
        assertEquals(Pkce.challengeOf(a.verifier), a.challenge)
        assertNotEquals(a.verifier, b.verifier)
        assertNotEquals(a.state, b.state)
        assertEquals(a.challenge, Pkce.restore(a.verifier, a.state).challenge)
    }

    @Test fun authorizeUrlCarriesS256AndEveryParameter() {
        val p = Pkce.restore("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "abcdefgh12345678")
        val url = authorizeUrl("https://staging.jkos.net", "net.jkos.app.alpha.staging", "net.jkos.app.alpha.staging:/oauth2redirect", p)
        assertEquals(
            "https://staging.jkos.net/auth/native/authorize?response_type=code&client_id=net.jkos.app.alpha.staging" +
                "&redirect_uri=net.jkos.app.alpha.staging%3A%2Foauth2redirect&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
                "&code_challenge_method=S256&state=abcdefgh12345678",
            url,
        )
    }

    @Test fun onlyTheRegisteredRedirectParses() {
        val r = "net.jkos.app.alpha.staging:/oauth2redirect"
        assertEquals(mapOf("code" to "c0de", "state" to "s+t/a"), parseRedirect("$r?code=c0de&state=s%2Bt%2Fa", r))
        assertEquals(mapOf("error" to "access_denied", "state" to "x"), parseRedirect("$r?error=access_denied&state=x", r))
        assertNull(parseRedirect("net.jkos.app.alpha.staging:/elsewhere?code=c&state=s", r)) // the filter matched the scheme only
        assertNull(parseRedirect("net.jkos.kouros.alpha:/oauth2redirect?code=c&state=s", r)) // the other environment's app
        assertNull(parseRedirect("$r#code=c", r))
        assertNull(parseRedirect(r, r)) // no query at all
        assertNull(parseRedirect("$r?code=a&code=b&state=s", r)) // ambiguous: refused, not guessed
    }

    @Test fun stateComparison() {
        assertTrue(constantTimeEquals("abc", "abc"))
        assertFalse(constantTimeEquals("abc", "abd"))
        assertFalse(constantTimeEquals("abc", "abcd"))
    }
}

/** Held to native/play-context-cases.json — the same vectors test/native.mjs runs through
 *  JavaScript's encodeURIComponent and the server's own parser. */
class PlayContextTest {
    private val doc = JSONObject(File(System.getProperty("jkos.playContextCases") ?: error("jkos.playContextCases not set")).readText())

    private fun JSONObject.expect(): String? = if (isNull("expect")) null else getString("expect")

    @Test fun maxLenMatchesTheServer() = assertEquals(doc.getInt("maxLen"), PlayContext.MAX_LEN)

    @Test fun everyCase() {
        val cases: JSONArray = doc.getJSONArray("cases")
        assertTrue("too few cases to mean anything", cases.length() >= 20)
        val wrong = mutableListOf<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val got = when (c.getString("kind")) {
                "encode" -> PlayContext.encodeComponent(c.getString("input"))
                "album" -> PlayContext.album(c.getString("artist"), c.getString("album"))
                "artist" -> PlayContext.artist(c.getString("artist"))
                "station" -> PlayContext.station(c.getLong("id"))
                "playlist" -> PlayContext.playlist(c.getLong("id"))
                else -> error("unknown kind ${c.getString("kind")}")
            }
            if (got != c.expect()) wrong += "#$i ${c.getString("kind")}: expected ${c.expect()}, got $got"
        }
        assertTrue(wrong.joinToString("\n"), wrong.isEmpty())
    }
}

class ListenLedgerTest {
    private var now = 1_700_000_000_000L
    private val ledger = ListenLedger { now }

    @Test fun aStretchUnderOneSecondIsNotAListen() {
        ledger.start(7, "album/a/b")
        now += 999
        assertNull(ledger.close(10_000, 200_000))
        assertFalse(ledger.isOpen)
    }

    @Test fun aStretchIsOneRowWithItsStartAndContext() {
        ledger.start(7, "album/a/b")
        val started = ListenLedger.iso(now)
        now += 42_000
        assertEquals(Listen(7, started, 42_000, false, "album/a/b"), ledger.close(42_000, 200_000))
    }

    @Test fun completedNearTheEndOrWhenThePlayerMovedOn() {
        ledger.start(1, null); now += 5_000
        assertTrue(ledger.close(199_500, 200_000)!!.completed)
        ledger.start(1, null); now += 5_000
        assertTrue(ledger.close(0, 200_000, forcedCompleted = true)!!.completed)
        ledger.start(1, null); now += 5_000
        assertFalse(ledger.close(150_000, 200_000)!!.completed)
        ledger.start(1, null); now += 5_000
        assertFalse(ledger.close(0, 0)!!.completed) // unknown duration: never guessed complete
    }

    @Test fun startingTheSameItemAgainKeepsTheStretch() {
        ledger.start(3, null)
        val started = ListenLedger.iso(now)
        now += 2_000
        ledger.start(3, null)
        now += 2_000
        assertEquals(started, ledger.close(0, 0)!!.startedAt)
    }

    @Test fun closingWithNothingOpenIsNothing() = assertNull(ledger.close(0, 0))

    @Test fun timestampsAreJavaScriptsToISOString() {
        assertEquals("1970-01-01T00:00:00.000Z", ListenLedger.iso(0))
        assertEquals("2023-11-14T22:13:20.007Z", ListenLedger.iso(1_700_000_000_007L))
    }
}

class ModelsTest {
    @Test fun albumsTolerateNulls() {
        val a = Models.albums("""[{"album":"Kid A","artist":"Radiohead","year":null,"tracks":10,"duration":2997,"added":"x","anchor_id":5,"cover_id":null}]""")
        assertEquals(Album("Kid A", "Radiohead", null, 10, 2997, 5, null), a.single())
    }

    @Test fun tracksFromAnAlbumAndFromARadio() {
        val t = Models.albumTracks("""[{"id":9,"title":"Idioteque","artist":"Radiohead","album":"Kid A","albumartist":null,"track_no":8,"disc_no":1,"year":2000,"genres":[],"duration":309.4,"cover_path":"/data/c/9.jpg"}]""").single()
        assertEquals(9, t.id); assertEquals(8, t.trackNo); assertNull(t.albumArtist); assertTrue(t.hasCover); assertEquals(309.4, t.durationSec, 0.0)
        val r = Models.radio("""{"basis":"mesh","results":[{"id":11,"title":"X","artist":null,"album":null,"year":null,"duration":1,"has_cover":false}]}""").single()
        assertEquals(11, r.id); assertFalse(r.hasCover); assertNull(r.artist)
        assertTrue(Models.radio("""{"basis":"none"}""").isEmpty())
    }

    @Test fun tokenGrant() {
        val g = AuthModels.tokenGrant("""{"access_token":"a.b.c","token_type":"Bearer","expires_in":900,"refresh_token":"ff","user":{"id":1,"email":"e@x","name":null,"avatar_url":null,"role":"admin"}}""")
        assertEquals(TokenGrant("a.b.c", 900, "ff", User(1, "e@x", null, "admin"), familyId = null), g)
    }

    @Test fun aListenWithoutContextOmitsIt() {
        val with = JSONObject(Models.listenBody(Listen(4, "2026-01-01T00:00:00.000Z", 1500, true, "station/4")))
        assertEquals("station/4", with.getString("context")); assertEquals(4L, with.getLong("item_ref")); assertTrue(with.getBoolean("completed"))
        assertFalse(JSONObject(Models.listenBody(Listen(4, "2026-01-01T00:00:00.000Z", 1500, false, null))).has("context"))
    }
}

/** The audience claim, and the tabs it allows. */
class AudienceTest {
    private fun token(payload: String) =
        "eyJhbGciOiJSUzI1NiJ9." + Base64.getUrlEncoder().withoutPadding().encodeToString(payload.toByteArray()) + ".sig"

    private val apiApps = listOf("beigeboard", "kouros")

    @Test fun audIsReadFromTheTokensPayload() {
        assertEquals(setOf("auth", "ordeck", "kouros"), Claims.audOf(token("""{"sub":"7","aud":["auth","ordeck","kouros"]}""")))
        assertEquals(setOf("auth"), Claims.audOf(token("""{"aud":"auth"}""")))
    }

    @Test fun anythingThatIsNotATokenHasNoAudience() {
        assertEquals(emptySet<String>(), Claims.audOf(""))
        assertEquals(emptySet<String>(), Claims.audOf("not.a.token"))
        assertEquals(emptySet<String>(), Claims.audOf("only.two"))
        assertEquals(emptySet<String>(), Claims.audOf(token("""{"sub":"7"}""")))
        assertEquals(emptySet<String>(), Claims.audOf(token("""{"aud":7}""")))
        assertEquals(setOf("auth"), Claims.audOf(token("""{"aud":["auth",7,null]}"""))) // only strings count
    }

    @Test fun aUserGetsEveryTabInOrder() {
        val aud = setOf("auth", "beigeboard", "ordeck", "lazuros", "kouros")
        assertEquals(listOf(Tab.Home, Tab.App("beigeboard"), Tab.App("kouros"), Tab.Account), Tabs.forAud(aud, apiApps))
    }

    @Test fun aTabExistsOnlyForAnAppInTheAudience() {
        // A guest's token: jkAuth and BeigeBoard, neither ORDECK nor KourOS.
        assertEquals(listOf(Tab.App("beigeboard"), Tab.Account), Tabs.forAud(setOf("auth", "beigeboard"), apiApps))
        assertEquals(listOf(Tab.Home, Tab.Account), Tabs.forAud(setOf("auth", "ordeck"), apiApps))
        assertEquals(emptyList<Tab>(), Tabs.forAud(emptySet(), apiApps))
    }

    @Test fun anAppTheBuildHasNoBaseForGetsNoTab() {
        // LazurOS is in a user's aud but this build has no API base for it.
        assertEquals(listOf(Tab.Home, Tab.Account), Tabs.forAud(setOf("auth", "ordeck", "lazuros"), emptyList()))
    }
}

/** jkAuth's account shapes: the profile, the devices list, and the bodies the app sends. */
class AccountTest {
    @Test fun theProfileCarriesTheModeAndTheVersion() {
        val p = AccountModels.profile("""{"user":{"id":3,"email":"a@b.c","name":"Ann","role":"user"},"preferences":{"theme":{"mode":"dark","primary":"#ffb000","secondary":"#4ecdc4"}},"prefs_version":7}""")
        assertEquals("Ann", p.user.name)
        assertEquals(ThemeMode.Dark, p.themeMode)
        assertEquals(7, p.prefsVersion)
    }

    @Test fun aMissingOrUnknownModeIsSystem() {
        val bare = """{"user":{"id":3,"email":"a@b.c","name":null,"role":"user"},"preferences":{}}"""
        assertEquals(ThemeMode.System, AccountModels.profile(bare).themeMode)
        assertEquals(0, AccountModels.profile(bare).prefsVersion)
        assertEquals(ThemeMode.System, ThemeMode.of("sepia"))
        assertEquals(ThemeMode.Light, ThemeMode.of("light"))
        // The legacy nested theme keeps `mode` at its top too.
        val legacy = """{"user":{"id":3,"email":"a@b.c","name":null,"role":"user"},"preferences":{"theme":{"mode":"light","dark":{"primary":"#fff"}}}}"""
        assertEquals(ThemeMode.Light, AccountModels.profile(legacy).themeMode)
    }

    @Test fun darkIsTheChoiceOrTheDevice() {
        assertTrue(ThemeMode.Dark.isDark(systemDark = false))
        assertFalse(ThemeMode.Light.isDark(systemDark = true))
        assertTrue(ThemeMode.System.isDark(systemDark = true))
        assertFalse(ThemeMode.System.isDark(systemDark = false))
    }

    private val sessions = """{"sessions":[
        {"family_id":"f-browser","created_at":"2026-11-10T08:00:00.000Z","last_used_at":"2026-11-16T09:00:00.000Z","remember_me":true,"revoked":false,"revoked_reason":null,"client_id":null,"rotations":4,"current":false},
        {"family_id":"f-old","created_at":"2026-10-01T08:00:00.000Z","last_used_at":"2026-10-02T09:00:00.000Z","remember_me":false,"revoked":true,"revoked_reason":"logout","client_id":null,"rotations":1,"current":false},
        {"family_id":"f-me","created_at":"2026-11-16T07:00:00.000Z","last_used_at":"2026-11-16T08:00:00.000Z","remember_me":true,"revoked":false,"revoked_reason":null,"client_id":"net.jkos.app.alpha.staging","rotations":2,"current":false}
    ]}"""

    @Test fun thisDeviceIsTheFamilyTheTokenEndpointNamed() {
        val d = AccountModels.devices(sessions, "f-me")
        assertEquals(listOf("f-me", "f-browser", "f-old"), d.map { it.familyId }) // mine, the live ones, the signed-out ones
        assertEquals(listOf(true, false, false), d.map { it.isThisDevice })
        assertEquals("net.jkos.app.alpha.staging", d[0].clientId)
        assertNull(d[1].clientId)
        assertTrue(d[2].revoked)
        assertEquals("logout", d[2].revokedReason)
    }

    @Test fun withNoFamilyNamedNothingIsMarked() {
        val d = AccountModels.devices(sessions, null)
        assertTrue(d.none { it.isThisDevice })
        assertEquals(listOf("f-browser", "f-me", "f-old"), d.map { it.familyId }) // the server's order, signed-out last
        assertEquals(emptyList<Any>(), AccountModels.devices("{}", "f-me"))
    }

    @Test fun theBodiesTheAppSends() {
        assertEquals("""{"name":"Ann B"}""", AccountModels.nameBody("Ann B"))
        val theme = JSONObject(AccountModels.themeBody(ThemeMode.Light, 7))
        assertEquals(7, theme.getInt("prefs_version"))
        // Only the mode: the server deep-merges, so the accent pair and every other slice stay.
        assertEquals("""{"theme":{"mode":"light"}}""", theme.getJSONObject("preferences").toString())
        assertEquals("""{"family_id":"f-browser"}""", AccountModels.revokeBody("f-browser"))
    }

    @Test fun aGrantNamesTheSessionWhenTheServerDoes() {
        val user = """{"id":1,"email":"a@b.c","name":null,"role":"admin"}"""
        assertEquals("fam-1", AuthModels.tokenGrant("""{"access_token":"a","expires_in":900,"refresh_token":"r","family_id":"fam-1","user":$user}""").familyId)
        assertNull(AuthModels.tokenGrant("""{"access_token":"a","expires_in":900,"refresh_token":"r","user":$user}""").familyId)
    }
}
