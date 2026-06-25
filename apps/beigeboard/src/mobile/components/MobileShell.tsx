import React, { useState, useEffect } from 'react'
import { FONT_HEAD, FONT_NUM, localDate } from '../../lib/theme'
import { RecLamp, Eyebrow } from './MobileWidgets'
import { Press, Lab } from '@jkos/ui'

/**
 * Mobile Header — compact, with live clock and day info
 */

function TimeReadout() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  return (
    <span
      style={{
        fontFamily: FONT_NUM,
        fontStyle: 'italic',
        fontSize: 13,
        color: 'var(--color-accent)',
        letterSpacing: '0.06em',
        textShadow: 'var(--accent-halo-text)',
      }}
    >
      {hh}
      <span style={{ opacity: 0.4 }}>:</span>
      {mm}
      <span style={{ opacity: 0.55, fontSize: 10 }}>:{ss}</span>
    </span>
  )
}

export interface MobileHeaderProps {
  today: string
}

export function MobileHeader({ today }: MobileHeaderProps) {
  const d = localDate(today)
  const week = Math.ceil(((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000) / 7)

  return (
    <header
      style={{
        flexShrink: 0,
        padding: '14px 18px 12px',
        borderBottom: `1px solid ${'var(--color-line)'}`,
        background: 'var(--color-paper)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <Press
          as="span"
          style={{
            fontFamily: FONT_HEAD,
            fontWeight: 600,
            fontStyle: 'italic',
            fontSize: 18,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            paddingRight: 10,
          }}
        >
          BeigeBoard
        </Press>
        <Lab
          size="sm"
          as="span"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            height: 19,
            padding: '0 8px',
            boxSizing: 'border-box',
            border: '1px solid var(--color-line)',
            borderRadius: 2,
          }}
        >
          W{week}
        </Lab>
      </div>

      <TimeReadout />
    </header>
  )
}

/**
 * Mobile Bottom Navigation
 */

export interface BottomNavProps {
  view: string
  setView: (id: string) => void
  onAdd: () => void
  variant: 'transport' | 'linear' | string
}

const VIEWS = [
  { id: 'today', label: 'Today', glyph: '◉' },
  { id: 'week', label: 'Week', glyph: '▦' },
  { id: 'calendar', label: 'Calendar', glyph: '▤' },
  { id: 'tasks', label: 'Tasks', glyph: '⛁' },
]

export function MobileBottomNav({ view, setView, onAdd, variant }: BottomNavProps) {

  return (
    <nav
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '8px 0',
        borderTop: `1px solid ${'var(--color-line)'}`,
        background: 'var(--color-paper)',
        height: 44,
      }}
    >
      {VIEWS.map((v, idx) => {
        const isActive = v.id === view
        return (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
              textShadow: isActive ? 'var(--accent-halo-text)' : 'none',
              transition: 'color 0.2s',
              borderTop: isActive ? `2px solid ${'var(--color-accent)'}` : '2px solid transparent',
              paddingTop: 0,
            }}
          >
            <span
              style={{
                fontSize: 16,
                lineHeight: 1,
                textShadow: isActive ? 'var(--accent-halo-text)' : 'none',
              }}
            >
              {v.glyph}
            </span>
            <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {v.label.slice(0, 2)}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
