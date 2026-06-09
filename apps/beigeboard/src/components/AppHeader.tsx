import React, { useState, useEffect } from 'react'
import { FONT_HEAD, FONT_BODY, FONT_NUM, localDate, sourceOf } from '../lib/theme'
import { TimeReadout } from './SharedComponents'

const NAV_TABS = [
  { id: 'today',    label: 'Today',    sub: 'now' },
  { id: 'week',     label: 'Week',     sub: '7 days' },
  { id: 'calendar', label: 'Calendar', sub: 'month' },
  { id: 'tasks',    label: 'Tasks',    sub: 'workshop' },
]

function initials(name?: string, email?: string): string {
  const src = (name || email || '?').trim()
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0].toUpperCase()
}

export function AppHeader({ view, setView, today, onConnectClick, onLogout, onOpenSettings, accounts, user }: any) {
  const d    = localDate(today)
  const week = Math.ceil(((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000) / 7)
  const [scrolled, setScrolled] = useState(false)
  const connected = accounts.filter((a: any) => a.connected).length

  useEffect(() => {
    const onScroll = (e: Event) => setScrolled(((e.target as any)?.scrollTop || 0) > 4)
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  return (
    <header style={{
      background: 'var(--color-paper)',
      borderBottom: '1px solid var(--color-line)',
      padding: '0 28px',
      height: 56,
      flexShrink: 0,
      boxShadow: scrolled ? '0 2px 24px rgba(0,0,0,0.4)' : 'none',
      transition: 'box-shadow 0.25s',
      zIndex: 100,
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      alignItems: 'center',
      gap: 20,
    }}>
      {/* Left: wordmark + date badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontStyle: 'italic',
          fontSize: 20, color: 'var(--color-accent)',
          letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0,
          textShadow: '0 0 12px var(--color-accent-glow)',
        }}>BeigeBoard</span>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px',
          background: 'var(--color-card)',
          border: '1px solid var(--color-line)',
          borderRadius: 2,
          fontFamily: FONT_NUM, fontSize: 11,
          color: 'var(--color-muted)',
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ color: 'var(--color-accent)', fontStyle: 'italic' }}>
            W{String(week).padStart(2, '0')}
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Center: clean nav tabs */}
      <nav role="tablist" aria-label="Primary" style={{ display: 'flex', gap: 2 }}>
        {NAV_TABS.map(tab => (
          <NavTab key={tab.id} tab={tab} active={view === tab.id} onClick={() => setView(tab.id)} />
        ))}
      </nav>

      {/* Right: sources, time, profile */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {user?.role === 'guest' && (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 9, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'var(--color-faint)',
            border: '1px solid var(--color-line)', padding: '3px 8px',
          }}>Guest</span>
        )}

        <button
          onClick={onConnectClick}
          title="Manage connected calendars"
          style={{
            background: 'transparent', border: 'none',
            fontFamily: FONT_BODY, fontSize: 10, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'var(--color-muted)', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center', gap: 7,
          }}
        >
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {accounts.slice(0, 4).map((a: any) => (
              <span key={a.id} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: a.connected ? sourceOf(a.id).hex : 'var(--color-line-strong)',
                opacity: a.connected ? 0.9 : 0.3,
                boxShadow: a.connected ? `0 0 4px ${sourceOf(a.id).hex}80` : 'none',
              }} />
            ))}
          </span>
          {connected > 0 ? `${connected} sources` : 'connect'}
        </button>

        <span style={{ width: 1, height: 14, background: 'var(--color-line)' }} />
        <TimeReadout />
        <span style={{ width: 1, height: 14, background: 'var(--color-line)' }} />

        {user && (
          <button
            onClick={onOpenSettings}
            aria-label="Open settings"
            title={user.name || user.email}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--color-accent-deep)',
              border: '1.5px solid var(--color-line-strong)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_HEAD, fontStyle: 'italic', fontSize: 11, fontWeight: 600,
              color: 'var(--color-accent-bright)', cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              boxShadow: 'none',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 8px var(--color-accent-glow)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.boxShadow = 'none'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--color-line-strong)'
            }}
          >
            {initials(user.name, user.email)}
          </button>
        )}
      </div>
    </header>
  )
}

function NavTab({ tab, active, onClick }: any) {
  const [hover, setHover] = useState(false)
  const isLit = active || hover

  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active ? 'var(--color-accent-soft)' : (hover ? 'var(--color-card)' : 'transparent'),
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
        padding: '8px 18px',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <div style={{
        fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: active ? 'var(--color-accent)' : (hover ? 'var(--color-ink)' : 'var(--color-muted)'),
        lineHeight: 1.1,
        transition: 'color 0.12s',
      }}>{tab.label}</div>
      <div style={{
        fontFamily: FONT_NUM, fontStyle: 'italic', fontSize: 10,
        color: 'var(--color-faint)', marginTop: 2, lineHeight: 1,
        opacity: isLit ? 0.85 : 0.5,
      }}>{tab.sub}</div>
    </button>
  )
}
