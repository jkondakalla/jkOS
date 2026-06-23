/**
 * hud/HudGrid.tsx — the responsive grid renderer + iOS hold-to-move.
 *
 * Rendering model: the grid area is `position: relative` and every cell is
 * absolutely positioned from its grid coordinates — left/top/width/height are
 * pure functions of (x, y, w, h, colWidth, rowHeight, gap). That one decision is
 * what makes dragging robust:
 *
 *   • Pointer → grid cell is plain arithmetic (round(px / step)), never
 *     elementFromPoint (which would just return the lifted card itself).
 *   • While a card is held, its target cell drives a LIVE layout: the engine
 *     repacks everyone else and a placeholder shows exactly where it will land.
 *   • The lifted card floats at the pointer; on release it commits + snaps.
 *
 * Interaction: press-and-HOLD ~500ms (finger still, <5px) to pick a card up —
 * that also enters edit mode. In edit mode any card lifts immediately. Quick
 * taps/scroll are left alone; the post-drag click is swallowed so links survive.
 */

import {
  useRef, useState, useLayoutEffect,
  type ReactNode, type RefObject, type PointerEvent as ReactPointerEvent,
} from 'react';
import { activeBreakpoint, layoutForBreakpoint, compactVertical, bottom } from './engine';
import type { BreakpointName, GridItem, HudState, WidgetDef } from './types';
import './grid.css';

const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_GAP = 18;
const HOLD_MS = 500;        // press-and-hold to pick a card up (outside edit mode)
const MOVE_CANCEL_PX = 5;   // movement before the hold completes = scroll/tap, not a drag

interface HudGridProps {
  state: HudState;
  editMode?: boolean;
  /** When set, that cell is emphasised and every other cell dims (focus mode). */
  highlightId?: string;
  onRemove?: (id: string) => void;
  /** Fired when the edit (pencil) affordance is used on a spec-based card. */
  onEdit?: (id: string) => void;
  /** Fired when a long-press picks a card up while not yet in edit mode. */
  onRequestEdit?: () => void;
  onLayoutChange?: (bp: BreakpointName, items: GridItem[]) => void;
  rowHeight?: number;
  gap?: number;
  renderWidget: (def: WidgetDef, item: GridItem) => ReactNode;
}

/** Live gesture (a ref — pointer moves must not re-render until a drag begins). */
interface Press {
  id: string;
  el: HTMLElement;                   // the cell node — captured once a drag begins
  pointerId: number;
  startX: number; startY: number;   // pointerdown point (for the 5px cancel test)
  lastX: number; lastY: number;     // most recent pointer point (for delayed activate)
  grabX: number; grabY: number;     // pointer offset inside the card at grab time
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
/** What's rendered while a card is lifted. */
interface Drag { id: string; px: number; py: number; col: number; row: number; }

function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);   // synchronous, before the first paint — no flash
    if (typeof ResizeObserver === 'undefined') return;
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
  highlightId,
  onRemove,
  onEdit,
  onRequestEdit,
  onLayoutChange,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = DEFAULT_GAP,
  renderWidget,
}: HudGridProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(areaRef);
  const bp = activeBreakpoint(width);
  const cols = bp.cols;
  const colW = Math.max(1, (width - (cols - 1) * gap) / cols);
  const stepX = colW + gap;
  const stepY = rowHeight + gap;

  const press = useRef<Press | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };

  const baseItems = layoutForBreakpoint(state, bp);
  // While dragging, the held card occupies its hovered cell and the engine
  // repacks the rest — this is the live preview the placeholder follows.
  const items = drag
    ? compactVertical(baseItems.map((it) => (it.i === drag.id ? { ...it, x: drag.col, y: drag.row } : it)), cols)
    : baseItems;

  const rectOf = (it: GridItem) => ({
    left: it.x * stepX,
    top: it.y * stepY,
    width: it.w * colW + (it.w - 1) * gap,
    height: it.h * rowHeight + (it.h - 1) * gap,
  });

  /** Pointer → the cell the card's top-left should snap to, plus its float px. */
  function locate(clientX: number, clientY: number, w: number, grabX: number, grabY: number) {
    const r = areaRef.current?.getBoundingClientRect();
    const px = (r ? clientX - r.left : clientX) - grabX;
    const py = (r ? clientY - r.top : clientY) - grabY;
    const col = Math.max(0, Math.min(cols - w, Math.round(px / stepX)));
    const row = Math.max(0, Math.round(py / stepY));
    return { px, py, col, row };
  }

  function activate() {
    const p = press.current;
    if (!p || p.active) return;
    p.active = true;
    // Capture only now — before this, native scroll/tap-cancel must stay possible.
    try { p.el.setPointerCapture(p.pointerId); } catch { /* pointer already released */ }
    if (!editMode) onRequestEdit?.();
    const it = baseItems.find((i) => i.i === p.id);
    if (!it) return;
    setDrag({ id: p.id, ...locate(p.lastX, p.lastY, it.w, p.grabX, p.grabY) });
  }

  function onPointerDown(e: ReactPointerEvent, item: GridItem) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;   // never drag from the × control
    // Clear a stale swallow: if the previous drag ended without a follow-up click
    // (pointer released over another element under capture), justDragged would
    // otherwise eat the FIRST click of this fresh gesture.
    justDragged.current = false;
    const r = areaRef.current?.getBoundingClientRect();
    const slot = rectOf(item);
    press.current = {
      id: item.i,
      el: e.currentTarget as HTMLElement,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      grabX: r ? e.clientX - r.left - slot.left : 0,
      grabY: r ? e.clientY - r.top - slot.top : 0,
      active: false, timer: null,
    };
    if (editMode) activate();
    else press.current.timer = setTimeout(activate, HOLD_MS);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const p = press.current;
    if (!p) return;
    p.lastX = e.clientX; p.lastY = e.clientY;
    if (!p.active) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > MOVE_CANCEL_PX) {
        if (editMode) activate();                                   // already editing → pick up on move
        else { if (p.timer) clearTimeout(p.timer); press.current = null; }   // else it's a scroll/tap
      }
      return;
    }
    e.preventDefault();
    const it = baseItems.find((i) => i.i === p.id);
    if (it) setDrag({ id: p.id, ...locate(e.clientX, e.clientY, it.w, p.grabX, p.grabY) });
  }

  function onPointerUp() {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    const d = dragRef.current;
    if (p?.active && d && onLayoutChange) {
      justDragged.current = true;
      const committed = compactVertical(
        baseItems.map((it) => (it.i === d.id ? { ...it, x: d.col, y: d.row } : it)),
        cols,
      );
      onLayoutChange(bp.name, committed);
    }
    press.current = null;
    setDrag(null);
  }

  const areaHeight = Math.max(bottom(items) * stepY - gap, stepY);
  const placeholder = drag ? items.find((i) => i.i === drag.id) : null;

  // Only dim siblings if the highlighted cell is actually on this layout.
  const dimming = !!highlightId && items.some((it) => it.i === highlightId);

  return (
    <div className={`hud-canvas${editMode ? ' editing' : ''}${dimming ? ' has-highlight' : ''}`} data-bp={bp.name}>
      <div ref={areaRef} className="hud-grid-area" style={{ height: areaHeight }}>
        {placeholder && (() => {
          const r = rectOf(placeholder);
          return <div className="hud-placeholder" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />;
        })()}

        {items.map((item) => {
          const def = state.widgets[item.i];
          if (!def) return null;
          const r = rectOf(item);
          const lifted = drag?.id === item.i;
          const isHighlight = dimming && item.i === highlightId;
          return (
            <div
              key={item.i}
              data-id={item.i}
              className={`hud-cell${lifted ? ' dragging' : ''}${isHighlight ? ' is-highlight' : ''}`}
              onPointerDown={(e) => onPointerDown(e, item)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClickCapture={(e) => {
                if (justDragged.current) { e.preventDefault(); e.stopPropagation(); justDragged.current = false; }
              }}
              style={{
                position: 'absolute',
                left: lifted && drag ? drag.px : r.left,
                top: lifted && drag ? drag.py : r.top,
                width: r.width,
                height: r.height,
                zIndex: lifted ? 50 : undefined,
                transition: lifted ? 'none' : 'left 0.16s ease, top 0.16s ease',
                touchAction: editMode ? 'none' : undefined,
              }}
            >
              {editMode && onEdit && def.spec && (
                <button
                  className="hud-edit-remove hud-cell-edit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onEdit(item.i)}
                  title={`Edit ${def.label} in the workshop`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
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
    </div>
  );
}
