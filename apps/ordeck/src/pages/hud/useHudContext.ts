/**
 * pages/hud/useHudContext.ts — assemble the widget render context, once.
 *
 * Every widget reads from a `WidgetCtx` (the always-in-scope hud slices). It used
 * to be built by hand in both RoomHUD and the Workshop, which drifted whenever a
 * slice was added. Both now call this. Adding a slice is a one-place change here
 * (+ the WidgetCtx interface) — and because all BeigeBoard-backed slices select
 * from the single useBbItems source, the dashboard makes one request for them.
 */

import { useMemo } from 'react';
import { AUTH_URL } from '@jkos/auth-client';
import { useSuiteApps } from '@jkos/weave';
import { type WidgetCtx } from '../../hud/registry';
import {
  useClock, useWeather, useSystems, useStudy, useBbItems, useShelfRefs,
  selectToday, selectMonth, selectCalendarItems, selectFocus, selectPinned, deriveNotifications,
} from './useHudData';

/** `aiEnabled` (the LazurOS kill switch) gates the systems panel's LazurOS row. */
export function useHudContext(aiEnabled = true): WidgetCtx {
  const suite = useSuiteApps();          // hydrate the manifest from jkAuth's registry
  const clock = useClock();              // ticks every second → this hook re-runs every second
  const weather = useWeather();
  const systems = useSystems(aiEnabled, suite);
  const study = useStudy();

  const bb = useBbItems();
  const refs = useShelfRefs();          // pins + focus from the suite-wide HUD shelf
  // Every slice is memoised on the data it actually depends on, so its object
  // reference is STABLE between real changes — that's what lets each card's memo
  // boundary (registry WidgetCard) re-render only when its own data moves:
  //   • today/notifications → recompute per MINUTE (their "now"/overdue flags are
  //     minute-granular) — clock.hm, not the per-second tick, is the dep.
  //   • cal/focus/pinned → recompute only when their source data changes.
  const today = useMemo(() => selectToday(bb, clock.hm), [bb, clock.hm]);
  const cal = useMemo(() => selectMonth(bb), [bb]);
  // Full item list (CalendarItem[]) for the @jkos/cards Week/Calendar widgets —
  // memoised on bb so its reference is stable until the items actually change.
  const items = useMemo(() => selectCalendarItems(bb), [bb]);
  const focus = useMemo(() => selectFocus(refs.focus, bb), [refs.focus, bb]);
  const pinned = useMemo(() => selectPinned(refs.pins, bb), [refs.pins, bb]);

  const notifications = useMemo(
    () => deriveNotifications({ today, systems, study, now: clock.hm }),
    [today, systems, study, clock.hm],
  );

  // todayIso is a plain string (changes only at midnight), so the card memo gate
  // compares it by value — the calendar widgets needn't depend on the per-second clock.
  return { clock, weather, systems, today, study, cal, items, todayIso: clock.iso, notifications, focus, pinned, authUrl: AUTH_URL };
}
