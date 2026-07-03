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
  useRef, useState, useEffect, useLayoutEffect, forwardRef, useImperativeHandle,
  type ReactNode, type RefObject, type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePointerDrag, HOLD_MS, HOLD_CANCEL_PX } from '@jkos/ui';
import { activeBreakpoint, layoutForBreakpoint, compactVertical, bottom } from './engine';
import type { Breakpoint, BreakpointName, GridItem, HudState, WidgetDef } from './types';
import './grid.css';

const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_GAP = 18;
// HOLD_MS (press-and-hold to pick up) and HOLD_CANCEL_PX (movement that re-reads
// the gesture as a scroll/tap) come from @jkos/ui — the suite's one gesture source.

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
  /** Fired when a drag commits: the tier, the full committed layout, and the id
   *  of the card the user actually moved (the rest merely repacked around it). */
  onLayoutChange?: (bp: BreakpointName, items: GridItem[], movedId?: string) => void;
  /** Fired when a tray-tile drop commits (see HudGridHandle): the tier, the full
   *  committed layout WITH the dropped card, and the dropped card's id. The
   *  owner adopts the layout and clears the card's shelf entry. */
  onExternalPlace?: (bp: BreakpointName, items: GridItem[], id: string) => void;
  /** Reports the tier the grid resolved from its OWN container width. Callers
   *  mutating layouts must use this, not window width — the canvas padding makes
   *  the two disagree just past the 768/1024 boundaries. */
  onBreakpoint?: (bp: Breakpoint) => void;
  /** Ids hand-placed this edit session — badged with a pin in edit mode so it's
   *  visible why auto-balance packs around them. */
  sessionPinned?: ReadonlySet<string>;
  rowHeight?: number;
  gap?: number;
  renderWidget: (def: WidgetDef, item: GridItem) => ReactNode;
}

/** What's rendered while a card is lifted. */
interface Drag { id: string; px: number; py: number; col: number; row: number; }

/** A tray tile hovering over the grid — an external drag. Same live-repack +
 *  placeholder mechanics as an internal drag; the tile itself (in the tray) is
 *  the drag visual, so the grid renders only the landing preview. */
interface ExtDrag { id: string; col: number; row: number; w: number; h: number; }

/** Imperative surface for the tray's tile drag. The gesture LIVES in the tray
 *  (its tile is what the finger holds); the grid only resolves pointer → cell,
 *  previews the landing, and commits the drop — so the geometry stays private
 *  to the one component that owns it. */
export interface HudGridHandle {
  /** Preview a tray drag at client coords (clears when the pointer leaves). */
  trayOver: (id: string, x: number, y: number) => void;
  /** Commit a tray drop. Returns false (and just clears the preview) when the
   *  pointer isn't over the grid — the card stays shelved. */
  trayDrop: (id: string, x: number, y: number) => boolean;
  /** Abandon the preview (gesture cancelled). */
  trayCancel: () => void;
}

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

export const HudGrid = forwardRef<HudGridHandle, HudGridProps>(function HudGrid({
  state,
  editMode = false,
  highlightId,
  onRemove,
  onEdit,
  onRequestEdit,
  onLayoutChange,
  onExternalPlace,
  onBreakpoint,
  sessionPinned,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = DEFAULT_GAP,
  renderWidget,
}: HudGridProps, ref) {
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(areaRef);
  const bp = activeBreakpoint(width);
  const cols = bp.cols;
  const colW = Math.max(1, (width - (cols - 1) * gap) / cols);
  const stepX = colW + gap;
  const stepY = rowHeight + gap;

  // Tell the owner which tier is actually on screen (bp is a stable BREAKPOINTS
  // element, so this fires on real tier changes, not every render).
  useEffect(() => { onBreakpoint?.(bp); }, [bp, onBreakpoint]);

  const { begin } = usePointerDrag();
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };

  const [ext, setExt] = useState<ExtDrag | null>(null);

  const baseItems = layoutForBreakpoint(state, bp);
  // While dragging, the held card occupies its hovered cell and the engine
  // repacks the rest — this is the live preview the placeholder follows. An
  // external (tray) drag previews the same way: its card joins the layout at
  // the hovered cell (defensively skipped if the id is somehow already placed).
  const items = drag
    ? compactVertical(baseItems.map((it) => (it.i === drag.id ? { ...it, x: drag.col, y: drag.row } : it)), cols)
    : ext && !baseItems.some((it) => it.i === ext.id)
      ? compactVertical([...baseItems, { i: ext.id, x: ext.col, y: ext.row, w: ext.w, h: ext.h }], cols)
      : baseItems;

  /** Tray-drag pointer → the cell its card would land in, sized from the def's
   *  per-tier default (clamped to this tier's columns). Null when the pointer
   *  isn't over the grid: horizontal bounds are strict, but anything at/below
   *  the top edge counts vertically — a drop under the last row appends. */
  function locateExt(id: string, cx: number, cy: number): ExtDrag | null {
    const r = areaRef.current?.getBoundingClientRect();
    const def = state.widgets[id];
    if (!r || !def) return null;
    if (cx < r.left || cx > r.right || cy < r.top - stepY / 2) return null;
    const size = def.sizing[bp.name] ?? def.sizing.desktop;
    const w = Math.min(size.w, cols);
    const col = Math.max(0, Math.min(cols - w, Math.round((cx - r.left - (w * stepX) / 2) / stepX)));
    const row = Math.max(0, Math.round((cy - r.top - stepY / 2) / stepY));
    return { id, col, row, w, h: size.h };
  }

  useImperativeHandle(ref, () => ({
    trayOver: (id, x, y) => setExt(locateExt(id, x, y)),
    trayDrop: (id, x, y) => {
      const d = locateExt(id, x, y);
      setExt(null);
      if (!d || !onExternalPlace || baseItems.some((it) => it.i === d.id)) return false;
      const committed = compactVertical(
        [...baseItems, { i: d.id, x: d.col, y: d.row, w: d.w, h: d.h }],
        cols,
      );
      onExternalPlace(bp.name, committed, d.id);
      return true;
    },
    trayCancel: () => setExt(null),
  }));

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

  /** Pointer-drag a card to rearrange it. Outside edit mode a press-and-HOLD
   *  picks it up (and enters edit mode); in edit mode it lifts immediately. The
   *  gesture mechanics — capture, the hold-cancel threshold, the post-drag click
   *  swallow — come from @jkos/ui's usePointerDrag, shared with the calendar. */
  function onCellPointerDown(e: ReactPointerEvent, item: GridItem) {
    if ((e.target as HTMLElement).closest('button')) return;   // never drag from the edit/× controls
    const r = areaRef.current?.getBoundingClientRect();
    const slot = rectOf(item);
    const grabX = r ? e.clientX - r.left - slot.left : 0;
    const grabY = r ? e.clientY - r.top - slot.top : 0;
    const track = (x: number, y: number) => {
      const it = baseItems.find((i) => i.i === item.i);
      if (it) setDrag({ id: item.i, ...locate(x, y, it.w, grabX, grabY) });
    };

    begin(e, {
      activation: editMode
        ? { kind: 'immediate' }
        : { kind: 'hold', delay: HOLD_MS, cancelDistance: HOLD_CANCEL_PX },
      onActivate: (c) => { if (!editMode) onRequestEdit?.(); track(c.x, c.y); },
      onMove: (c) => track(c.x, c.y),
      onEnd: (_c, activated) => {
        const d = dragRef.current;
        if (activated && d && onLayoutChange) {
          const committed = compactVertical(
            baseItems.map((it) => (it.i === d.id ? { ...it, x: d.col, y: d.row } : it)),
            cols,
          );
          onLayoutChange(bp.name, committed, d.id);
        }
        setDrag(null);
      },
      onCancel: () => setDrag(null),
    });
  }

  const areaHeight = Math.max(bottom(items) * stepY - gap, stepY);
  // Internal drag AND tray drag share the placeholder: it always marks where
  // the held card will land. The tray card's cell itself isn't rendered — the
  // floating tile (in the tray) is that drag's visual.
  const previewId = drag?.id ?? ext?.id;
  const placeholder = previewId ? items.find((i) => i.i === previewId) : null;

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
          if (ext && item.i === ext.id) return null;   // tray preview: placeholder only
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
              onPointerDown={(e) => onCellPointerDown(e, item)}
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
              {editMode && sessionPinned?.has(item.i) && (
                <span
                  className="hud-cell-pin"
                  title="Hand-placed this session — auto-balance packs around it"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                </span>
              )}
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
});
