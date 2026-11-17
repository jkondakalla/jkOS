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
import net.jkos.app.alpha.kouros.Playlist
import net.jkos.app.alpha.kouros.BookFile
import net.jkos.app.alpha.kouros.BookLayout
import net.jkos.app.alpha.kouros.BookModels
import net.jkos.app.alpha.kouros.Chapter
import net.jkos.app.alpha.kouros.MediaRef
import net.jkos.app.alpha.kouros.Rates
import net.jkos.app.alpha.kouros.SleepState
import net.jkos.app.alpha.kouros.SleepTimer
import net.jkos.app.alpha.kouros.ModeFacts
import net.jkos.app.alpha.kouros.SessionCore
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
                "book" -> PlayContext.book(c.getLong("id"))
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

    @Test fun aBookIsItsOwnListenApartFromATrackWithItsId() {
        ledger.start(7, "album/a/b")
        now += 5_000
        ledger.start(7, null, book = true)      // book 7 is not track 7: the track's stretch is replaced
        assertTrue(ledger.isOpenFor(7, book = true)); assertFalse(ledger.isOpenFor(7, book = false))
        now += 2_000
        val row = ledger.close(60_000, 3_600_000)!!
        assertTrue(row.book); assertNull(row.context); assertEquals(2_000, row.msPlayed); assertFalse(row.completed)
    }

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

    @Test fun aPlaylistReadsItsRefsWhateverTheyWereWrittenAs() {
        // The web writes numbers; a numeric string reads as its number; anything else is dropped.
        val p = Models.playlists("""[{"id":3,"name":"Run","description":null,"track_refs":[12,"7",1.5,"x",null,-2],"updated_at":"t"}]""").single()
        assertEquals(Playlist(3, "Run", null, listOf(12L, 7L)), p)
        assertEquals(emptyList<Long>(), Models.playlist("""{"id":4,"name":"Empty","track_refs":null}""").trackRefs)
    }

    @Test fun thePlaylistBodiesCarryOnlyWhatChanges() {
        assertEquals("""{"name":"Run"}""", Models.playlistBody(name = "Run"))
        assertEquals("""{"track_refs":[3,1,2]}""", Models.playlistBody(trackRefs = listOf(3L, 1L, 2L)))
        val both = JSONObject(Models.playlistBody("New", emptyList()))   // org.json's key order is a HashMap's
        assertEquals(2, both.length()); assertEquals("New", both.getString("name")); assertEquals(0, both.getJSONArray("track_refs").length())
    }

    @Test fun rowsReadByIdComeBackInTheIdsOrder() {
        // The dataset answers in catalog order; the playlist's order is the ids'. A vanished id is skipped.
        val rows = Models.tracks("""[{"id":1,"title":"A"},{"id":2,"title":"B"},{"id":3,"title":"C"}]""")
        assertEquals(listOf(3L, 1L, 3L), Models.inOrder(listOf(3L, 9L, 1L, 3L), rows).map { it.id })
    }
}

/** The arithmetic under drag-to-reorder: the queue and a playlist both use it. */
class ReorderTest {
    @Test fun theDropIsTheNearestWholeRowInsideTheList() {
        assertEquals(2, Reorder.target(2, 20f, 56f, 5))    // under half a row: stays
        assertEquals(3, Reorder.target(2, 30f, 56f, 5))    // over half: one down
        assertEquals(0, Reorder.target(2, -500f, 56f, 5))  // past the top: first
        assertEquals(4, Reorder.target(2, 500f, 56f, 5))   // past the bottom: last
        assertEquals(1, Reorder.target(1, 80f, 0f, 3))     // rows not measured yet: nowhere
    }

    @Test fun theRowsBetweenSlideAsideTowardTheGap() {
        // Row 1 held over row 3: rows 2 and 3 move up one; 0 and 4 stay.
        assertEquals(listOf(0, 0, -1, -1, 0), (0..4).map { Reorder.shift(it, 1, 3) })
        // Row 3 held over row 1: rows 1 and 2 move down one.
        assertEquals(listOf(0, 1, 1, 0, 0), (0..4).map { Reorder.shift(it, 3, 1) })
    }

    @Test fun aMoveIsRemoveThenInsertAsMedia3Does() {
        assertEquals(listOf("b", "c", "a", "d"), Reorder.move(listOf("a", "b", "c", "d"), 0, 2))
        assertEquals(listOf("d", "a", "b", "c"), Reorder.move(listOf("a", "b", "c", "d"), 3, 0))
        assertEquals(listOf("a", "b"), Reorder.move(listOf("a", "b"), 1, 5))
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

/** Audiobooks: the shapes, a book's files and chapters, and the bodies the app sends. */
class BooksTest {
    private val layout = BookLayout(
        listOf(BookFile(1, 600.0), BookFile(0, 1200.0)),   // out of order on purpose: play order is by index
        listOf(Chapter(0.0, 900.0, "One"), Chapter(900.0, 1500.0, "Two"), Chapter(1500.0, 1800.0, "Three")),
    )

    @Test fun aPositionInTheBookIsAFileAndAnOffset() {
        assertEquals(1_800_000L, layout.totalMs)
        assertEquals(0 to 0L, layout.locate(0))
        assertEquals(0 to 1_199_000L, layout.locate(1_199_000))
        assertEquals(1 to 0L, layout.locate(1_200_000))          // on a boundary: the later file
        assertEquals(1 to 600_000L, layout.locate(9_999_999))    // past the end: the end
        assertEquals(0 to 0L, layout.locate(-5))
        assertEquals(1_200_000L, layout.startOf(1))
        assertEquals(1, layout.files[1].index)
    }

    @Test fun chaptersAcrossTheFiles() {
        assertEquals(0, layout.chapterAt(899_999)); assertEquals(1, layout.chapterAt(900_000)); assertEquals(-1, layout.chapterAt(1_800_000))
        assertEquals(1_500_000L, layout.nextChapterStart(1_000_000)); assertNull(layout.nextChapterStart(1_600_000))
        // Back: this chapter's start, or the one before within its first three seconds.
        assertEquals(900_000L, layout.previousChapterStart(1_000_000))
        assertEquals(0L, layout.previousChapterStart(901_000))
        assertEquals(0L, layout.previousChapterStart(1_000))
    }

    @Test fun aQueueEntryIsATrackOrABooksFile() {
        assertEquals(MediaRef.TrackRef(12), MediaRef.parse("12"))
        assertEquals(MediaRef.BookFileRef(7, 2), MediaRef.parse(MediaRef.of(7, 2)))
        for (junk in listOf("-1", "book:7", "book:x:0", "book:7:-1", "track:7:0", "book:7:0:1", "")) assertNull(junk, MediaRef.parse(junk))
    }

    @Test fun bookRefsArriveAsTextAndAreCoercedAtOneDoor() {
        val p = BookModels.progress("""[{"id":1,"book_ref":"13","position":61.5,"duration":3600,"finished":false,"last_played":"t"},{"id":2,"book_ref":"x","position":1}]""")
        assertEquals(1, p.size); assertEquals(13L, p[0].bookId); assertEquals(1L, p[0].id); assertEquals(61.5, p[0].positionSec, 0.0)
        val b = BookModels.bookmarks("""[{"id":4,"book_ref":13,"position":90,"title":null,"note":null}]""").single()
        assertEquals(13L, b.bookId); assertNull(b.title)
    }

    @Test fun aBooksDetailCarriesItsFilesAndChapters() {
        val d = BookModels.detail("""{"id":3,"title":"Dune","author":"Frank Herbert","narrator":null,"series":null,"series_seq":null,"year":1965,"duration":75000,"cover_path":"covers/3.jpg","description":"<p>Arrakis &amp; spice</p>","files":[{"index":0,"duration":75000,"codec":"aac","compat_ready":false}],"chapters":[{"start":0,"end":600,"title":""}]}""")
        assertEquals("Dune", d.book.title); assertTrue(d.book.hasCover); assertEquals(1965, d.book.year)
        assertEquals(listOf(BookFile(0, 75000.0)), d.files)
        assertEquals("Chapter 1", d.chapters.single().title)                // a blank title gets a name
        assertEquals("Arrakis & spice", BookModels.plain(d.description))    // HTML flattened, never rendered
        assertEquals("Frank Herbert", BookModels.byline(d.book))
    }

    @Test fun theBodiesTheBookHalfSends() {
        val p = JSONObject(BookModels.progressBody(13, 61_500, 3_600_000, false, "2026-11-17T00:00:00.000Z"))
        assertEquals(13L, p.getLong("book_ref")); assertEquals(61.5, p.getDouble("position"), 0.0); assertEquals(3600.0, p.getDouble("duration"), 0.0)
        assertFalse(p.getBoolean("finished")); assertEquals("2026-11-17T00:00:00.000Z", p.getString("last_played"))
        assertFalse(JSONObject(BookModels.bookmarkBody(13, 1_000, "  ")).has("title"))
        val l = JSONObject(BookModels.bookListenBody(net.jkos.app.alpha.kouros.Listen(13, "t", 5_000, true, "album/x/y", book = true)))
        assertFalse(l.has("context")); assertEquals(13L, l.getLong("item_ref"))
    }

    @Test fun ratesCycleThroughTheEnginesPresets() {
        assertEquals(listOf(0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f), Rates.PRESETS)
        assertEquals(1.25f, Rates.next(1f)); assertEquals(0.75f, Rates.next(2.5f))
        assertEquals(listOf("0.75×", "1×", "1.5×", "2.5×"), listOf(0.75f, 1f, 1.5f, 2.5f).map(Rates::label))
    }

    @Test fun theSleepTimer() {
        val t = SleepTimer.plan("15", nowMs = 1_000, chapterEndMs = null)
        assertEquals(1_000 + 15 * 60_000L, t.deadlineMs); assertFalse(t.due(900_000, 0)); assertTrue(t.due(901_000, 0))
        val c = SleepTimer.plan(SleepState.CHAPTER, 0, chapterEndMs = 900_000)
        assertFalse(c.due(0, 899_000)); assertTrue(c.due(0, 899_750))     // a quarter second early
        assertFalse(SleepTimer.plan(SleepState.CHAPTER, 0, null).on)       // no chapter to end: off
        assertFalse(SleepTimer.plan("90", 0, null).on)                     // not a mode: off
    }
}

/** The listening session's pure half, held to the two case files the web and the server pass too. */
class SessionTest {
    private fun cases(prop: String) = JSONObject(File(System.getProperty(prop) ?: error("$prop not set")).readText())

    private fun JSONObject.strOrNull(k: String) = if (isNull(k)) null else getString(k)

    /** JSON as plain values, numbers as doubles, so two bodies compare by content, not key order. */
    private fun canon(v: Any?): Any? = when (v) {
        is JSONObject -> v.keys().asSequence().associateWith { canon(v.opt(it)) }.toSortedMap()
        is JSONArray -> (0 until v.length()).map { canon(v.opt(it)) }
        is Number -> v.toDouble()
        JSONObject.NULL -> null
        else -> v
    }

    @Test fun theRoleIsRouteTsModeOf() {
        val doc = cases("jkos.sessionModeCases").getJSONArray("cases")
        val wrong = (0 until doc.length()).mapNotNull { i ->
            val c = doc.getJSONObject(i)
            val f = c.getJSONObject("facts")
            val got = SessionCore.modeOf(
                ModeFacts(f.getBoolean("available"), f.strOrNull("active"), f.getString("me"), f.getBoolean("activeOnline"), f.getBoolean("holdsLock"), f.getBoolean("lockElsewhere")),
            ).wire
            if (got == c.getString("expect")) null else "#$i $f: expected ${c.getString("expect")}, got $got"
        }
        assertTrue(wrong.joinToString("\n"), doc.length() >= 8 && wrong.isEmpty())
    }

    @Test fun everyReportIsTheBodyTheServerAccepts() {
        val doc = cases("jkos.sessionStateCases")
        val all = doc.getJSONArray("cases")
        val wrong = (0 until all.length()).mapNotNull { i ->
            val c = all.getJSONObject(i)
            val p = c.getJSONObject("player")
            val ids = p.getJSONArray("mediaIds")
            val sl = p.getJSONObject("sleep")
            val sleep = SleepState(
                sl.getString("mode"),
                if (sl.has("deadlineMs")) sl.getLong("deadlineMs") else null,
                if (sl.has("chapterEndMs")) sl.getLong("chapterEndMs") else null,
            )
            val got = SessionCore.reportBody(
                doc.getString("deviceId"),
                SessionCore.PlayerState(
                    (0 until ids.length()).map { ids.getString(it) }, p.getInt("current"), p.getLong("positionMs"), p.getBoolean("playing"),
                    p.getDouble("rate").toFloat(), p.getString("repeat"), p.strOrNull("context"), p.getDouble("volume").toFloat(),
                    p.getBoolean("muted"), sleep, p.getLong("nowMs"),
                ),
            )
            if (canon(got) == canon(c.getJSONObject("expect"))) null else "${c.getString("name")}:\n  expected ${c.getJSONObject("expect")}\n  got      $got"
        }
        assertTrue(wrong.joinToString("\n"), all.length() >= 6 && wrong.isEmpty())
    }

    @Test fun aSessionItemMapsBackToItsFirstFile() {
        val v = SessionCore.collapse(listOf("book:7:0", "book:7:1", "12", "13"), 3)
        assertEquals(listOf("book:7", "kouros:12", "kouros:13"), v.items)
        assertEquals(2, v.cursor); assertEquals(0, v.entryOf(0)); assertEquals(2, v.entryOf(1)); assertEquals(-1, v.entryOf(9))
    }
}
