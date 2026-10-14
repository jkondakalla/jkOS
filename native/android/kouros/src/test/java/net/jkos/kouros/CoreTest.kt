package net.jkos.kouros

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The pure half of KourOS Alpha — everything here runs on the JVM, no device. */
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
        val url = authorizeUrl("https://staging.jkos.net", "net.jkos.kouros.alpha.staging", "net.jkos.kouros.alpha.staging:/oauth2redirect", p)
        assertEquals(
            "https://staging.jkos.net/auth/native/authorize?response_type=code&client_id=net.jkos.kouros.alpha.staging" +
                "&redirect_uri=net.jkos.kouros.alpha.staging%3A%2Foauth2redirect&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
                "&code_challenge_method=S256&state=abcdefgh12345678",
            url,
        )
    }

    @Test fun onlyTheRegisteredRedirectParses() {
        val r = "net.jkos.kouros.alpha.staging:/oauth2redirect"
        assertEquals(mapOf("code" to "c0de", "state" to "s+t/a"), parseRedirect("$r?code=c0de&state=s%2Bt%2Fa", r))
        assertEquals(mapOf("error" to "access_denied", "state" to "x"), parseRedirect("$r?error=access_denied&state=x", r))
        assertNull(parseRedirect("net.jkos.kouros.alpha.staging:/elsewhere?code=c&state=s", r)) // the filter matched the scheme only
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
        val g = Models.tokenGrant("""{"access_token":"a.b.c","token_type":"Bearer","expires_in":900,"refresh_token":"ff","user":{"id":1,"email":"e@x","name":null,"avatar_url":null,"role":"admin"}}""")
        assertEquals(TokenGrant("a.b.c", 900, "ff", User(1, "e@x", null, "admin")), g)
    }

    @Test fun aListenWithoutContextOmitsIt() {
        val with = JSONObject(Models.listenBody(Listen(4, "2026-01-01T00:00:00.000Z", 1500, true, "station/4")))
        assertEquals("station/4", with.getString("context")); assertEquals(4L, with.getLong("item_ref")); assertTrue(with.getBoolean("completed"))
        assertFalse(JSONObject(Models.listenBody(Listen(4, "2026-01-01T00:00:00.000Z", 1500, false, null))).has("context"))
    }
}
