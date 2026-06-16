import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { FONT_BODY, sourceOf, fmtTime } from '../lib/theme'

const DragCtx = createContext<any>(null)
export const useDrag = () => useContext(DragCtx)

export const fracToTime = (frac: number) => {
  const h = Math.max(0, Math.min(23, Math.floor(frac)))
  const m = Math.max(0, Math.min(59, Math.round((frac % 1) * 60)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
export const snapFrac = (frac: number, step = 0.25) => Math.round(frac / step) * step

export function DragProvider({ children }: { children: React.ReactNode }) {
  const [drag, setDrag] = useState<any>(null)
  const dragRef = useRef<any>(null)

  const beginDrag = useCallback((item: any, mode: string, onDrop: any, opts: any = {}) => {
    const d = { item, mode, onDrop, x: 0, y: 0, overDay: null, overFrac: null, overZone: null, ...opts }
    dragRef.current = d
    setDrag({ ...d })
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return

      let overDay = null, overZone = null, overFrac = null
      try {
        const els = document.elementsFromPoint(e.clientX, e.clientY)
        for (const el of els) {
          const zone = (el as HTMLElement).getAttribute?.('data-drop-zone')
          if (!zone) continue
          overZone = zone
          overDay  = (el as HTMLElement).getAttribute('data-drop-day') || null

          if (zone === 'timed') {
            const fracBase  = parseFloat((el as HTMLElement).getAttribute('data-frac-base')  ?? '6')
            const fracScale = parseFloat((el as HTMLElement).getAttribute('data-frac-scale') ?? '48')
            // getBoundingClientRect() already reflects scroll position — no manual offset needed
            const r = el.getBoundingClientRect()
            overFrac = snapFrac(fracBase + (e.clientY - r.top) / fracScale)
          }
          break
        }
      } catch (_) {}

      const next = { ...d, x: e.clientX, y: e.clientY, overDay, overFrac, overZone }
      dragRef.current = next
      setDrag({ ...next })
    }

    const onUp = () => {
      const d = dragRef.current
      if (!d) return
      try { d.onDrop?.({ overDay: d.overDay, overFrac: d.overFrac, overZone: d.overZone }) } catch (_) {}
      dragRef.current = null
      setDrag(null)
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseup',  onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',  onUp)
    }
  }, [])

  return (
    <DragCtx.Provider value={{ drag, beginDrag }}>
      {children}
      {drag && <DragGhost drag={drag} />}
    </DragCtx.Provider>
  )
}

function DragGhost({ drag }: { drag: any }) {
  const { item, mode, x, y, overZone, overFrac, overDay } = drag
  if (!x && !y) return null

  const color = item?.accent
    || (item?.source ? sourceOf(item.source)?.hex : null)
    || 'var(--color-accent)'

  const title = item?.title || (mode === 'create' ? 'New event' : '—')

  let hint = ''
  if (mode === 'create') {
    hint = overFrac != null ? fmtTime(fracToTime(overFrac)) : 'draw time range'
  } else if (overZone === 'timed' && overFrac != null) {
    hint = `${fmtTime(fracToTime(overFrac))} · time block`
  } else if (overZone === 'allday') {
    hint = 'all-day'
  } else if (overZone === 'untimed') {
    hint = 'untimed'
  } else if (overZone === 'cell') {
    hint = overDay || 'reschedule'
  }

  return (
    <div style={{
      position: 'fixed', left: x + 10, top: y - 14,
      zIndex: 9999, pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
    }}>
      <div style={{
        background: color,
        color: 'rgba(255,255,255,0.96)',
        fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500,
        padding: '4px 10px',
        borderRadius: 6,
        boxShadow: `0 3px 16px rgba(0,0,0,0.45), 0 0 10px ${color}66`,
        maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{title}</div>
      {hint && (
        <div style={{
          background: 'var(--color-paper-2)',
          border: `1px solid var(--color-line)`,
          color: 'var(--color-muted)',
          fontFamily: FONT_BODY, fontSize: 8.5,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 3,
        }}>{hint}</div>
      )}
    </div>
  )
}
