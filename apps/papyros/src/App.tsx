import './app.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { AUTH_URL, useJkOSPreferences } from '@jkos/auth-client'
import { AppShell } from '@jkos/ui'
import AuthGuard from './components/AuthGuard'
import { useAuth } from './hooks/useAuth'
import { OfflineSettings } from './offline'
import Library from './views/Library'
import BookDetail from './views/BookDetail'
import PlayerBar from './player/PlayerBar'
import { useHashRoute } from './hooks/useHashRoute'

// Set the mode before React hydrates to prevent a flash. Read the user's last-known
// preference (written by the design utils), fall back to paper.
if (!document.documentElement.hasAttribute('data-mode')) {
  const cached = (() => { try { return localStorage.getItem(STORAGE_KEYS.mode) } catch { return null } })()
  document.documentElement.setAttribute('data-mode', cached ?? 'paper')
}

// PapyrOS's per-app inputs to the @jkos/design factory: an antique-library identity —
// a terracotta/ink-stamp primary (a wax-seal, leather-spine brown) paired with an aged
// verdigris-patina secondary (weathered library-lamp brass), Fraunces for the serif
// (title/author display — same suite serif as BeigeBoard/ORDECK, so the type feels of
// a piece, but this app is the one that actually reads as a book), and a gently
// rounded (book-corner, not sharp-console) radius scale. Everything below reads these
// --hub-* tokens — no hardcoded hex/radius elsewhere in the app. Accent stays
// user-overridable at runtime (the settings drawer writes --accent-raw/-2-raw on top
// of this default), same contract as every other app's injectJkOSTheme call.
injectJkOSTheme({
  accent: { primary: '#9a4b2c', secondary: '#5c8a72' },
  radius: { base: '6px', xs: '3px', sm: '5px', lg: '10px', soft: '7px', button: '6px' },
})

// AppShell (@jkos/ui, ToDo.md §3 Wave 20 item 20.1) owns the invariant frame —
// AuthGuard → header (brand + settings trigger) → SettingsDrawer wiring →
// useJkOSPreferences — so PapyrOS only supplies its own routed content plus the
// two injected selectors (usePreferences, useUser) the shell calls from inside
// AuthGuard's subtree. This is also where PapyrOS GAINS the settings drawer: the
// original hand-copy of this shell dropped the SettingsDrawer step entirely.
export default function App() {
  return (
    <AppShell
      guard={AuthGuard}
      usePreferences={useJkOSPreferences}
      useUser={useShellUser}
      authUrl={AUTH_URL}
      brand="PapyrOS"
      tagline="Audiobook library"
      settingsExtra={<OfflineSettings />}
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

// PapyrOS's routed content — rendered by AppShell between the header and the
// drawer, exactly where the old hand-copy put its <main> + <PlayerBar>.
function Content() {
  const { bookId } = useHashRoute()
  return (
    <>
      {/* Full Press entrance at the view boundary (ink dries / tube powers on) */}
      <main className="app-main ink-in">
        {bookId != null ? <BookDetail bookId={bookId} /> : <Library />}
      </main>

      <PlayerBar />
    </>
  )
}
