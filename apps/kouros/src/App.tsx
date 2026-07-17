import './app.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { AUTH_URL, useJkOSPreferences } from '@jkos/auth-client'
import { AppShell } from '@jkos/ui'
import AuthGuard from './components/AuthGuard'
import NavBar from './components/NavBar'
import { useAuth } from './hooks/useAuth'
import { useHashRoute } from './hooks/useHashRoute'
import Home from './views/Home'
import Artists from './views/Artists'
import Artist from './views/Artist'
import Album from './views/Album'
import Search from './views/Search'
import Playlists from './views/playlists/Playlists'
import PlaylistDetail from './views/playlists/PlaylistDetail'
import PlayerBar from './player/PlayerBar'

// Set the mode before React hydrates to prevent a flash. Read the user's last-known
// preference (written by the design utils), fall back to paper.
if (!document.documentElement.hasAttribute('data-mode')) {
  const cached = (() => { try { return localStorage.getItem(STORAGE_KEYS.mode) } catch { return null } })()
  document.documentElement.setAttribute('data-mode', cached ?? 'paper')
}

// KourOS's per-app inputs to the @jkos/design factory (ToDo.md §3 18.3's design
// note): a deep indigo/amber pairing — indigo (the "club light / turntable felt"
// primary) against a warm amber secondary (a VU-meter/vinyl-warmth glow) —
// deliberately distinct from papyros's terracotta/verdigris antique-library
// identity. Fonts are left at the factory default (IBM Plex Sans/Mono, no serif
// override): papyros's Fraunces serif reads right for ONE book cover's title at
// a time, but this app is dense grids of many track/album/artist rows — a clean
// geometric sans stays legible at that density and reads closer to a
// Plexamp/Spotify-class player than a library shelf, which is the target feel
// here (ToDo.md §3's "Plexamp floor, Spotify ceiling" brief). Radius is tuned a
// touch tighter than papyros's book-corner rounding — a slightly more
// console/DAW-leaning edge, still on the suite's shared rounded-corner language.
// Accent stays user-overridable at runtime (the settings drawer writes
// --accent-raw/-2-raw on top of this default), same contract as every app.
injectJkOSTheme({
  accent: { primary: '#4b3f8f', secondary: '#dba13c' },
  radius: { base: '5px', xs: '3px', sm: '4px', lg: '8px', soft: '6px', button: '5px' },
})

// AppShell (@jkos/ui, ToDo.md §3 Wave 20 item 20.1) owns the invariant frame —
// AuthGuard → header (brand + settings trigger) → SettingsDrawer wiring →
// useJkOSPreferences — same adoption papyros's App.tsx already proved.
export default function App() {
  return (
    <AppShell
      guard={AuthGuard}
      usePreferences={useJkOSPreferences}
      useUser={useShellUser}
      authUrl={AUTH_URL}
      brand="KourOS"
      tagline="Music library"
    >
      <Content />
    </AppShell>
  )
}

// The identity AuthGuard already has (not the preferences hook's `user`) — it
// paints the drawer's Account row on first render, ahead of the /auth/profile
// round-trip. Called by AppShell from inside AuthGuard's provider subtree.
function useShellUser() {
  const { state } = useAuth()
  return state.status === 'authenticated' ? state.user : null
}

// KourOS's routed content — rendered by AppShell between the header and the
// drawer. NavBar (Home/Artists/Search) sits just below the shell header;
// PlayerBar (18.4's seam) mounts once, below the routed view, exactly like
// papyros's <PlayerBar/> placement.
function Content() {
  const route = useHashRoute()
  return (
    <>
      <main className="app-main">
        <NavBar active={route.view} />
        {route.view === 'artist' && route.artist != null ? (
          <Artist artist={route.artist} />
        ) : route.view === 'album' && route.artist != null && route.album != null ? (
          <Album artist={route.artist} album={route.album} />
        ) : route.view === 'artists' ? (
          <Artists />
        ) : route.view === 'playlist' && route.playlistId != null ? (
          <PlaylistDetail playlistId={route.playlistId} />
        ) : route.view === 'playlists' ? (
          <Playlists />
        ) : route.view === 'search' ? (
          <Search initialQuery={route.query} />
        ) : (
          <Home />
        )}
      </main>

      <PlayerBar />
    </>
  )
}
