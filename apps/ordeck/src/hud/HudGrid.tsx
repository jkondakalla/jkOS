/**
 * hud/HudGrid.tsx — the custom responsive grid renderer + iOS hold-to-move.
 *
 * Measures its own width, resolves the active breakpoint, asks the engine for the
 * placed layout, and paints it as a CSS grid. Interaction is pointer-based:
 *   • Not in edit mode — press-and-HOLD a card ~500ms (finger still, <5px) to pick
 *     it up; that also flips the HUD into edit mode. A quick tap/scroll is left
 *     alone, so cards stay clickable and the page still scrolls.
 *   • In edit mode — any card lifts immediately on press (iOS "jiggle" feel).
 * A lifted card follows the pointer and, on release, snaps onto whatever card it
 * was dropped over; the engine repacks the rest (vertical compaction, no overlap).
 */

import {
  useRef, useState, useEffect,
  type ReactNode, type RefObject, type PointerEvent as ReactPointerEvent,
} from 'react';
import { activeBreakpoint, layoutForBreakpoint, compactVertical, placeAtBottom } from './engine';
import type { BreakpointName, GridItem, HudState, WidgetDef } from './types';
import './grid.css';

const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_GAP = 18;
const HOLD_MS = 500;        // long-press duration to pick a card up (outside edit mode)
const MOVE_CANCEL_PX = 5;   // movement before the hold completes = scroll/tap, not a drag

interface HudGridProps {
  state: HudState;
  /** When true, cells gain a remove affordance (→ shelf), an edit outline, and
   *  immediate pickup. A long-press turns this on via onRequestEdit. */
  editMode?: boolean;
  onRemove?: (id: string) => void;
  /** Called when a long-press picks a card up while not yet in edit mode. */
  onRequestEdit?: () => void;
  /** Persist a reordered layout for the active breakpoint. */
  onLayoutChange?: (bp: BreakpointName, items: GridItem[]) => void;
  rowHeight?: number;
  gap?: number;
  renderWidget: (def: WidgetDef, item: GridItem) => ReactNode;
}

function useContainerWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1200),
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function HudGrid({
  state,
  editMode = false,
  onRemove,
  onRequestEdit,
  onLayoutChange,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = DEFAULT_GAP,
  renderWidget,
}: HudGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const bp = activeBreakpoint(width);
  const items = layoutForBreakpoint(state, bp);

  // Pointer-drag state. `press` is the live gesture (ref — no re-render on move);
  // `drag` drives the lifted card's transform; `justDragged` swallows the click
  // that fires after a drag so a long-pressed link/card doesn't also activate.
  const press = useRef<{ id: string; sx: number; sy: number; active: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const justDragged = useRef(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  function activate() {
    const p = press.current;
    if (!p || p.active) return;
    p.active = true;
    if (!editMode) onRequestEdit?.();
    setDrag({ id: p.id, dx: 0, dy: 0 });
  }

  function onPointerDown(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    // Never start a drag from the remove button.
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    press.current = { id, sx: e.clientX, sy: e.clientY, active: false, timer: null };
    if (editMode) activate();
    else press.current.timer = setTimeout(activate, HOLD_MS);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
    if (!p.active) {
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        if (p.timer) clearTimeout(p.timer);
        press.current = null;   // moved before the hold completed → tap/scroll
      }
      return;
    }
    e.preventDefault();
    setDrag({ id: p.id, dx, dy });
  }

  function onPointerUp(e: ReactPointerEvent) {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p?.active) {
      justDragged.current = true;
      drop(e.clientX, e.clientY, p.id);
    }
    press.current = null;
    setDrag(null);
  }

  function drop(x: number, y: number, id: string) {
    if (!onLayoutChange) return;
    const cellEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.hud-cell');
    const targetId = cellEl?.getAttribute('data-id') ?? null;
    if (targetId === id) return;
    if (targetId) {
      const target = items.find((i) => i.i === targetId);
      if (!target) return;
      // A takes B's slot (just above, via the −0.5 sort bias); engine repacks.
      const moved = items.map((it) => (it.i === id ? { ...it, x: target.x, y: target.y - 0.5 } : it));
      onLayoutChange(bp.name, compactVertical(moved, bp.cols));
    } else {
      // Released over empty space → send the card to the bottom of the stack.
      const me = items.find((it) => it.i === id);
      if (!me) return;
      const rest = items.filter((it) => it.i !== id);
      onLayoutChange(bp.name, placeAtBottom(rest, id, { w: me.w, h: me.h }, bp.cols));
    }
  }

  return (
    <div
      ref={ref}
      className={`hud-canvas${editMode ? ' editing' : ''}`}
      data-bp={bp.name}
      style={{
        gridTemplateColumns: `repeat(${bp.cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap: `${gap}px`,
      }}
    >
      {items.map((item) => {
        const def = state.widgets[item.i];
        if (!def) return null;
        const lifting = drag?.id === item.i;
        return (
          <div
            key={item.i}
            data-id={item.i}
            className={`hud-cell${lifting ? ' dragging' : ''}`}
            onPointerDown={(e) => onPointerDown(e, item.i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClickCapture={(e) => {
              if (justDragged.current) { e.preventDefault(); e.stopPropagation(); justDragged.current = false; }
            }}
            style={{
              gridColumn: `${item.x + 1} / span ${item.w}`,
              gridRow: `${item.y + 1} / span ${item.h}`,
              touchAction: editMode ? 'none' : undefined,
              ...(lifting && drag
                ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.03)`, zIndex: 50, transition: 'none' }
                : null),
            }}
          >
            {editMode && onRemove && (
              <button
                className="hud-edit-remove hud-cell-remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(item.i)}
                title={`Shelve ${def.label}`}
              >
                ×
              </button>
            )}
            {renderWidget(def, item)}
          </div>
        );
      })}
    </div>
  );
}
