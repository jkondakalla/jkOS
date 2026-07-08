/**
 * useCalendarSource — the lego data-binding seam.
 *
 * Snaps any calendar view onto a weave peer's `items` collection: it reads the
 * list (live, invalidation-bus wired) and maps the four write capabilities onto
 * the exact callbacks the views consume, so a host gets create / reschedule /
 * toggle / delete by passing the result straight through:
 *
 *     const src = useCalendarSource('beigeboard')
 *     <Calendar view='week' {...src} drag={useCalendarDrag()} resolvers={r} />
 *
 * `onUpdateItem` is the unlock — it maps to the general `updateItem` capability,
 * which is what every drag drop commits, so reschedule works the moment the hook
 * is wired. Drag + resolvers stay SEPARATE props (host wraps in
 * CalendarDragProvider); this hook only carries the data.
 */

import { useCallback } from 'react';
import { useWeaveList, weaveClient, resourceKey, invalidate, type AppId, type ListFilters } from '@jkos/weave';
import type { CalendarItem, CalendarSource } from './types';

/** A calendar write op — the label passed to `onError` so a host can tell which
 *  command failed (e.g. to word a toast). */
export type CalendarOp = 'createItem' | 'updateItem' | 'completeItem' | 'deleteItem';

export interface UseCalendarSourceOpts {
  /** Called when a write command rejects. The hook has already invalidated the
   *  list (which rolls back optimistic state by refetching the truth); this is the
   *  surfacing seam — show a toast, etc. Defaults to `console.error`. */
  onError?: (err: unknown, op: CalendarOp) => void;
}

export function useCalendarSource(
  app: AppId,
  dataset = 'items',
  filters?: ListFilters,
  opts?: UseCalendarSourceOpts,
): CalendarSource {
  // useWeaveList derives its bus subscription (resourceKey(app, dataset)) itself;
  // this hook only re-derives the key for the manual refresh() escape hatch below.
  const key = resourceKey(app, dataset);
  const items = useWeaveList<CalendarItem>(app, dataset, filters, {
    refetchOnVisible: true,
  });

  const onError = opts?.onError;
  // Every write is fire-and-forget for optimistic snappiness, but a rejected
  // command must not vanish silently (a failed reschedule that surfaces nowhere).
  // On failure: invalidate the list so the view refetches the server truth (rolls
  // back the optimistic move), then hand the error to the host (or log it).
  const run = useCallback(
    (op: CalendarOp, payload: Record<string, unknown>) => {
      weaveClient(app).command(op, payload).catch((err: unknown) => {
        invalidate(key);
        if (onError) onError(err, op);
        else console.error(`[useCalendarSource] ${op} failed`, err);
      });
    },
    [app, key, onError],
  );

  const onAddItem = useCallback(
    (partial: Partial<CalendarItem>) => run('createItem', partial as Record<string, unknown>),
    [run],
  );
  const onUpdateItem = useCallback(
    (id: number, patch: Partial<CalendarItem>) => run('updateItem', { id, ...patch }),
    [run],
  );
  const onToggle = useCallback(
    (id: number, completed: boolean) => run('completeItem', { id, completed: !completed }),
    [run],
  );
  const onDelete = useCallback(
    (id: number) => run('deleteItem', { id }),
    [run],
  );
  const refresh = useCallback(() => invalidate(key), [key]);

  return { items, onAddItem, onUpdateItem, onToggle, onDelete, refresh };
}
