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

// A press must travel this far (px) before it counts as a drag rather than a
// click. Below it, mouseup is treated as a click so events select (→ detail
// panel) and empty grid cells open the create dialog, instead of every press
// starting a drag.
const DRAG_THRESHOLD = 4

export function DragProvider({ children }: { children: React.ReactNode }) {
  const [drag, setDrag] = useState<any>(null)
  const dragRef    = useRef<any>(null)   // the ACTIVE drag (null until threshold crossed)
  const pendingRef = useRef<any>(null)   // armed on mousedown, awaiting movement
  const downRef    = useRef({ x: 0, y: 0 })
  const suppressClickRef = useRef(false)

  const beginDrag = useCallback((item: any, mode: string, onDrop: any, opts: any = {}) => {
    const { x, y } = downRef.current
    // Arm the drag but don't activate (no ghost / no `drag` state) until the
    // pointer crosses DRAG_THRESHOLD. A stationary press stays a click.
    pendingRef.current = {
      item, mode, onDrop,
      x, y, startX: x, startY: y,
      overDay: null, overFrac: null, overZone: null, ...opts,
    }
    dragRef.current = null
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      downRef.current = { x: e.clientX, y: e.clientY }
      // A fresh, deliberate press must never inherit a stale suppress flag. If a drag
      // ended without firing the trailing click we swallow (e.g. mouseup outside the
      // window), suppressClickRef would otherwise eat the user's NEXT real click.
      suppressClickRef.current = false
    }

    const onMove = (e: MouseEvent) => {
      const p = pendingRef.current
      if (!p) return

      // Promote the armed press to a real drag once it has moved far enough.
      if (!dragRef.current) {
        const dx = e.clientX - p.startX
        const dy = e.clientY - p.startY
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
        dragRef.current = { ...p }
        setDrag({ ...p })
      }

      const d = dragRef.current
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
      const p = pendingRef.current
      if (!p) return
      const d = dragRef.current
      // Drag dropped → use where it ended; click → fall back to where it began
      // (so `create` still opens the dialog and other modes harmlessly no-op).
      const info = d
        ? { overDay: d.overDay, overFrac: d.overFrac, overZone: d.overZone }
        : { overDay: p.startDay ?? null, overFrac: p.startFrac ?? null, overZone: null }
      pendingRef.current = null
      dragRef.current = null
      try { p.onDrop?.(info) } catch (_) {}
      // A real drag fires a trailing click on the element — swallow it so a
      // reschedule doesn't also select the item.
      if (d) suppressClickRef.current = true
      setDrag(null)
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      e.stopPropagation()
      e.preventDefault()
    }

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseup',  onUp)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',  onUp)
      document.removeEventListener('click', onClickCapture, true)
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
        borderRadius: 'var(--hub-radius-soft)',
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
          padding: '2px 7px', borderRadius: 'var(--hub-radius-xs)',
        }}>{hint}</div>
      )}
    </div>
  )
}
