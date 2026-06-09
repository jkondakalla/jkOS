import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { useAuthStore } from '../store/authStore'
import { useJkOSPreferences } from '../hooks/useJkOSPreferences'
import { Bar, Icon, Spinner, ThemeToggle, cx } from './ui'
import { FilmGrain, Halation, ScanLines, Artifacts } from './Overlays'
import { SettingsPanel } from './SettingsPanel'

const NAV = [
  { to: '/', label: 'Today', icon: 'book', end: true },
  { to: '/library', label: 'Library', icon: 'layers', end: false },
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
] as const

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 group" aria-label="SylibOS home">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-contrast shadow-card transition group-hover:rotate-[-6deg]">
        <Icon name="layers" size={17} strokeWidth={2} />
      </span>
      <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">
        Sylib<span className="text-accent-ink">OS</span>
      </span>
    </NavLink>
  )
}


function ProfileButton({ user, onClick, open }: { user: any; onClick: () => void; open: boolean }) {
  const src = (user?.name || user?.email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
  return (
    <button
      onClick={onClick}
      aria-label="Open settings"
      title={user?.name || user?.email}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold transition',
        'border border-line-strong',
        open
          ? 'bg-accent text-accent-contrast border-accent shadow-[0_0_8px_var(--color-accent-glow)]'
          : 'bg-accent-soft text-accent-ink hover:border-accent hover:shadow-[0_0_6px_var(--color-accent-glow)]',
      )}
    >
      {inits}
    </button>
  )
}

export default function Layout() {
  const { segments, hydrate } = useAppStore()
  const { status, init, user } = useAuthStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const prefs = useJkOSPreferences()
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const isDark = prefs.theme.mode === 'dark' || (prefs.theme.mode === 'system' && prefersDark)
  const { effects } = prefs

  useEffect(() => { init() }, [init])
  useEffect(() => { if (status === 'ready') hydrate() }, [status, hydrate])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-muted">
        <Spinner size={26} />
        <span className="text-[13px] tracking-wide">
          {status === 'loading' ? 'Verifying your session…' : 'Redirecting to sign in…'}
        </span>
      </div>
    )
  }

  const total = Object.keys(segments).length
  const done = Object.values(segments).filter(s => s.completedAt).length

  return (
    <div
      className="min-h-screen"
      style={effects.halation && isDark ? { filter: 'url(#sylib-halation)' } : undefined}
    >
      <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-xl papered">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Brand />

          <nav className="ml-2 flex items-center gap-1 sm:ml-4">
            {NAV.map(({ to, label, icon, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => cx(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold transition',
                  isActive ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink hover:bg-paper-2',
                )}>
                <Icon name={icon} size={17} />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {total > 0 && (
              <div className="hidden items-center gap-2.5 rounded-full border border-line bg-card px-3 py-1.5 lg:flex">
                <span className="text-[12px] font-medium text-muted tabular-nums">{done}/{total}</span>
                <Bar value={total ? done / total : 0} height={5} className="w-20" />
              </div>
            )}
            <ThemeToggle />
            <div className="flex items-center gap-2">
              <span className="hidden text-[13px] text-muted md:inline max-w-[140px] truncate">
                {user?.name || user?.email}
              </span>
            </div>
            <ProfileButton user={user} onClick={() => setSettingsOpen(o => !o)} open={settingsOpen} />
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      {/* CRT overlay effects — tasteful defaults, user-controlled in settings */}
      {effects.grain     && <FilmGrain strength={effects.grainStrength} />}
      {effects.halation  && isDark && <Halation />}
      {effects.scanLines && <ScanLines strength={effects.scanStrength} />}
      {effects.artifacts && <Artifacts />}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        {...prefs}
        user={prefs.user ?? user}
      />
    </div>
  )
}
