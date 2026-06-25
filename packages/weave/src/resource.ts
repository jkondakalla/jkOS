/**
 * weave/resource.ts — the one polled-resource primitive + a keyed invalidation bus.
 *
 * Every suite data hook used to hand-roll the same skeleton: fetch, poll on an
 * interval, a `dead` guard against stale setState, a soft `.catch`, and (for the
 * live ones) a bespoke `window` event to refetch after a write. That skeleton
 * lived in seven places with subtle drift. It lives here once now, shared across
 * the suite — any app can poll an app's API and any writer can invalidate it.
 *
 * The invalidation bus replaces per-feature `*_CHANGED` window events with dotted
 * keys ('<app>.<resource>', e.g. 'beigeboard.items', 'weather.config'): a writer calls
 * invalidate('beigeboard.items') and only the resources subscribed to that key refetch
 * — so a SylibOS write can't needlessly reload every BeigeBoard hook.
 */

import { useEffect, useRef, useState } from 'react';

/* ── Keyed invalidation bus ─────────────────────────────────────────────────*/

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Tell every resource subscribed to these keys to refetch now. */
export function invalidate(...keys: string[]): void {
  for (const k of keys) listeners.get(k)?.forEach((fn) => fn());
}

/** Subscribe `fn` to fire whenever any of `keys` is invalidate()'d. Returns an
 *  unsubscribe. usePolledResource wires this for you; it's exported so other
 *  multi-resource consumers (e.g. the widget engine's data sources) can join the
 *  same bus instead of inventing their own refresh signal. */
export function subscribe(keys: string[], fn: Listener): () => void {
  for (const k of keys) {
    let set = listeners.get(k);
    if (!set) listeners.set(k, (set = new Set()));
    set.add(fn);
  }
  return () => { for (const k of keys) listeners.get(k)?.delete(fn); };
}

/* ── usePolledResource ──────────────────────────────────────────────────────*/

export interface PolledOptions {
  /** Refetch every N ms. Omit for fetch-once. */
  intervalMs?: number;
  /** Invalidation keys whose `invalidate()` triggers an immediate refetch. */
  invalidateOn?: string[];
  /** Also refetch when the tab becomes visible again. */
  refetchOnVisible?: boolean;
  /** Refetch immediately whenever this value changes. The `fetcher` is read through
   *  a ref (so an inline closure doesn't restart the poll), which means a fetcher
   *  that closes over changing inputs — e.g. a serialized filter key — won't refetch
   *  on its own; pass that key here to force an immediate refetch on change. */
  reloadKey?: string | number;
}

/**
 * Fetch → poll → soft-fail → teardown, once. `fetcher` OWNS its error mapping:
 * it should resolve to a fully-formed `T` (e.g. an `offline: true` shape) rather
 * than reject, so each resource models its own failure where the shape is known.
 * The hook's own catch is a backstop that simply keeps the last good value.
 *
 * Returns the latest resolved value, seeded with `initial`. The `fetcher` is
 * read through a ref, so an inline closure doesn't restart the poll every render
 * — only the option values do.
 */
export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  initial: T,
  opts: PolledOptions = {},
): T {
  const { intervalMs, invalidateOn, refetchOnVisible, reloadKey } = opts;
  const [value, setValue] = useState<T>(initial);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const keyDep = invalidateOn ? invalidateOn.join('|') : '';

  useEffect(() => {
    let dead = false;
    const load = () => {
      fetcherRef.current()
        .then((v) => { if (!dead) setValue(v); })
        .catch(() => { /* keep last value — the fetcher models offline in T */ });
    };
    load();

    const timer = intervalMs ? setInterval(load, intervalMs) : null;
    const unsub = invalidateOn?.length ? subscribe(invalidateOn, load) : null;
    const onVisible = refetchOnVisible
      ? () => { if (document.visibilityState === 'visible') load(); }
      : null;
    if (onVisible) document.addEventListener('visibilitychange', onVisible);

    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      unsub?.();
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    };
    // keyDep captures invalidateOn by value; fetcher is via ref; reloadKey forces
    // an immediate refetch when a fetcher's captured inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refetchOnVisible, keyDep, reloadKey]);

  return value;
}
