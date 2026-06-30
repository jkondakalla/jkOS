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
import { useWeaveList, weaveClient, resourceKey, invalidate, type ListFilters } from '@jkos/weave';
import type { CalendarItem, CalendarSource } from './types';

export function useCalendarSource(
  app: string,
  dataset = 'items',
  filters?: ListFilters,
): CalendarSource {
  // The resource key the `items` capabilities invalidate — derived, not typed by
  // hand, so a peer write refreshes this read through the shared bus.
  const key = resourceKey(app, dataset);
  const items = useWeaveList<CalendarItem>(app, dataset, filters, {
    invalidateOn: [key],
    refetchOnVisible: true,
  });

  const onAddItem = useCallback(
    (partial: Partial<CalendarItem>) => { void weaveClient(app).command('createItem', partial as Record<string, unknown>); },
    [app],
  );
  const onUpdateItem = useCallback(
    (id: number, patch: Partial<CalendarItem>) => { void weaveClient(app).command('updateItem', { id, ...patch }); },
    [app],
  );
  const onToggle = useCallback(
    (id: number, completed: boolean) => { void weaveClient(app).command('completeItem', { id, completed: !completed }); },
    [app],
  );
  const onDelete = useCallback(
    (id: number) => { void weaveClient(app).command('deleteItem', { id }); },
    [app],
  );
  const refresh = useCallback(() => invalidate(key), [key]);

  return { items, onAddItem, onUpdateItem, onToggle, onDelete, refresh };
}
