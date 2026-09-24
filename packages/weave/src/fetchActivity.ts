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
import { pageLimit } from './shared/paging.js';

export type { ActivityDoc, ActivityEvent, ActivityKind, MergedActivityEvent } from './shared/activity.js';
export { ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT } from './shared/activity.js';
export { PAGE_DEFAULT, PAGE_MAX, CURSOR_PARAM, pageLimit } from './shared/paging.js';

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

/** Why one app contributed nothing. A partial result must be VISIBLY partial. */
export type ActivitySourceStatus =
  | 'ok'
  | 'undeclared'   // this app keeps no activity record
  | 'unreachable'  // network failure, or a non-2xx answer
  | 'unauthorized' // 401/403 — a different thing from being down
  | 'malformed';   // answered, but not to the contract (a version we can't read, or a bad row)

export interface ActivitySource {
  app: AppId;
  status: ActivitySourceStatus;
  /** How many events this app contributed, before the merged limit. */
  count: number;
}

/** One app's ActivityDoc plus WHY, when there isn't one. Uncached — see the header. */
export async function fetchAppActivity(
  appId: AppId,
  window: ActivityWindow = {},
): Promise<{ doc: ActivityDoc | null; status: ActivitySourceStatus }> {
  const path = suiteApp(appId)?.activityPath;
  if (!path) return { doc: null, status: 'undeclared' };
  try {
    const r = await fetch(`${path}${query(window)}`, { credentials: 'include' });
    if (r.status === 401 || r.status === 403) return { doc: null, status: 'unauthorized' };
    if (!r.ok) return { doc: null, status: 'unreachable' };
    const doc = (await r.json()) as ActivityDoc;
    /* Hold the PEER's doc to the same rule its producer is held to at serve time
       (server/activity.js validates before responding). Without this a peer with one
       malformed row would poison a merged sort — the merge is a string compare on
       `at`, so a non-canonical stamp does not throw, it silently lands in the wrong
       place in the feed, which is far worse than an app that goes quiet.
       ⚠️ This is also where the fail-closed VERSION rule lands (WEAVE.md §3.3): a doc
       whose `version` is newer than this consumer understands is refused outright
       rather than half-read, and reports as `malformed` so the caller can say so. */
    return isValidActivityDoc(doc) ? { doc, status: 'ok' } : { doc: null, status: 'malformed' };
  } catch {
    return { doc: null, status: 'unreachable' };
  }
}

/** A fan-out's answer: the merged data AND who actually answered. */
export interface ActivityFeed {
  events: MergedActivityEvent[];
  /** ⭐ EVERY app asked, with its outcome — never only the ones that worked. */
  sources: ActivitySource[];
  /** True when any app failed to contribute. A caller that ignores `sources` still
   *  cannot mistake a short feed for a complete one by accident. */
  partial: boolean;
}

/**
 * The merged cross-app feed, newest first. Asks every app that declares an activity
 * surface, in parallel, and merges.
 *
 * ⭐ RETURNS AN EXPLICIT PER-APP STATUS LIST (WEAVE.md §3.4). A partial result must be
 * VISIBLY partial, never silently short.
 *
 * ⚠️ This is a ruling the first version of this function broke. It returned a bare
 * array and mapped every failure — a dead peer, a 403, a doc it could not read — to
 * "contributed nothing", which is indistinguishable from "did nothing". "What did I
 * do today" would quietly answer for four apps out of five and look complete. Failing
 * soft is right; failing soft INVISIBLY is not.
 *
 * @param window `since`/`until`/`limit`. `limit` bounds BOTH each app's answer and
 *   the merged result — asking five apps for 100 each to render 100 is the correct
 *   shape, because which app the newest 100 come from is not knowable in advance.
 * @param apps restrict to specific app ids; defaults to every declaring app.
 */
export async function fetchActivity(
  window: ActivityWindow = {},
  apps?: AppId[],
): Promise<ActivityFeed> {
  const limit = pageLimit(window.limit, { fallback: ACTIVITY_DEFAULT_LIMIT, max: ACTIVITY_MAX_LIMIT });
  const ids = apps ?? Object.values(suiteApps())
    .filter((a) => a.activityPath)
    .map((a) => a.id as AppId);
  const answers = await Promise.all(ids.map(async (id) => ({
    app: id,
    ...(await fetchAppActivity(id, { ...window, limit })),
  })));
  const sources: ActivitySource[] = answers.map((a) => ({
    app: a.app,
    status: a.status,
    count: a.doc?.activity.length ?? 0,
  }));
  return {
    events: mergeActivity(answers.map((a) => a.doc), { limit }),
    sources,
    partial: sources.some((s) => s.status !== 'ok' && s.status !== 'undeclared'),
  };
}

/** Which apps declare an activity surface at all — so a UI can say "3 of 5 apps
 *  keep a record" rather than silently showing a short list. */
export function activityApps(): AppId[] {
  return Object.values(suiteApps())
    .filter((a) => a.activityPath)
    .map((a) => a.id as AppId);
}
