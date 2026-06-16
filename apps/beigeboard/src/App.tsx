import React, { useState, useEffect, useMemo } from 'react'
import './app.css'

import { FONT_BODY, weekStart } from './lib/theme'
import { TODAY_ISO, INITIAL_ACCOUNTS } from './lib/seed'
import { useJkOSPreferences } from './hooks/useJkOSPreferences'
import { DragProvider } from './providers/DragProvider'
import { MobileApp } from './mobile'
import { injectJkOSTheme } from '@jkos/design'

import { FilmGrain, Halation, Artifacts, ScanLines, CinematicIntro } from './components/Overlays'
import { AppHeader } from './components/AppHeader'
import { ConnectModal } from './components/ConnectModal'
import { DetailPanel } from './components/DetailPanel'
import { SettingsDrawer } from '@jkos/ui'
import { AUTH_URL } from './lib/jkauth'

import { TodayView } from './views/TodayView'
import { WeekView } from './views/WeekView'
import { CalendarView } from './views/CalendarView'
import { WorkshopView } from './views/WorkshopView'

// Set paper mode before React hydrates to prevent flash
if (!document.documentElement.hasAttribute('data-mode')) {
  document.documentElement.setAttribute('data-mode', 'paper')
}

// BeigeBoard supplies its per-app inputs to the @jkos/design factory: serif →
// Fraunces (sans/mono inherit the IBM Plex factory defaults), and its own radius
// scale. Radius is a first-class factory input like accent/fonts/neutrals — the
// hub default happens to be sharp (0–2px), BeigeBoard runs a rounder scale, other
// apps keep theirs. Every BeigeBoard shape reads these --hub-radius-* tokens
// (no hardcoded radii), so the whole app retunes from this one call. Accents stay
// user-driven (applyJkOSTheme, in useJkOSPreferences).
injectJkOSTheme({
  fonts: { serif: "'Fraunces', Georgia, serif" },
  radius: { base: '8px', xs: '4px', sm: '7px', lg: '11px', soft: '9px', widget: '10px', button: '8px' },
})

const DEFAULT_API_URL  = import.meta.env.VITE_API_URL ?? ''
const JKOS_AUTH_URL    = import.meta.env.VITE_JKOS_AUTH_URL ?? 'https://auth.jkos.net'

/* ── Token-refresh-aware fetch ─────────────────────────────────────────── */
let refreshing: Promise<boolean> | null = null

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const opts = { credentials: 'include' as const, ...init }
  const r = await fetch(input, opts)
  if (r.status !== 401) return r

  let data: any
  try { data = await r.clone().json() } catch { return r }
  if (data?.code !== 'TOKEN_EXPIRED') return r

  /* Deduplicate concurrent refresh attempts — calls jkos-auth service */
  if (!refreshing) {
    refreshing = fetch(`${JKOS_AUTH_URL}/auth/refresh`, {
      method: 'POST', credentials: 'include',
    }).then(res => res.ok).finally(() => { refreshing = null })
  }

  const ok = await refreshing
  if (!ok) return r
  return fetch(input, opts)
}

/* ── Main app ──────────────────────────────────────────────────────────── */
export default function App({ apiUrl = DEFAULT_API_URL }: { apiUrl?: string }) {
  const [user, setUser] = useState<any>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const prefs = useJkOSPreferences()
  const { effects } = prefs

  const toAuthPortal = () => {
    window.location.href = `${JKOS_AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}`
  }

  const checkAuth = async () => {
    try {
      const r = await apiFetch(`${apiUrl}/api/auth/me`)
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

  /* All API calls go through apiFetch which handles token refresh */
  const api = {
    get: (path: string) =>
      apiFetch(`${apiUrl}${path}`).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    post: (path: string, body: any) =>
      apiFetch(`${apiUrl}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    patch: (path: string, body: any) =>
      apiFetch(`${apiUrl}${path}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => {
        if (r.status === 401) { handleUnauth(); throw new Error('Unauthorized') }
        return r.json()
      }),
    del: (path: string) =>
      apiFetch(`${apiUrl}${path}`, { method: 'DELETE' }).then(r => {
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

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = () => setIsMobile(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [intro, setIntro]   = useState(false)
  const [colorIn, setColorIn] = useState(true)
  const [view, setView]                   = useState('today')
  const [items, setItems]                 = useState<any[]>([])
  const [loading, setLoading]             = useState(true)
  const [recentlyAdded, setRecentlyAdded] = useState(new Set<number>())
  const [accounts, setAccounts]           = useState(INITIAL_ACCOUNTS)
  const [selected, setSelected]           = useState<any>(null)
  const [showConnect, setShowConnect]     = useState(false)
  const [focusedGoalId, setFocusedGoalId] = useState<number | null>(null)
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
    const snapshot = items.find(it => it.id === id)
    setItems(prev => prev.filter(it => it.id !== id))
    setSelected((s: any) => s && s.id === id ? null : s)
    api.del(`/api/items/${id}`).catch((e: any) => {
      console.error('[onDelete]', e)
      if (snapshot) setItems(prev => [...prev, snapshot])
    })
  }

  const onAddItem = async (partial: any) => {
    const fresh = await api.post('/api/items', {
      kind: 'task', scope: 'day', completed: false, source: 'bb', ...partial,
    })
    if (!fresh?.id) throw new Error('Item creation failed')
    setItems(prev => [...prev, fresh])
    setRecentlyAdded(s => { const n = new Set(s); n.add(fresh.id); return n })
    setTimeout(() => {
      setRecentlyAdded(s => { const n = new Set(s); n.delete(fresh.id); return n })
    }, 600)
    return fresh
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

  /* AI features need both the instance flag and the suite-wide jkAuth switch */
  const aiEnabled =
    (import.meta.env.VITE_BB_AI_ENABLED as string) === 'true' && prefs.lazuros.enabled !== false

  const viewProps = {
    aiEnabled,
    items: visibleItems,
    today: TODAY_ISO,
    onSelect: setSelected,
    onToggle, onDelete, onAddItem, onUpdateItem, onAddTask,
    recentlyAdded,
    setView,
    selectedId: selected?.id,
    focusedGoalId, setFocusedGoalId,
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
          today={TODAY_ISO}
          onItemToggle={(id, completed) => {
            setItems(prev => prev.map(it => it.id === id ? { ...it, completed } : it))
            setSelected((s: any) => s && s.id === id ? { ...s, completed } : s)
            api.patch(`/api/items/${id}`, { completed })
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

      {effects.halation  && <Halation />}
      {effects.grain     && <FilmGrain strength={effects.grainStrength} />}
      {effects.scanLines && <ScanLines strength={effects.scanStrength} />}
      {effects.artifacts && <Artifacts />}

      <div style={{
        position: 'fixed', inset: 0,
        filter: colorIn ? 'saturate(1) brightness(1)' : 'saturate(0.04) brightness(0.08)',
        transition: colorIn ? 'filter 1.4s ease-out' : 'none',
        background: 'var(--color-paper)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gridTemplateColumns: selected ? '1fr 340px' : '1fr',
          background: 'var(--color-paper)',
          color: 'var(--color-ink)',
          filter: effects.halation ? 'url(#halation)' : undefined,
        }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <AppHeader
              view={view} setView={setView}
              today={TODAY_ISO}
              accounts={accounts}
              onConnectClick={() => setShowConnect(true)}
              onLogout={handleLogout}
              onOpenSettings={() => setSettingsOpen(true)}
              user={user}
            />
          </div>

          <main
            key={view}
            className={view === 'tasks' ? undefined : 'view-enter'}
            style={{ overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, opacity: 0.4 }}>
                Loading…
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
              setView={setView} setFocusedGoalId={setFocusedGoalId}
            />
          )}
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
