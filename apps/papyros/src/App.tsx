import { useState } from 'react'
import './app.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { AUTH_URL, useJkOSPreferences } from '@jkos/auth-client'
import { Lab, SettingsDrawer, cx } from '@jkos/ui'
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
  fonts:  { serif: "'Fraunces', Georgia, serif" },
  radius: { base: '6px', xs: '3px', sm: '5px', lg: '10px', soft: '7px', button: '6px' },
})

export default function App() {
  return (
    <AuthGuard>
      <Shell />
    </AuthGuard>
  )
}

// The signed-in shell. Split out of App so `useJkOSPreferences` (which reads
// /auth/profile) mounts only once AuthGuard has resolved a session. Same shape as
// BeigeBoard's App: spread the hook straight into the shared @jkos/ui SettingsDrawer —
// which is where the whole suite keeps Account/Sign out, the light/dark mode toggle and
// the accent picker — and override `user` with the identity AuthGuard already has, so
// the Account row paints on first render instead of after the profile round-trip.
function Shell() {
  const { bookId } = useHashRoute()
  const { state } = useAuth()
  const prefs = useJkOSPreferences()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const user = state.status === 'authenticated' ? state.user : null

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <a href="#/" className={cx('jk-press-lg', 'wordmark')}>PapyrOS</a>
          <Lab size="sm">Audiobook library</Lab>
        </div>
        <button
          type="button"
          className="app-settings-btn"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <IconGear />
        </button>
      </header>

      <main className="app-main">
        {bookId != null ? <BookDetail bookId={bookId} /> : <Library />}
      </main>

      <PlayerBar />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        {...prefs}
        user={user}
        authUrl={AUTH_URL}
        extra={<OfflineSettings />}
      />
    </div>
  )
}

/** currentColor gear — the button's `color` drives it (same idiom as PlayerBar's glyphs). */
function IconGear() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.8v2.1M12 19.1v2.1M4.5 4.5L6 6M18 18l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.5 19.5L6 18M18 6l1.5-1.5"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      />
    </svg>
  )
}
