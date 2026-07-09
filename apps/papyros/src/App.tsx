import './app.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { Lab, cx } from '@jkos/ui'
import AuthGuard from './components/AuthGuard'
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
  const { bookId } = useHashRoute()

  return (
    <AuthGuard>
      <div className="app">
        <header className="app-header">
          <a href="#/" className={cx('jk-press-lg', 'wordmark')}>PapyrOS</a>
          <Lab size="sm">Audiobook library</Lab>
        </header>

        <main className="app-main">
          {bookId != null ? <BookDetail bookId={bookId} /> : <Library />}
        </main>

        <PlayerBar />
      </div>
    </AuthGuard>
  )
}
