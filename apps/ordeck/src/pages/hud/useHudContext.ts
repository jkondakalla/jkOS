/**
 * pages/hud/useHudContext.ts — assemble the widget render context, once.
 *
 * Every widget reads from a `WidgetCtx` (the always-in-scope hud slices). It used
 * to be built by hand in both RoomHUD and the Workshop, which drifted whenever a
 * slice was added. Both now call this. Adding a slice is a one-place change here
 * (+ the WidgetCtx interface) — and because all BeigeBoard-backed slices select
 * from the single useBbItems source, the dashboard makes one request for them.
 */

import { AUTH_URL } from '@jkos/auth-client';
import { useSuiteApps } from '@jkos/weave';
import { type WidgetCtx } from '../../hud/registry';
import {
  useClock, useWeather, useSystems, useStudy, useBbItems, useShelfRefs,
  selectToday, selectMonth, selectFocus, selectPinned, deriveNotifications,
} from './useHudData';

/** `aiEnabled` (the LazurOS kill switch) gates the systems panel's LazurOS row. */
export function useHudContext(aiEnabled = true): WidgetCtx {
  const suite = useSuiteApps();          // hydrate the manifest from jkAuth's registry
  const clock = useClock();
  const weather = useWeather();
  const systems = useSystems(aiEnabled, suite);
  const study = useStudy();

  const bb = useBbItems();
  const refs = useShelfRefs();          // pins + focus from the suite-wide HUD shelf
  const today = selectToday(bb);
  const cal = selectMonth(bb);
  const focus = selectFocus(refs.focus, bb);
  const pinned = selectPinned(refs.pins, bb);

  const notifications = deriveNotifications({ today, systems, study });

  return { clock, weather, systems, today, study, cal, notifications, focus, pinned, authUrl: AUTH_URL };
}
