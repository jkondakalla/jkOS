import React, { useState, useEffect, useMemo } from 'react'
import './app.css'

import { FONT_BODY, weekStart, isoDate } from './lib/theme'
import { TODAY_ISO, INITIAL_ACCOUNTS, getDescendants } from './lib/seed'
import { useJkOSPreferences } from './hooks/useJkOSPreferences'
import { DragProvider } from './providers/DragProvider'
import { MobileApp } from './mobile'
import { injectJkOSTheme, STORAGE_KEYS, applyJkOSMotion } from '@jkos/design'

import { Artifacts, ScanLines, CinematicIntro } from './components/Overlays'
import { AppHeader } from './components/AppHeader'
import { ConnectModal } from './components/ConnectModal'
import { DetailPanel } from './components/DetailPanel'
import { SettingsDrawer, useBreakpoint } from '@jkos/ui'
import { AUTH_URL, authFetch, useSessionKeepalive } from './lib/jkauth'

import { TodayView } from './views/TodayView'
import { WeekView } from './views/WeekView'
import { CalendarView } from './views/CalendarView'
import { WorkshopView } from './views/workshop/WorkshopView'

// Set mode before React hydrates to prevent flash. Check localStorage for user's
// last-known preference (written by applyJkOSMode), fall back to paper.
if (!document.documentElement.hasAttribute('data-mode')) {
  const cached = (() => { try { return localStorage.getItem(STORAGE_KEYS.mode) } catch { return null } })()
  document.documentElement.setAttribute('data-mode', cached ?? 'paper')
}

// BeigeBoard supplies its per-app inputs to the @jkos/design factory. Since
// Full Press (Wave 22) the serif default IS Fraunces suite-wide, so the old
// fonts.serif input here is gone — BeigeBoard inherits the print voice for
// free (the webfont still loads from index.html). Radius stays a first-class
// per-app input: BeigeBoard runs its own rounder scale over the hub print
// scale. Every BeigeBoard shape reads these --hub-radius-* tokens (no
// hardcoded radii), so the whole app retunes from this one call. Accents stay
// user-driven (applyJkOSTheme, in useJkOSPreferences).
injectJkOSTheme({
  radius: { base: '8px', xs: '4px', sm: '7px', lg: '11px', soft: '9px', widget: '10px', button: '8px' },
})

const DEFAULT_API_URL  = import.meta.env.VITE_API_URL ?? ''
const JKOS_AUTH_URL    = import.meta.env.VITE_JKOS_AUTH_URL ?? 'https://auth.jkos.net'

/* Token-refresh-aware fetch is now the suite-shared authFetch (@jkos/auth-client):
   on a 401 (TOKEN_EXPIRED/UNAUTHENTICATED) it silently rotates the remember-me
   refresh cookie and retries, deduping concurrent attempts. One implementation for
   every app + the weave fabric, instead of a per-app copy. */

/* ── Main app ──────────────────────────────────────────────────────────── */
export default function App({ apiUrl = DEFAULT_API_URL }: { apiUrl?: string }) {
  const [user, setUser] = useState<any>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const prefs = useJkOSPreferences()
  const { effects } = prefs

  // Keep the access token fresh so a long-open board never 401s mid-session.
  useSessionKeepalive()

  // Motion axis (Full Press): per-item .mo-item entrances ride the default
  // 'entrance', and the ambient rake (paper) / buzz (tube) is the opt-in 'full'
  // tier — wired to the CRT-atmosphere toggle so it's user-controlled. hub.css
  // still honours prefers-reduced-motion regardless.
  useEffect(() => {
    applyJkOSMotion(effects.halation ? 'full' : 'entrance')
  }, [effects.halation])

  const toAuthPortal = () => {
    window.location.href = `${JKOS_AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}`
  }

  const checkAuth = async () => {
    try {
      const r = await authFetch(`${apiUrl}/api/auth/me`)
      if (r.ok) {
        const d = await r.json()
        setUser(d.user)
      } else {
        setUser(false)
      }
    } catch { setUser(false) }
  }

  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (user === false) toAuthPortal() }, [user])

  const handleUnauth = () => toAuthPortal()

  /* All API calls go through authFetch which handles token refresh */
  const api = {
    get: (path: string) =>
      authFetch(`${apiUrl}${path}`).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    post: (path: string, body: any) =>
      authFetch(`${apiUrl}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    patch: (path: string, body: any) =>
      authFetch(`${apiUrl}${path}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    del: (path: string) =>
      authFetch(`${apiUrl}${path}`, { method: 'DELETE' }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
  }

  const handleLogout = async () => {
    try {
      await fetch(`${JKOS_AUTH_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* best effort */ }
    window.location.href = `${JKOS_AUTH_URL}/auth/login`
  }

  // Phone gets the dedicated mobile tree; tablet rides the desktop layout (the
  // canonical mobile tier is ≤767px, so this preserves the old 768px crossover).
  // Breakpoints come from the single @jkos/design source — see useBreakpoint.
  const isMobile = useBreakpoint() === 'mobile'

  // "Today" must not freeze at page-load: a planner is routinely left open
  // overnight, after which TODAY_ISO (a module constant) would keep the Today view,
  // the calendar highlight, and new-task date defaults stuck on yesterday. Roll it
  // over at the next local midnight AND whenever the tab refocuses. The setToday
  // guard returns the previous value when the date is unchanged, so a refocus that
  // isn't a new day causes no re-render.
  const [today, setToday] = useState(TODAY_ISO)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const n = new Date()
      const nextMidnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5)
      clearTimeout(timer)
      timer = setTimeout(tick, nextMidnight.getTime() - n.getTime())
    }
    const tick = () => {
      setToday(prev => { const now = isoDate(new Date()); return prev === now ? prev : now })
      schedule()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // Opening scroll plays on load (CinematicIntro reads <html data-mode> so it
  // renders in the user's mode); the app starts desaturated and blooms to colour
  // when the intro finishes (onDone → setColorIn(true)).
  const [intro, setIntro]   = useState(true)
  const [colorIn, setColorIn] = useState(false)
  const [view, setView]                   = useState('today')
  const [items, setItems]                 = useState<any[]>([])
  const [loading, setLoading]             = useState(true)
  const [recentlyAdded, setRecentlyAdded] = useState(new Set<number>())
  const [accounts, setAccounts]           = useState(INITIAL_ACCOUNTS)
  const [selected, setSelected]           = useState<any>(null)
  const [showConnect, setShowConnect]     = useState(false)
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null)
  const [weekJumpDate, setWeekJumpDate]   = useState<string | null>(null)

  const loadItems = async () => {
    try {
      const data = await api.get('/api/items')
      if (Array.isArray(data)) setItems(data)
    } catch (e) {
      console.error('[loadItems]', e)
    } finally { setLoading(false) }
  }

  useEffect(() => { if (user) loadItems() }, [user])

  useEffect(() => {
    if (!user) return
    ;['google', 'outlook', 'icloud'].forEach(id => {
      api.get(`/api/auth/${id}/status`).then((status: any) => {
        if (status.connected) {
          setAccounts(prev => prev.map((a: any) =>
            a.id === id ? { ...a, connected: true, visible: true, email: status.email } : a
          ))
        }
      }).catch(() => {})
    })
  }, [user])


  const onToggle = (id: number) => {
    const item = items.find(it => it.id === id)
    if (!item) return
    const next = !item.completed
    setItems(prev => prev.map(it => it.id === id ? { ...it, completed: next } : it))
    setSelected((s: any) => s && s.id === id ? { ...s, completed: next } : s)
    api.patch(`/api/items/${id}`, { completed: next }).catch((e: any) => {
      console.error('[onToggle]', e)
      // revert optimistic update
      setItems(prev => prev.map(it => it.id === id ? { ...it, completed: !next } : it))
      setSelected((s: any) => s && s.id === id ? { ...s, completed: !next } : s)
    })
  }

  const onDelete = (id: number) => {
    const target = items.find(it => it.id === id)
    if (!target) return
    // The server cascade-deletes the whole subtree (cascadeDelete); mirror that
    // locally so a deleted goal's milestones/tasks don't linger as ghosts (dangling
    // parent_id, 404 on interaction) until the next reload.
    const removed = [target, ...getDescendants(target, items)]
    const removedIds = new Set(removed.map((r: any) => r.id))
    setItems(prev => prev.filter(it => !removedIds.has(it.id)))
    setSelected((s: any) => s && removedIds.has(s.id) ? null : s)
    api.del(`/api/items/${id}`).catch((e: any) => {
      console.error('[onDelete]', e)
      setItems(prev => [...prev, ...removed])   // restore the whole subtree on failure
    })
  }

  const onAddItem = async (partial: any) => {
    // Resolve to null (never reject) on failure: most callers fire-and-forget, so a
    // throw here became an unhandled rejection and the typed task silently vanished.
    // Awaiting callers (the Workshop forge/ladder) null-check the result.
    try {
      const fresh = await api.post('/api/items', {
        kind: 'task', scope: 'day', completed: false, source: 'bb', ...partial,
      })
      if (!fresh?.id) throw new Error(fresh?.error || 'Item creation failed')
      setItems(prev => [...prev, fresh])
      setRecentlyAdded(s => { const n = new Set(s); n.add(fresh.id); return n })
      setTimeout(() => {
        setRecentlyAdded(s => { const n = new Set(s); n.delete(fresh.id); return n })
      }, 600)
      return fresh
    } catch (e) {
      console.error('[onAddItem]', e)
      return null
    }
  }

  const onUpdateItem = (id: number, patch: any) => {
    const prev_vals = items.find(it => it.id === id)
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
    setSelected((s: any) => s && s.id === id ? { ...s, ...patch } : s)
    api.patch(`/api/items/${id}`, patch).catch((e: any) => {
      console.error('[onUpdateItem]', e)
      if (prev_vals) {
        setItems(prev => prev.map(it => it.id === id ? prev_vals : it))
        setSelected((s: any) => s && s.id === id ? prev_vals : s)
      }
    })
  }

  const onAddTask = (partial: any) => onAddItem({ kind: 'task', scope: 'day', source: 'bb', ...partial })

  const onConnect = (provider: any) => {
    setAccounts(prev => prev.map((a: any) => a.id === provider.id
      ? { ...a, connected: true, visible: true, email: provider.email || a.email }
      : a))
    loadItems()
  }

  const onDisconnect = (id: string) => {
    const snapshot = accounts.find((a: any) => a.id === id)
    setAccounts(prev => prev.map((a: any) => a.id === id
      ? { ...a, connected: false, visible: false, email: '' }
      : a))
    const routes: Record<string, string> = {
      google: '/api/auth/google', outlook: '/api/auth/outlook', icloud: '/api/auth/icloud',
    }
    if (routes[id]) {
      api.del(routes[id]).then(loadItems).catch((e: any) => {
        console.error('[onDisconnect]', e)
        if (snapshot) setAccounts(prev => prev.map((a: any) => a.id === id ? snapshot : a))
      })
    }
  }

  const onSync = (id: string) => {
    const routes: Record<string, string> = {
      google: '/api/calendar/google/sync', outlook: '/api/calendar/outlook/sync', icloud: '/api/calendar/icloud/sync',
    }
    if (routes[id]) api.post(routes[id], {}).then(loadItems).catch((e: any) => console.error('[onSync]', e))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showConnect) setShowConnect(false)
      else if (selected) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showConnect, selected])

  const visibleItems = useMemo(() => {
    const vis = new Set(accounts.filter((a: any) => a.visible && a.connected).map((a: any) => a.id))
    return items.filter(it => it.kind !== 'event' || vis.has(it.source))
  }, [items, accounts])

  const readonly = user?.role === 'guest'

  const viewProps = {
    items: visibleItems,
    today,
    onSelect: setSelected,
    onToggle, onDelete, onAddItem, onUpdateItem, onAddTask,
    recentlyAdded,
    setView,
    selectedId: selected?.id,
    focusedNodeId, setFocusedNodeId,
    weekJumpDate,
    onWeekJump: (iso: string) => { setWeekJumpDate(weekStart(iso)); setView('week') },
    readonly,
  }

  if (user === null) {
    return <div style={{ position: 'fixed', inset: 0, background: 'var(--color-paper)' }} />
  }

  if (user === false) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--color-paper)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-faint)', fontSize: 13, letterSpacing: '0.05em',
        fontFamily: FONT_BODY,
      }}>
        Redirecting to sign in…
      </div>
    )
  }

  if (isMobile) {
    return (
      <MobileApp
          items={visibleItems}
          today={today}
          onItemToggle={(id, completed) => {
            setItems(prev => prev.map(it => it.id === id ? { ...it, completed } : it))
            setSelected((s: any) => s && s.id === id ? { ...s, completed } : s)
            api.patch(`/api/items/${id}`, { completed }).catch((e: any) => {
              console.error('[onItemToggle]', e)
              // revert optimistic update (parity with desktop onToggle)
              setItems(prev => prev.map(it => it.id === id ? { ...it, completed: !completed } : it))
              setSelected((s: any) => s && s.id === id ? { ...s, completed: !completed } : s)
            })
          }}
          onItemDelete={onDelete}
          onItemAdd={onAddItem}
          onItemUpdate={onUpdateItem}
        />
    )
  }

  return (
    <DragProvider>
      {intro && (
        <CinematicIntro onDone={() => { setIntro(false); setColorIn(true) }} />
      )}

      {effects.scanLines && <ScanLines strength={effects.scanStrength} />}
      {effects.artifacts && <Artifacts />}

      <div style={{
        position: 'fixed', inset: 0,
        filter: colorIn ? 'saturate(1) brightness(1)' : 'saturate(0.04) brightness(0.08)',
        transition: 'filter 1.4s ease-out',   /* always present so colorIn flip reliably animates the bloom */
        background: 'transparent',   /* let the body's grained paper backdrop show */
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gridTemplateColumns: '1fr',
          background: 'transparent',   /* grained paper comes from the body backdrop */
          color: 'var(--color-ink)',
          /* The old global SVG #halation lens filter was removed: it could only
             bloom WARM pixels, so it reddened the whole UI and made warm-accent
             (rust) cards halo while cool (sage) ones didn't. Halation is now the
             per-element, colour-correct --accent-halo token from @jkos/design. */
        }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <AppHeader
              view={view} setView={setView}
              today={today}
              accounts={accounts}
              onConnectClick={() => setShowConnect(true)}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              user={user}
            />
          </div>

          <main
            key={view}
            // Full Press entrance physics at the VIEW boundary: ink dries on
            // paper, the tube powers on in dark — one class, face-aware.
            // (Workshop keeps no entrance: its inner canvas manages its own.)
            className={view === 'tasks' ? undefined : 'ink-in'}
            style={{ overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                {/* off-states carry the print idiom (DESIGN.md §13.12) */}
                <span className="jk-async-note" style={{ padding: 0 }}>Setting type…</span>
              </div>
            ) : (
              <>
                {view === 'today'    && <TodayView    {...viewProps} />}
                {view === 'week'     && <WeekView     {...viewProps} />}
                {view === 'calendar' && <CalendarView {...viewProps} />}
                {view === 'tasks'    && <WorkshopView {...viewProps} />}
              </>
            )}
          </main>

          {selected && (
            <DetailPanel
              event={selected} items={items}
              onClose={() => setSelected(null)}
              onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem}
              setView={setView} setFocusedNodeId={setFocusedNodeId}
            />
          )}

          {/* Ambient atmosphere — raking light across the sheet (paper) / phosphor
              buzz (tube). Each shows only in its own face, gated to data-motion
              'full' + reduced-motion in hub.css. */}
          <div className="jk-rake" />
          <div className="jk-buzz" />
        </div>
      </div>

      <ConnectModal
        open={showConnect} onClose={() => setShowConnect(false)}
        accounts={accounts} onConnect={onConnect} onDisconnect={onDisconnect} onSync={onSync}
        apiUrl={apiUrl}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        {...prefs}
        user={user}
        authUrl={AUTH_URL}
      />
    </DragProvider>
  )
}
