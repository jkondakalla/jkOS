// QueuePanel.tsx — the up-next list over core/queue's Queue (git history, Wave 16,
// item 16.6). Renders `queue.items` in CANONICAL order (shuffle only changes how
// next/prev WALK the queue — see queue.ts's header — so the panel always shows
// insertion order, cursor row highlighted), with:
//   • tap a row        → onPlayItem
//   • row's × button   → onRemove
//   • drag the ≡ grip  → onReorder(from, to), `to` ready for core/queue's reorder()
// Reordering goes through @jkos/ui's usePointerDrag — the suite's ONE gesture
// primitive — with the house activation split: distance threshold for mouse/pen,
// press-and-hold for touch (the calendar's exact policy). Row rects are measured
// once on activate; ./scrub's insertionSlot/reorderTarget turn the live pointer y
// into the drop index (pure + unit-tested).
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  cx, usePointerDrag,
  DRAG_THRESHOLD_PX, HOLD_MS, HOLD_CANCEL_PX,
} from '@jkos/ui';
import type { Queue } from '../core/queue';
import { insertionSlot, reorderTarget, type RowSpan } from './scrub';
import { IconClose, IconGrip } from './icons';

export interface QueuePanelProps {
  queue: Queue;
  /** Row title for an item id. Default: the id itself. */
  labelOf?: (id: string, index: number) => ReactNode;
  onPlayItem?: (index: number, id: string) => void;
  onRemove?: (index: number, id: string) => void;
  /** Receives canonical indices, exactly what core/queue's reorder(from, to) wants. */
  onReorder?: (from: number, to: number) => void;
  emptyText?: string;
  removeLabel?: string;
  dragLabel?: string;
}

export function QueuePanel({
  queue,
  labelOf,
  onPlayItem,
  onRemove,
  onReorder,
  emptyText = 'Queue is empty.',
  removeLabel = 'Remove from queue',
  dragLabel = 'Reorder',
}: QueuePanelProps) {
  const { begin } = usePointerDrag();
  const listRef = useRef<HTMLOListElement | null>(null);
  // Row spans measured once per drag (on activate) — rows don't move mid-drag, so
  // remeasuring per pointermove would only buy layout thrash.
  const spansRef = useRef<RowSpan[]>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const measure = (): RowSpan[] => {
    const rows = listRef.current?.querySelectorAll('.pb-q-row') ?? [];
    return Array.from(rows, (el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
  };

  const beginRowDrag = (e: ReactPointerEvent, from: number) => {
    if (!onReorder) return;
    begin(e, {
      // The house split (calendar policy): touch must hold to lift, mouse/pen lift
      // on a few px of travel.
      activation: e.pointerType === 'touch'
        ? { kind: 'hold', delay: HOLD_MS, cancelDistance: HOLD_CANCEL_PX }
        : { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onActivate: (ctx) => {
        spansRef.current = measure();
        setDrag({ from, to: reorderTarget(from, insertionSlot(spansRef.current, ctx.y)) });
      },
      onMove: (ctx) => {
        setDrag({ from, to: reorderTarget(from, insertionSlot(spansRef.current, ctx.y)) });
      },
      onEnd: (ctx, activated) => {
        setDrag(null);
        if (!activated) return; // a plain tap on the grip is not a play/remove — ignore
        const to = reorderTarget(from, insertionSlot(spansRef.current, ctx.y));
        if (to !== from) onReorder(from, to);
      },
      onCancel: () => setDrag(null),
    });
  };

  if (queue.items.length === 0) {
    return <div className="pb-popover-empty">{emptyText}</div>;
  }

  return (
    <ol className="pb-queue" ref={listRef}>
      {queue.items.map((id, i) => (
        <li
          key={`${id}:${i}`}
          className={cx(
            'pb-q-row',
            i === queue.cursor && 'is-current',
            drag?.from === i && 'is-dragging',
            drag != null && drag.to === i && drag.from !== i && 'is-drop-target',
          )}
        >
          {onReorder && (
            <button
              type="button"
              className="pb-q-handle"
              title={dragLabel}
              aria-label={dragLabel}
              onPointerDown={(e) => beginRowDrag(e, i)}
            >
              <IconGrip />
            </button>
          )}
          <button
            type="button"
            className="pb-q-item"
            onClick={() => onPlayItem?.(i, id)}
            aria-current={i === queue.cursor ? 'true' : undefined}
          >
            <span className="pb-q-index">{i + 1}</span>
            <span className="pb-q-title">{labelOf ? labelOf(id, i) : id}</span>
          </button>
          {onRemove && (
            <button
              type="button"
              className="pb-q-remove"
              title={removeLabel}
              aria-label={removeLabel}
              onClick={() => onRemove(i, id)}
            >
              <IconClose />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
