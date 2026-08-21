import { useCallback, useRef, useState } from 'react';
import { usePointerDrag } from '@jkos/ui';
import Cover from '../components/Cover';
import { IconChevronDown, IconGrip, IconTrash } from '../components/icons';
import { closeOverlay } from '../hooks/useHashRoute';
import { usePlayer } from '../player/PlayerProvider';
import { formatDuration, formatSpan } from './library/format';

/** Row height used to convert a drag's vertical travel into an index offset.
 *  Read from the live DOM on pick-up rather than hard-coded — the row is taller
 *  on a phone (tap floor) than on a desktop, and a wrong constant here makes the
 *  drop land one row off in exactly one of the two. */
const FALLBACK_ROW_H = 56;

/**
 * The queue / up-next editor.
 *
 * The brief asks for "drag to reorder, with a real grab handle". Both halves
 * matter and the second is the harder one:
 *
 *   A whole-row drag is the easy implementation and the wrong one on a phone. The
 *   queue is a vertical list inside a vertical scroll; if the row itself is
 *   draggable, every attempt to scroll picks a track up instead. Apps that ship
 *   this usually paper over it with a long-press delay, which just makes
 *   scrolling feel broken AND reordering feel slow.
 *
 *   So the drag is bound to a HANDLE only. Touching anywhere else on the row
 *   scrolls or plays, exactly as it would in a normal list, and the handle
 *   activates immediately with no hold delay — there is no ambiguity to resolve,
 *   so there is nothing to wait for.
 *
 * The list renders from the queue's CANONICAL order (`items`), not its shuffle
 * permutation: reordering a shuffled queue has to edit the underlying order, or
 * the user's drag would be silently discarded the next time the permutation
 * resynced.
 */
export default function Queue() {
  const p = usePlayer();
  const { begin } = usePointerDrag();
  const listRef = useRef<HTMLOListElement | null>(null);

  // The live drag: which index was picked up, and where it currently sits.
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const rowHRef = useRef(FALLBACK_ROW_H);

  const items = p.queue.items;
  const cursor = p.queue.cursor;

  const startDrag = useCallback((e: React.PointerEvent, index: number) => {
    // Measure a real row now — see FALLBACK_ROW_H.
    const row = (e.currentTarget as HTMLElement).closest('li');
    if (row) rowHRef.current = row.getBoundingClientRect().height || FALLBACK_ROW_H;

    begin(e, {
      // No hold delay: the handle is unambiguous, so waiting only adds latency.
      activation: { kind: 'immediate' },
      onActivate: () => setDrag({ from: index, to: index, dy: 0 }),
      onMove: (ctx) => {
        const offset = Math.round(ctx.dy / rowHRef.current);
        const to = Math.max(0, Math.min(items.length - 1, index + offset));
        setDrag({ from: index, to, dy: ctx.dy });
      },
      onEnd: (_ctx, dragged) => {
        setDrag((cur) => {
          if (dragged && cur && cur.to !== cur.from) p.reorderQueue(cur.from, cur.to);
          return null;
        });
      },
    });
  }, [begin, items.length, p.reorderQueue]);

  /** Where row `i` should render while a drag is live — the other rows slide out
   *  of the way so the gap under the finger is the actual drop target. */
  function shiftFor(i: number): number {
    if (!drag) return 0;
    const { from, to } = drag;
    if (i === from) return drag.dy;
    if (from < to && i > from && i <= to) return -rowHRef.current;
    if (from > to && i < from && i >= to) return rowHRef.current;
    return 0;
  }

  const upcoming = items.length - cursor - 1;
  const remaining = items
    .slice(cursor)
    .reduce((sum, id) => sum + (p.tracksById.get(Number(id))?.duration ?? 0), 0);

  return (
    <section className="kr-queue">
      <header className="kr-queue-head kr-glass kr-gloss">
        <button type="button" className="kr-ghost" onClick={closeOverlay} aria-label="Close queue">
          <IconChevronDown />
        </button>
        <div className="kr-queue-headings">
          <h1 className="kr-queue-title">Queue</h1>
          <p className="kr-mono">
            {upcoming > 0 ? `${upcoming} up next · ${formatSpan(remaining)} left` : 'Nothing up next'}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="kr-mono kr-queue-empty">The queue is empty. Play something from the library.</p>
      ) : (
        <ol className="kr-tracks kr-queue-list" ref={listRef}>
          {items.map((rawId, i) => {
            const id = Number(rawId);
            const t = p.tracksById.get(id);
            const isCurrent = i === cursor;
            const isDragging = drag?.from === i;
            const shift = shiftFor(i);

            return (
              <li
                key={`${rawId}-${i}`}
                className={`kr-track-host kr-queue-row${isCurrent ? ' is-current' : ''}${isDragging ? ' is-dragging' : ''}${i < cursor ? ' is-past' : ''}`}
                style={shift ? { transform: `translateY(${shift}px)` } : undefined}
              >
                <button
                  type="button"
                  className="kr-queue-grip"
                  aria-label={`Reorder ${t?.title ?? 'track'}`}
                  onPointerDown={(e) => startDrag(e, i)}
                >
                  <IconGrip />
                </button>

                <button
                  type="button"
                  className={`kr-track${isCurrent ? ' is-playing' : ''}`}
                  onClick={() => p.playQueueItem(i)}
                >
                  <span className="kr-track-art">
                    <Cover id={id} has={!!t?.cover_path} alt="" name={t?.album || t?.title} />
                  </span>
                  <span className="kr-track-body">
                    <span className="kr-track-title">{t?.title ?? `Track ${id}`}</span>
                    <span className="kr-track-sub">{t?.artist || t?.albumartist || '—'}</span>
                  </span>
                  <span className="kr-track-time">{formatDuration(t?.duration ?? 0)}</span>
                </button>

                <button
                  type="button"
                  className="kr-ghost kr-queue-remove"
                  aria-label={`Remove ${t?.title ?? 'track'} from queue`}
                  onClick={() => p.removeQueueItem(i)}
                >
                  <IconTrash />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
