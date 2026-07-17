import { useState, useEffect } from 'react'
import './app.css'
import { injectJkOSTheme, STORAGE_KEYS } from '@jkos/design'
import { authFetch, AUTH_URL, useSessionKeepalive } from '@jkos/auth-client'
import { Sheet, Lab, Press, TButton } from '@jkos/ui'

// Set the mode before React hydrates to prevent a flash. Read the user's last-known
// preference (written by the design utils), fall back to paper.
if (!document.documentElement.hasAttribute('data-mode')) {
  const cached = (() => { try { return localStorage.getItem(STORAGE_KEYS.mode) } catch { return null } })()
  document.documentElement.setAttribute('data-mode', cached ?? 'paper')
}

// __NAME__'s per-app inputs to the @jkos/design factory. Sans/mono inherit the IBM Plex
// factory defaults; pass `fonts:{serif}` / `accent` / `radius` here to retune the app.
injectJkOSTheme({})

const API = (import.meta as any).env?.VITE_API_URL ?? ''
const JKOS_AUTH_URL = (import.meta as any).env?.VITE_JKOS_AUTH_URL ?? AUTH_URL

type Item = { id: number; title: string; done: boolean; tags: string[] }

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')

  // Keep the access token fresh so a long-open tab never 401s mid-session.
  useSessionKeepalive()

  const toAuthPortal = () =>
    { window.location.href = `${JKOS_AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}` }

  const load = async () => {
    try {
      const r = await authFetch(`${API}/api/items`)
      if (r.ok) setItems(await r.json())
    } catch { /* offline */ }
  }

  const checkAuth = async () => {
    try {
      const r = await authFetch(`${API}/api/auth/me`)
      if (r.ok) { const d = await r.json(); setUser(d.user); load() }
      else setUser(false)
    } catch { setUser(false) }
  }

  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (user === false) toAuthPortal() }, [user])

  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await authFetch(`${API}/api/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    })
    load()
  }

  const toggle = async (it: Item) => {
    await authFetch(`${API}/api/items/${it.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !it.done }),
    })
    load()
  }

  const remove = async (it: Item) => {
    await authFetch(`${API}/api/items/${it.id}`, { method: 'DELETE' })
    load()
  }

  if (!user) return null   // redirecting to the auth portal, or first paint

  return (
    <div className="app">
      <header className="app-header">
        <Press as="h1" style={{ margin: 0 }}>__NAME__</Press>
        <Lab size="sm">{items.length} item{items.length === 1 ? '' : 's'}</Lab>
      </header>

      <div className="add-row">
        <input
          value={draft}
          placeholder="Add an item…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <TButton onClick={add}>Add</TButton>
      </div>

      {items.length === 0
        ? <div className="empty">Nothing yet — add your first item above.</div>
        : items.map((it) => (
            <Sheet key={it.id} className={`item${it.done ? ' done' : ''}`}>
              <input type="checkbox" checked={it.done} onChange={() => toggle(it)} />
              <span className="item-title" onClick={() => toggle(it)}>{it.title}</span>
              <TButton quiet onClick={() => remove(it)}>Delete</TButton>
            </Sheet>
          ))}
    </div>
  )
}
