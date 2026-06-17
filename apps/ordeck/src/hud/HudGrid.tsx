/**
 * hud/HudGrid.tsx — the custom responsive grid renderer.
 *
 * Measures its own width, resolves the active breakpoint, asks the engine for
 * the placed layout at that tier, and paints it as a CSS grid. Placement is the
 * only thing this component owns; drag / resize / shelf-drop arrive in later
 * phases and will mutate layouts through hud/state, never the DOM directly.
 */

import { useRef, useState, useEffect, type ReactNode, type RefObject } from 'react';
import { activeBreakpoint, layoutForBreakpoint, compactVertical } from './engine';
import type { BreakpointName, GridItem, HudState, WidgetDef } from './types';
import './grid.css';

const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_GAP = 18;

interface HudGridProps {
  state: HudState;
  /** When true, cells gain a remove affordance (→ shelf) and an edit outline. */
  editMode?: boolean;
  onRemove?: (id: string) => void;
  /** Persist a reordered layout for the active breakpoint (drag-to-rearrange). */
  onLayoutChange?: (bp: BreakpointName, items: GridItem[]) => void;
  rowHeight?: number;
  gap?: number;
  /** Renders a widget's body from its definition; the cell supplies the frame. */
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
  onLayoutChange,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = DEFAULT_GAP,
  renderWidget,
}: HudGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const width = useContainerWidth(ref);
  const bp = activeBreakpoint(width);
  const items = layoutForBreakpoint(state, bp);

  function handleDrop(targetId: string) {
    const draggedId = dragId.current;
    dragId.current = null;
    if (!draggedId || draggedId === targetId || !onLayoutChange) return;
    const target = items.find((i) => i.i === targetId);
    if (!target) return;
    // Drop A onto B → A takes B's slot (just above, via the −0.5 sort bias) and
    // the engine repacks the rest. Vertical compaction guarantees no overlap.
    const moved = items.map((it) =>
      it.i === draggedId ? { ...it, x: target.x, y: target.y - 0.5 } : it,
    );
    onLayoutChange(bp.name, compactVertical(moved, bp.cols));
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
        return (
          <div
            key={item.i}
            className="hud-cell"
            draggable={editMode}
            onDragStart={(e) => { dragId.current = item.i; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (editMode && dragId.current) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(item.i); }}
            style={{
              gridColumn: `${item.x + 1} / span ${item.w}`,
              gridRow: `${item.y + 1} / span ${item.h}`,
            }}
          >
            {editMode && onRemove && (
              <button
                className="hud-edit-remove hud-cell-remove"
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
