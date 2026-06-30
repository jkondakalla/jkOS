/**
 * CalendarDragProvider — the calendar's drop layer over @jkos/ui's usePointerDrag.
 *
 * Owns the DOM drop-zone hit-test (elementsFromPoint + data-drop-zone /
 * data-frac-*) and the floating ghost; the gesture mechanics (threshold/hold,
 * pointer capture, post-drag click suppression, touch support) come from
 * usePointerDrag, so the SAME engine drives BeigeBoard's calendar and ORDECK's
 * widget grid. This replaces BeigeBoard's old mouse-only DragProvider — which is
 * what makes calendar reschedule work on touch.
 *
 * Activation is pointer-type aware: mouse/pen → a 4px distance threshold (the
 * instant desktop feel preserved); touch → a press-and-hold so a drag never
 * hijacks the time grid's native scroll. The context value stays
 * `{ drag, beginDrag }` — the existing DragAdapter shape — so the views that
 * consume it are untouched apart from passing the originating pointer event.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { usePointerDrag, DRAG_THRESHOLD_PX, HOLD_MS } from '@jkos/ui';
import type { DragAdapter, DragState, DropInfo } from './types';
import { fmtTime, fracToTime, snapFrac } from './datetime';
import { FONT_BODY } from './theme';

/** Touch press-and-hold before a calendar drag picks up (shares the suite hold). */
const TOUCH_HOLD_MS = HOLD_MS;
/** Roomier than ORDECK's 5px — calendar grids scroll, so tolerate finger jitter. */
const TOUCH_HOLD_CANCEL_PX = 8;

const CalendarDragCtx = createContext<DragAdapter | null>(null);

/** The drag adapter for a host's views. Returns a no-op adapter outside a
 *  provider so a view rendered read-only (e.g. an ORDECK widget) is safe. */
export const useCalendarDrag = (): DragAdapter =>
  useContext(CalendarDragCtx) ?? { drag: null, beginDrag: () => {} };

export interface CalendarDragProviderProps {
  children: React.ReactNode;
  /** Colours the ghost for source-coloured events (BeigeBoard injects sourceOf). */
  sourceColorOf?: (source?: string) => string;
}

/** Which drop zone (and time fraction) sits under a screen point. Ported from
 *  BeigeBoard's DragProvider — the data-* DOM contract is unchanged so every view
 *  keeps working. elementsFromPoint hit-tests by coordinate independently of
 *  pointer capture, so it still finds the lane/cell beneath the dragged element. */
function resolveDrop(clientX: number, clientY: number): DropInfo {
  let overDay: string | null = null;
  let overZone: string | null = null;
  let overFrac: number | null = null;
  try {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const zone = (el as HTMLElement).getAttribute?.('data-drop-zone');
      if (!zone) continue;
      overZone = zone;
      overDay = (el as HTMLElement).getAttribute('data-drop-day') || null;
      if (zone === 'timed') {
        const fracBase = parseFloat((el as HTMLElement).getAttribute('data-frac-base') ?? '6');
        const fracScale = parseFloat((el as HTMLElement).getAttribute('data-frac-scale') ?? '48');
        const r = el.getBoundingClientRect();
        overFrac = snapFrac(fracBase + (clientY - r.top) / fracScale);
      }
      break;
    }
  } catch { /* elementsFromPoint can throw on detached nodes */ }
  return { overDay, overFrac, overZone };
}

export function CalendarDragProvider({ children, sourceColorOf }: CalendarDragProviderProps) {
  const { begin } = usePointerDrag();
  const [drag, setDrag] = useState<DragState | null>(null);

  const beginDrag = useCallback<DragAdapter['beginDrag']>((e, item, mode, onDrop, opts = {}) => {
    const activation = e.pointerType === 'touch'
      ? { kind: 'hold' as const, delay: TOUCH_HOLD_MS, cancelDistance: TOUCH_HOLD_CANCEL_PX }
      : { kind: 'distance' as const, threshold: DRAG_THRESHOLD_PX };

    // The latest resolved drop, captured on each move so onEnd can commit it.
    let landed: DropInfo = { overDay: opts.startDay ?? null, overFrac: opts.startFrac ?? null, overZone: null };

    begin(e, {
      activation,
      onActivate: (c) => setDrag({
        item, mode, ...opts,
        x: c.x, y: c.y, startX: c.startX, startY: c.startY,
        overDay: null, overFrac: null, overZone: null,
      }),
      onMove: (c) => {
        landed = resolveDrop(c.x, c.y);
        setDrag((d) => (d ? { ...d, x: c.x, y: c.y, ...landed } : d));
      },
      onEnd: (_c, activated) => {
        // A real drag drops where it ended; a plain click falls back to where it
        // began (so 'create' still opens the dialog and other modes harmlessly no-op).
        const info = activated
          ? landed
          : { overDay: opts.startDay ?? null, overFrac: opts.startFrac ?? null, overZone: null };
        try { onDrop?.(info); } catch { /* a host handler error must not wedge the drag */ }
        setDrag(null);
      },
      onCancel: () => setDrag(null),
    });
  }, [begin]);

  return (
    <CalendarDragCtx.Provider value={{ drag, beginDrag }}>
      {children}
      {drag && <DragGhost drag={drag} sourceColorOf={sourceColorOf} />}
    </CalendarDragCtx.Provider>
  );
}

/** The floating label that trails the pointer during a drag. Ported from
 *  BeigeBoard's DragGhost; colour now comes from the injected resolver + kit
 *  tokens, so the kit carries no app import. */
function DragGhost({ drag, sourceColorOf }: { drag: DragState; sourceColorOf?: (source?: string) => string }) {
  const { item, mode, overZone, overFrac, overDay } = drag;
  const x = drag.x ?? 0;
  const y = drag.y ?? 0;
  if (!x && !y) return null;

  const color =
    item?.accent ||
    (item?.source && sourceColorOf ? sourceColorOf(item.source) : null) ||
    'var(--color-accent)';

  const title = item?.title || (mode === 'create' ? 'New event' : '—');

  let hint = '';
  if (mode === 'create') {
    hint = overFrac != null ? fmtTime(fracToTime(overFrac)) : 'draw time range';
  } else if (overZone === 'timed' && overFrac != null) {
    hint = `${fmtTime(fracToTime(overFrac))} · time block`;
  } else if (overZone === 'allday') {
    hint = 'all-day';
  } else if (overZone === 'untimed') {
    hint = 'untimed';
  } else if (overZone === 'cell') {
    hint = overDay || 'reschedule';
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
          border: '1px solid var(--color-line)',
          color: 'var(--color-muted)',
          fontFamily: FONT_BODY, fontSize: 8.5,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 'var(--hub-radius-xs)',
        }}>{hint}</div>
      )}
    </div>
  );
}
