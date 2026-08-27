/**
 * weave/fetchActivity.ts — "what did I do", asked of the whole suite (XC-2 / D6).
 *
 * The third of the discovery fetchers, alongside fetchCapabilities (what an app can
 * be TOLD to do) and fetchDatasets (what it can be READ for). This one asks what an
 * app remembers the user having DONE.
 *
 * ⚠️ It differs from its two siblings in one way that matters: their docs are static
 * declarations and are CACHED per app for the life of the page. An activity doc is
 * DATA — it changes every time the user does anything — so nothing here is cached.
 * A cache would make "what did I do today" answer with what you did before lunch.
 *
 * ⭐ FAN OUT AND MERGE, don't aggregate. Each app stays authoritative about itself
 * and answers only about itself; this asks all of them in parallel and merges the
 * answers by time. There is no central activity store and there must not be one —
 * see shared/activity.js for why. A dead or undeclared app contributes nothing and
 * never fails the whole feed, the same fail-soft bargain every other suite fetcher
 * makes: a merged history missing one app is useful, an error page is not.
 */

import { suiteApp, suiteApps, type AppId } from './manifest';
import {
  isValidActivityDoc, mergeActivity, ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT,
  type ActivityDoc, type MergedActivityEvent,
} from './shared/activity.js';

export type { ActivityDoc, ActivityEvent, ActivityKind, MergedActivityEvent } from './shared/activity.js';
export { ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT } from './shared/activity.js';

export interface ActivityWindow {
  /** canonical millisecond ISO — events strictly AFTER this */
  since?: string | null;
  /** canonical millisecond ISO — events strictly BEFORE this */
  until?: string | null;
  /** per-app cap AND the cap on the merged result */
  limit?: number;
}

function query({ since, until, limit }: ActivityWindow): string {
  const q = new URLSearchParams();
  if (since) q.set('since', since);
  if (until) q.set('until', until);
  if (limit) q.set('limit', String(limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** One app's ActivityDoc, or null when it declares none / is unreachable / answers
 *  something malformed. Uncached — see the file header. */
export async function fetchAppActivity(
  appId: AppId,
  window: ActivityWindow = {},
): Promise<ActivityDoc | null> {
  const path = suiteApp(appId)?.activityPath;
  if (!path) return null;
  try {
    const r = await fetch(`${path}${query(window)}`, { credentials: 'include' });
    if (!r.ok) return null;
    const doc = (await r.json()) as ActivityDoc;
    /* Hold the PEER's doc to the same rule its producer is held to at serve time
       (server/activity.js validates before responding). Without this a peer with one
       malformed row would poison a merged sort — the merge is a string compare on
       `at`, so a non-canonical stamp does not throw, it silently lands in the wrong
       place in the feed, which is far worse than an app that goes quiet. */
    return isValidActivityDoc(doc) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * The merged cross-app feed, newest first. Asks every app that declares an activity
 * surface, in parallel, and merges.
 *
 * @param window `since`/`until`/`limit`. `limit` bounds BOTH each app's answer and
 *   the merged result — asking five apps for 100 each to render 100 is the correct
 *   shape, because which app the newest 100 come from is not knowable in advance.
 * @param apps restrict to specific app ids; defaults to every declaring app.
 */
export async function fetchActivity(
  window: ActivityWindow = {},
  apps?: AppId[],
): Promise<MergedActivityEvent[]> {
  const limit = Math.min(window.limit || ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT);
  const ids = apps ?? Object.values(suiteApps())
    .filter((a) => a.activityPath)
    .map((a) => a.id as AppId);
  const docs = await Promise.all(ids.map((id) => fetchAppActivity(id, { ...window, limit })));
  return mergeActivity(docs, { limit });
}

/** Which apps declare an activity surface at all — so a UI can say "3 of 5 apps
 *  keep a record" rather than silently showing a short list. */
export function activityApps(): AppId[] {
  return Object.values(suiteApps())
    .filter((a) => a.activityPath)
    .map((a) => a.id as AppId);
}
