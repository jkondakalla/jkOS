/**
 * sections.ts — pure derivers over CalendarItem[] that turn a flat item list into
 * the Day-agenda "briefing" model (Next / After-that / Carried / Adrift / Done).
 *
 * This encodes BeigeBoard's TodayView slicing EXACTLY, but as a domain-free pure
 * function: the goal-tree pieces (Adrift) come in through injected PlanResolvers,
 * so an app with no goal model still gets next/rest/carried/done. This is the
 * infra that lets `<Calendar view='day' dayMode='agenda' />` reproduce Today.
 */

import type { CalendarItem, DaySections, PlanResolvers } from './types';
import { mergePlanResolvers } from './theme';

/** Sort by scheduled time, untimed last — the Today ordering ('zz' sentinel). */
const byTime = (a: CalendarItem, b: CalendarItem) =>
  (a.scheduled_time || 'zz').localeCompare(b.scheduled_time || 'zz');

/**
 * Slice `items` into the day briefing for `today`. Mirrors TodayView:
 *  • active today (incomplete, time-sorted) → `next` (first) + `rest`
 *  • completed today → `done`
 *  • incomplete tasks whose day slipped past today → `carried`
 *  • active goals with nothing on the calendar → `adrift` (needs PlanResolvers)
 */
export function deriveDaySections(
  items: CalendarItem[],
  today: string,
  plan?: Partial<PlanResolvers>,
): DaySections {
  const { activeGoals, isAdrift } = mergePlanResolvers(plan);

  const allTasks = items.filter((it) => it.kind === 'task');
  const todayAll = allTasks.filter((t) => t.due_date === today);
  const active = todayAll.filter((t) => !t.completed).sort(byTime);
  const done = todayAll.filter((t) => t.completed);
  const carried = allTasks.filter((t) => t.due_date && t.due_date < today && !t.completed);
  const adrift = activeGoals(items).filter((g) => isAdrift(g, items));

  return {
    next: active[0] ?? null,
    rest: active.slice(1),
    carried,
    adrift,
    done,
    isEmpty: todayAll.length === 0 && carried.length === 0,
  };
}
