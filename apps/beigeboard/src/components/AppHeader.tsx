/**
 * AppHeader — BeigeBoard's masthead.
 *
 * Set as a printed masthead, not built as a toolbar. What this replaced was an
 * opaque --color-paper bar with a square border-bottom and a black drop shadow,
 * and every complaint about it came down to one thing: it was a SLAB. Because the
 * canvas is a measure floating on the grained ground, that bar's left, right and
 * bottom edges were square cuts in mid-air, and its opaque fill was the one place
 * in the app where the ground's grain stopped — a flat rectangle cut out of the
 * top of the sheet the whole page is printed on.
 *
 * A masthead is type at the top of the sheet with rules under it. So:
 *
 *   · NO fill and NO border (.jk-masthead) — the grain runs unbroken from the
 *     first pixel, and the bottom edge is the INLAY: the suite's one piece of
 *     metal, a tapered bead that dies into the ground at both ends rather than
 *     being cropped (hammered steel let into the sheet on paper, a lit silver
 *     blade on the tube — see --jk-inlay-* in hub.css). It says "the page starts
 *     below this line" without drawing a box to say it.
 *   · The edition reads as a FOLIO MARK (.jk-folio) — the house primitive for
 *     naming content in print, its own running-head rules above and below, count
 *     slot in accent italic. It replaces two bordered chips, i.e. two more rounded
 *     boxes competing with every other rounded box on the page.
 *   · Nav is BOXED (.jk-masthead-tab + .jk-well when current). It spent one pass
 *     as a fill-less thumb-index and came back, for a reason worth keeping
 *     written down: a filled box states the FACE instantly (debossed tint on
 *     paper, emissive ring on the tube) where a weight change and a 2px accent
 *     stub state nothing. The nav is the first thing looked at, so it is where
 *     the mode has to be legible.
 *   · No scroll shadow. The old one hung a pure-black `0 2px 24px` drop off the
 *     bar on any inner scroll — a shadow with no face (wrong in both modes) for a
 *     job that doesn't exist: each view scrolls inside its own .jk-scroll pane, so
 *     nothing ever passes under the masthead. The inlay is the boundary.
 *
 * The Voice (DESIGN.md §5): the wordmark and the folio print in Fraunces; the nav
 * labels and the sources readout keep the mono machine voice.
 */
import React, { useState } from 'react'
import { FONT_HEAD, localDate, sourceOf } from '../lib/theme'
import { Press } from '@jkos/ui'
import { TimeReadout } from './SharedComponents'

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

export function AppHeader({ view, setView, today, onConnectClick, onOpenSettings, accounts, user }: any) {
  const d    = localDate(today)
  const week = Math.ceil(((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000) / 7)
  const connected = accounts.filter((a: any) => a.connected).length

  return (
    <header
      className="jk-masthead"
      style={{
        /* Matches the views' 28px inset — the masthead sits inside the canvas
           (App.tsx spans header+main with one .jk-canvas), so the flag must hang
           on the same left margin the content below it does. */
        padding: '0 28px 5px',
        height: 64,
        zIndex: 100,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 20,
      }}
    >
      {/* Left: the flag — pressed serif wordmark, then the edition as a folio mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <Press as="span" style={{
          fontFamily: FONT_HEAD, fontWeight: 600, fontStyle: 'italic',
          fontSize: 22, letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0,
        }}>BeigeBoard</Press>

        <span className="jk-folio" style={{ flexShrink: 0 }}>
          W{String(week).padStart(2, '0')}
          <span className="jk-folio-no">
            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </span>
      </div>

      {/* Center: the boxed nav */}
      <nav role="tablist" aria-label="Primary" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {NAV_TABS.map(tab => (
          <NavTab key={tab.id} tab={tab} active={view === tab.id} onClick={() => setView(tab.id)} />
        ))}
      </nav>

      {/* Right: sources, time, profile */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {user?.role === 'guest' && (
          <>
            <span className="jk-lab jk-lab-xs">Guest</span>
            <span className="jk-divider" />
          </>
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
              }} />
            ))}
          </span>
          {connected > 0 ? `${connected} sources` : 'connect'}
        </button>

        <span className="jk-divider" />
        <TimeReadout />
        <span className="jk-divider" />

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

/** One boxed nav tab. The box IS the state: .jk-masthead-tab carries the reset
 *  and the hover fill, and the current tab adds .jk-well — the same debossed /
 *  emissive region primitive the rest of the suite uses, so the tab flips face
 *  with everything else instead of owning a private recipe. JS is left with the
 *  type's weight and colour only. */
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
      className={active ? 'jk-masthead-tab jk-well' : 'jk-masthead-tab'}
      style={{
        padding: '7px 18px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <span
        className={active ? 'jk-press' : undefined}
        style={{
          fontFamily: MONO, fontSize: 11, fontWeight: active ? 600 : 500,
          letterSpacing: '0.18em', textTransform: 'uppercase',
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
