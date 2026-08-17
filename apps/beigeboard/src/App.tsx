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
  /* Every request carries the client's LOCAL date. The routine engine mints
     relative to "today" and the server's UTC day is not the user's day — at 17:00
     in California it is already tomorrow in UTC, which would skip the occurrence
     on screen. Computed per call, not captured, so a tab left open overnight sends
     the new date on its next request. A header, not a query param: `GET /api/items`
     reads any query param as "filtered" and suppresses the seed + materialise. */
  const bbHeaders = (extra?: Record<string, string>) => ({
    'X-BB-Today': isoDate(new Date()),
    ...extra,
  })
  const api = {
    get: (path: string) =>
      authFetch(`${apiUrl}${path}`, { headers: bbHeaders() }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    post: (path: string, body: any) =>
      authFetch(`${apiUrl}${path}`, {
        method: 'POST', headers: bbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    patch: (path: string, body: any) =>
      authFetch(`${apiUrl}${path}`, {
        method: 'PATCH', headers: bbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    del: (path: string) =>
      authFetch(`${apiUrl}${path}`, { method: 'DELETE', headers: bbHeaders() }).then(r => {
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
    api.patch(`/api/items/${id}`, { completed: next }).then(() => {
      /* Ticking a routine occurrence is the event that MOVES THE CYCLE LADDER, so
         the sessions ahead of it were just re-rendered at their new cycles on the
         server. Those rows are not in this patch and cannot be derived here —
         refetch. Only for occurrences: an ordinary task tick stays a pure
         optimistic update with no round trip. */
      if (String(item.ext_ref || '').startsWith('routine:')) loadItems()
    }).catch((e: any) => {
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

  /* Returns the server's row, so a caller that needs more than the optimistic echo
     can have it — the routine forge reads `warnings` off it (the lint tier: "no
     step in this routine ever gets harder"), which by definition only the server
     can compute. Still optimistic first: every existing caller ignores the return
     and must keep feeling instant. */
  const onUpdateItem = async (id: number, patch: any) => {
    const prev_vals = items.find(it => it.id === id)
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
    setSelected((s: any) => s && s.id === id ? { ...s, ...patch } : s)
    try {
      const row = await api.patch(`/api/items/${id}`, patch)
      /* A write that touches a ROUTINE — its cadence, its document — or that ticks
         one of its OCCURRENCES reconciles the whole horizon server-side: the
         sessions ahead are re-rendered at their new cycle (routines.js RULE 3), so
         rows this patch never named have changed. Nothing local can derive that, so
         refetch. Guarded tightly, because the common case is an ordinary task edit
         that must not cost a round trip. */
      const touched = prev_vals || row
      const isRoutineWrite = touched?.kind === 'routine'
        || String(touched?.ext_ref || '').startsWith('routine:')
      if (isRoutineWrite) loadItems()
      return row
    } catch (e: any) {
      console.error('[onUpdateItem]', e)
      if (prev_vals) {
        setItems(prev => prev.map(it => it.id === id ? prev_vals : it))
        setSelected((s: any) => s && s.id === id ? prev_vals : s)
      }
      return null
    }
  }

  /* TAKE THIS SESSION EASY. Its own call rather than a PATCH of `deload_override`
     because the server does two things that only mean something together: it
     re-renders the session light AND gives it no rung on the cycle ladder, so the
     sessions after it shift back. Both land in one request; the refetch then picks
     up every row that moved, which is more than the one we named. */
  const onDeload = async (id: number, on: boolean) => {
    try {
      await api.post(`/api/items/${id}/deload`, on ? { deload: true } : { clear: true })
      loadItems()
    } catch (e) { console.error('[onDeload]', e) }
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
    onToggle, onDelete, onAddItem, onUpdateItem, onAddTask, onDeload,
    // The routine forge reads the library through this (the vocabulary its steps
    // are built from); nothing else in the view tree fetches for itself.
    api,
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

      {/* The shell — full bleed and TRANSPARENT, so the body's grained ground
          shows through it. It exists for the boot bloom (the filter below) and
          the column layout, never to paint a surface. */}
      <div style={{
        position: 'fixed', inset: 0,
        filter: colorIn ? 'saturate(1) brightness(1)' : 'saturate(0.04) brightness(0.08)',
        transition: 'filter 1.4s ease-out',   /* always present so colorIn flip reliably animates the bloom */
        background: 'transparent',   /* let the body's grained backdrop show */
        display: 'flex', flexDirection: 'column',
      }}>
        {/* The CANVAS — the one measure the whole app is set to (hub.css
            --jk-canvas: fluid, capped at 1760). A measure only: it is NOT drawn
            as a sheet, content sits directly on the grained ground. It spans the
            MASTHEAD as well as the content on purpose — a folio pinned to the
            window edge while the page it labels sits 500px inboard is the
            weighting failure this replaces. Every view below therefore inherits
            one centred measure, and rails are panes INSIDE it rather than
            siblings of the window. */}
        <div className="jk-canvas jk-canvas-fill" style={{
          /* position:relative is what the .jk-panel overlay pins itself to —
             see the DetailPanel note below. Do not remove it. */
          position: 'relative',
          background: 'transparent',   /* grained ground comes from the body */
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gridTemplateColumns: '1fr',
          color: 'var(--color-ink)',
          /* The bottom margin of the page. It used to be spent by the canvas
             foot (a taper rule + a colophon), which is gone: as a footer that
             line only pulled the eye down out of the view, and the rule above it
             made a second page boundary competing with the masthead's inlay. The
             margin itself still has to exist — content running to the last pixel
             of the window reads as clipped — so the canvas keeps it directly, and
             the page below the head simply ends in air. */
          paddingBottom: 18,
          /* The old global SVG #halation lens filter was removed: it could only
             bloom WARM pixels, so it reddened the whole UI and made warm-accent
             (rust) cards halo while cool (sage) ones didn't. Halation is now the
             per-element, colour-correct --accent-halo token from @jkos/design. */
        }}>
          {/* The header animates ONCE, on app boot — it doesn't remount on tab
              change, so it must not carry the view's cascade. Each view then
              owns its own cascade from 0ms.

              EVERY child of this grid is placed EXPLICITLY (gridRow + gridColumn),
              and new ones must be too. Auto-placement here is order-dependent on
              which siblings happen to be mounted: the DetailPanel used to be the
              one definitely-placed item, so grid placed IT first, auto-placement
              found row 2 taken and pushed <main> into an implicit row 3, and the
              declared 1fr row collapsed to 0px — every view lost the panel at
              once. Explicit placement makes the shell's rows a fact rather than
              a consequence of the render tree. */}
          <div className="mo-item" style={{ gridRow: 1, gridColumn: '1 / -1', animationDelay: '0ms' }}>
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
            // NO entrance class here, deliberately. All four views now stagger
            // their own regions with .mo-item — Calendar was the last holdout and
            // took the day-cell ring — and .mo-item carries `both`, so an
            // .mo-item inside an .ink-in parent double-animates: the parent fades
            // the whole pane in while each child is still holding its pre-delay
            // frame, which mushes exactly the cascade the child is there to draw.
            // ONE entrance per surface, and the inner one wins wherever a view has
            // one because it says more. A future view with no internal cascade
            // should carry `ink-in` here (Full Press's face-aware boundary
            // entrance: ink dries on paper, the tube powers on in dark).
            style={{ gridRow: 2, gridColumn: 1, overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
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

          {/* THE OVERLAY HOST — the content row's second layer.
              An empty, explicitly-placed pane stacked on the same cell as <main>,
              existing only to be the positioned ancestor the .jk-panel overlay
              pins to. Three properties earn their keep:
                position:relative  → the panel measures itself against the CONTENT
                                     row, so it stops below the masthead without
                                     anyone hardcoding the masthead's height.
                pointer-events:none → an always-mounted full-cell layer would
                                     otherwise swallow every click on the view
                                     beneath it; .jk-panel turns them back on.
                overflow:hidden     → the panel slides in from off-measure.
              It is NOT inside <main>, which carries key={view}: an overlay hosted
              there would unmount and replay its entrance on every tab switch
              while the selection it shows is unchanged. */}
          <div style={{ gridRow: 2, gridColumn: 1, position: 'relative', pointerEvents: 'none', overflow: 'hidden' }}>
            {selected && (
              <DetailPanel
                event={selected} items={items}
                onClose={() => setSelected(null)}
                onToggle={onToggle} onDelete={onDelete} onUpdateItem={onUpdateItem} onDeload={onDeload}
                setView={setView} setFocusedNodeId={setFocusedNodeId}
              />
            )}
          </div>

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
