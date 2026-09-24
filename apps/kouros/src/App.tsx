import './app.css'
import './glass.css'
import './shell.css'
import './views.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { AUTH_URL, useJkOSPreferences } from '@jkos/auth-client'
import { AppShell, useBreakpoint } from '@jkos/ui'
import AuthGuard from './components/AuthGuard'
import TabBar from './components/TabBar'
import Beacon from './shell/Beacon'
import RuneLayer from './shell/RuneLayer'
import { useAuth } from './hooks/useAuth'
import { useHashRoute } from './hooks/useHashRoute'
import Home from './views/Home'
import Browse from './views/Browse'
import Artist from './views/Artist'
import Album from './views/Album'
import Search from './views/Search'
import VibeMap from './views/VibeMap'
import NowPlaying from './views/NowPlaying'
import Queue from './views/Queue'
import Playlists from './views/playlists/Playlists'
import PlaylistDetail from './views/playlists/PlaylistDetail'
import BooksLibrary from './views/books/Library'
import BookDetail from './views/books/BookDetail'
import { OfflineSettings } from './books/offline'
import { PlayerProvider } from './player/PlayerProvider'
import MiniPlayer from './player/MiniPlayer'
import DevicePicker from './components/DevicePicker'

// Set the mode before React hydrates to prevent a flash. Read the user's last-known
// preference (written by the design utils), fall back to paper.
if (!document.documentElement.hasAttribute('data-mode')) {
  const cached = (() => { try { return localStorage.getItem(STORAGE_KEYS.mode) } catch { return null } })()
  document.documentElement.setAttribute('data-mode', cached ?? 'paper')
}

// KourOS's per-app inputs to the @jkos/design factory: a deep indigo/amber pairing
// — indigo (the "club light / turntable felt" primary) against a warm amber
// secondary (a VU-meter/vinyl-warmth glow). These are the FALLBACK accent only:
// once something is playing, PlayerProvider derives the accent from the current
// sleeve and scopes it to the player surfaces, so the app takes its colour from
// the record. Radius is tuned a touch tighter than the suite default — a more
// console/DAW-leaning edge, still on the shared rounded-corner language.
injectJkOSTheme({
  accent: { primary: '#4b3f8f', secondary: '#dba13c' },
  radius: { base: '5px', xs: '3px', sm: '4px', lg: '8px', soft: '6px', button: '5px' },
})

export default function App() {
  return (
    <AppShell
      guard={AuthGuard}
      usePreferences={useJkOSPreferences}
      useUser={useShellUser}
      authUrl={AUTH_URL}
      brand="KourOS"
      tagline="Music & audiobooks"
      /* The suite header is KEPT and restyled as this app's glass top bar (see
         views.css's `.kr-shell .jk-shell-header`) rather than suppressed. It
         already carries the brand and the settings trigger, and adding a
         `chromeless` prop to a shared primitive to satisfy one app is a worse
         trade than one scoped stylesheet rule. The per-view headers below it are
         therefore CONTEXTUAL only — they never repeat the app's name. */
      className="kr-shell"
      /* Downloaded audiobooks — the storage panel. */
      settingsExtra={<OfflineSettings />}
    >
      <Content />
    </AppShell>
  )
}

function useShellUser() {
  const { state } = useAuth()
  return state.status === 'authenticated' ? state.user : null
}

/**
 * The routed content.
 *
 * Now Playing and Queue are full-screen OVERLAY routes: they replace the page and
 * hide the navigation, but they are real history entries, so the phone's back
 * gesture collapses them instead of leaving the app.
 *
 * ⚠️ **THE NAVIGATION IS DIFFERENT PER TIER, AND DELIBERATELY SO.** On a phone
 * there is no tab bar and no mini player: the BEACON is the whole navigation
 * (shell/Beacon.tsx) and the runes are the transport. Four permanent targets
 * along the bottom edge cost a strip of a small screen to say what a summoned
 * menu says on demand — and on a phone that strip is the most valuable real
 * estate there is. On a desktop none of that applies: there is room for the side
 * rail, a thumb-height beacon is meaningless next to a pointer, and the mini
 * player has somewhere to live. So `useBreakpoint()` picks the shape, exactly
 * where shell.css's own 1024px crossover turns the tab bar into that rail.
 */
function Content() {
  const route = useHashRoute()
  const overlay = route.view === 'now' || route.view === 'queue'
  const desktop = useBreakpoint() === 'desktop'

  return (
    <PlayerProvider>
      <div className={`kr-app${overlay ? ' is-overlay' : ''}`}>
        {overlay ? (
          /* Now Playing is the rune surface: one screen, nothing to scroll, and
             the only place where every transport verb is about the thing on
             show. The Queue scrolls, so it is not wrapped — see RuneLayer's
             header on why those two cannot share a pointer. */
          route.view === 'now' ? <RuneLayer><NowPlaying /></RuneLayer> : <Queue />
        ) : (
          <>
            <main className="kr-main ink-in">
              {route.view === 'artist' && route.artist != null ? (
                <Artist artist={route.artist} />
              ) : route.view === 'album' && route.artist != null && route.album != null ? (
                <Album artist={route.artist} album={route.album} />
              ) : route.view === 'browse' || route.view === 'artists' ? (
                <Browse />
              ) : route.view === 'playlist' && route.playlistId != null ? (
                <PlaylistDetail playlistId={route.playlistId} />
              ) : route.view === 'playlists' ? (
                <Playlists />
              ) : route.view === 'book' && route.bookId != null ? (
                <BookDetail bookId={route.bookId} />
              ) : route.view === 'books' ? (
                <BooksLibrary />
              ) : route.view === 'search' ? (
                <Search initialQuery={route.query} />
              ) : route.view === 'map' ? (
                <VibeMap />
              ) : (
                <Home />
              )}
            </main>

            {desktop && (
              <>
                <MiniPlayer />
                <TabBar active={route.view} />
              </>
            )}
          </>
        )}

        {/* The beacon rides OUTSIDE the overlay branch, because Queue and the
            Vibe Map are two of the three destinations it offers — arriving at
            one only to find no way onward is the trap of replacing a persistent
            tab bar with a summoned menu. Now Playing is the one exception: it is
            a state rather than a place, its own surface is the rune layer, and
            the system back gesture is what collapses it. */}
        {!desktop && route.view !== 'now' && <Beacon view={route.view} />}
        {/* The one device picker — every speaker button opens this (DevicePicker's seam). */}
        <DevicePicker />
      </div>
    </PlayerProvider>
  )
}
