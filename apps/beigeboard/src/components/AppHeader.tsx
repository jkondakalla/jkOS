import React, { useState, useEffect } from 'react'
import { FONT_HEAD, localDate, sourceOf } from '../lib/theme'
import { Press, Lab } from '@jkos/ui'
import { TimeReadout } from './SharedComponents'

// The Voice (DESIGN.md §5): the nav labels are things a human READS — they print
// in Fraunces; only the machine annotations (tab sublines, the sources readout)
// keep the mono voice.
const MONO = 'var(--hub-font-mono)'

const NAV_TABS = [
  { id: 'today',    label: 'Today',    sub: 'now' },
  { id: 'week',     label: 'Week',     sub: '7 days' },
  { id: 'calendar', label: 'Calendar', sub: 'month' },
  { id: 'tasks',    label: 'Workshop', sub: 'goals' },
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
      {/* Left: pressed wordmark + the folio mark. The folio (running-head rules,
          serif caps, accent-italic number) names the EDITION — today's sheet and
          its week number — replacing the two bordered badges it used to take. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <Press as="span" style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontStyle: 'italic',
          fontSize: 20, letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0,
        }}>BeigeBoard</Press>

        <span className="jk-folio" style={{ flexShrink: 0 }}>
          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          <span className="jk-folio-no">Wk {String(week).padStart(2, '0')}</span>
        </span>
      </div>

      {/* Center: nav tabs — active tab is a struck well + pressed label */}
      <nav role="tablist" aria-label="Primary" style={{ display: 'flex', gap: 4 }}>
        {NAV_TABS.map(tab => (
          <NavTab key={tab.id} tab={tab} active={view === tab.id} onClick={() => setView(tab.id)} />
        ))}
      </nav>

      {/* Right: sources, time, profile */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {user?.role === 'guest' && (
          <Lab size="sm" as="span" style={{ border: '1px solid var(--color-line)', padding: '3px 8px' }}>Guest</Lab>
        )}

        <button
          onClick={onConnectClick}
          title="Manage connected calendars"
          style={{
            background: 'transparent', border: 'none',
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.16em',
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
      className={active ? 'jk-well' : undefined}
      style={{
        background: active ? undefined : (hover ? 'var(--color-card)' : 'transparent'),
        border: 'none',
        borderRadius: 'var(--hub-radius-sm)',
        padding: '6px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transition: 'background 0.12s',
      }}
    >
      <span
        className={active ? 'jk-press' : undefined}
        style={{
          // Printed, not typed — Fraunces tracked caps (the .jk-lab cut); the
          // machine subline below keeps mono.
          fontFamily: FONT_HEAD, fontSize: 11.5, fontWeight: 600,
          letterSpacing: '0.15em', textTransform: 'uppercase',
          color: active ? undefined : (hover ? 'var(--color-ink)' : 'var(--color-muted)'),
          lineHeight: 1.1,
          transition: 'color 0.12s',
        }}
      >{tab.label}</span>
      <span style={{
        fontFamily: MONO, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--color-faint)', marginTop: 3, lineHeight: 1,
        opacity: isLit ? 0.85 : 0.5,
      }}>{tab.sub}</span>
    </button>
  )
}
