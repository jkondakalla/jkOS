/**
 * sources.ts — where a widget's named data comes from, and what state it is in.
 *
 * A spec declares its sources by KIND (never `from`, which collided with the binding
 * model's `{from}` sugar — two meanings of one word in one document):
 *
 *   { kind: 'dataset', app, dataset, params?, poll? }
 *       a dataset the app DECLARES. Found through its DatasetDoc (weave readDataset), so
 *       the path, the path parameters, the filters and the answer's shape all come from
 *       the declaration; the dataset's `invalidates` keys are subscribed automatically,
 *       so a write anywhere in the suite refreshes it. `params` are bindings — a job id a
 *       form just got back, the item a list row names.
 *   { kind: 'fetch', url, poll? }
 *       an EXTERNAL public JSON endpoint, fetched with no credentials. A relative URL, or
 *       one on this origin or any suite app's, is REFUSED and never requested: a widget
 *       reads only what an app declares. (The old same-origin fetch was how LazurOS's
 *       jobs widget read an undeclared shape, with the user's cookie, at any path.)
 *
 * Every source reports a STATE beside its data (readDataset's, plus `loading` before the
 * first answer and `refused`), so the card can tell "nothing here" from "signed out" from
 * "the app is down" — a bare `[]` could not.
 *
 * How a source is READ is a React context, so the preview harness can answer each state
 * from fixtures while discovery and the shape checks stay the real ones.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { readDataset, resolveBinding, subscribe, suiteApps, type AppId, type DatasetRead, type ReadParams } from '@jkos/weave';
import type { Binding } from './types';

export type DataSource =
  | { kind: 'dataset'; app: AppId; dataset: string; params?: Record<string, Binding>; poll?: number; debounce?: number }
  | { kind: 'fetch'; url: string; poll?: number };

export type SourceState = DatasetRead['state'] | 'loading' | 'refused';

/** What one read of a source answered. */
export interface SourceRead {
  state: SourceState;
  data?: unknown;
  error?: string;
  /** Bus keys that should re-read it (a dataset's declared `invalidates`). */
  invalidates?: string[];
}

export interface SourceStatus { state: SourceState; error?: string }

export type SourceReader = (name: string, source: DataSource, params: ReadParams) => Promise<SourceRead>;

/** Resolve a dataset source's param bindings against the current scope. */
export function resolveParams(params: Record<string, Binding> | undefined, scope: Record<string, unknown>): ReadParams {
  const out: ReadParams = {};
  for (const [k, b] of Object.entries(params ?? {})) {
    const v = resolveBinding(b, scope);
    out[k] = v == null ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return out;
}

/** Every origin a widget must reach through a declaration instead: this page's, and each
 *  suite app's (the directory the page hydrated, or the manifest's fallback). */
export function suiteOrigins(): string[] {
  const out = new Set<string>();
  if (typeof window !== 'undefined') out.add(window.location.origin);
  for (const a of Object.values(suiteApps())) {
    try { if (a.origin) out.add(new URL(a.origin).origin); } catch { /* a malformed origin names nothing */ }
  }
  return [...out];
}

/** Why a URL may not be fetched directly, or null when it may: it must be absolute
 *  https, and its host neither one of `origins`' hosts nor a subdomain of one. */
export function refusedUrl(url: string, origins: string[]): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'a fetch source must be an absolute https URL — a relative one is this origin'; }
  if (u.protocol !== 'https:') return 'a fetch source must be https';
  for (const o of origins) {
    let h: string;
    try { h = new URL(o).hostname; } catch { continue; }
    const bare = h.replace(/^www\./, '');
    if (u.hostname === h || u.hostname === bare || u.hostname.endsWith(`.${bare}`)) {
      return `${u.hostname} is part of this suite — a widget reads only what an app declares: bind { kind: 'dataset' }`;
    }
  }
  return null;
}

/** An external public endpoint: no cookies, no Authorization, and a state like a dataset's.
 *  `get` replaces the request itself (a preview answering from fixtures) — the refusal
 *  is checked against the REAL url first either way. */
export async function readExternal(url: string, get: (url: string) => Promise<Response> = (u) => fetch(u, { credentials: 'omit' })): Promise<SourceRead> {
  const why = refusedUrl(url, suiteOrigins());
  if (why) return { state: 'refused', error: why };
  try {
    const r = await get(url);
    if (!r.ok) return { state: 'offline', error: `${new URL(url).hostname} answered ${r.status}` };
    const data = await r.json();
    const empty = data == null || (Array.isArray(data) && data.length === 0);
    return { state: empty ? 'empty' : 'ready', data };
  } catch {
    return { state: 'offline', error: `${url} did not answer` };
  }
}

/** The live reader: a dataset through its declaration, a fetch as an external read. */
export const liveReader: SourceReader = async (_name, source, params) => {
  if (source.kind === 'dataset') {
    const r = await readDataset(source.app, source.dataset, params);
    return { ...r, invalidates: r.def?.invalidates };
  }
  if (source.kind === 'fetch') return readExternal(source.url);
  return { state: 'unavailable', error: `unknown source kind ${JSON.stringify((source as { kind?: unknown }).kind)}` };
};

const ReaderCtx = createContext<SourceReader>(liveReader);
/** Wrap a widget to change how its sources are read (the preview answers from fixtures). */
export const SourceReaderProvider = ReaderCtx.Provider;

/**
 * How long a change of resolved params waits before it is read: the longest `debounce` of
 * the sources whose params actually changed between `prev` and `next` (each the JSON of
 * one entry per source, as useDataSources keys them) — 0 when none of those debounces, so
 * a source without one is never held up by its neighbour's.
 */
export function settleDelay(sources: DataSource[], prev: string, next: string): number {
  const a: unknown[] = JSON.parse(prev), b: unknown[] = JSON.parse(next);
  let wait = 0;
  sources.forEach((s, i) => {
    if (s.kind === 'dataset' && s.debounce && JSON.stringify(a[i]) !== JSON.stringify(b[i])) wait = Math.max(wait, s.debounce);
  });
  return wait;
}

/** `key`, held back while a debounced source's params are still changing (settleDelay). */
function useSettled(sources: DataSource[], key: string): string {
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    if (key === settled) return;
    const wait = settleDelay(sources, settled, key);
    if (!wait) { setSettled(key); return; }
    const t = setTimeout(() => setSettled(key), wait);
    return () => clearTimeout(t);
  }, [sources, key, settled]);
  return settled;
}

/**
 * Read a spec's sources, keep them fresh, and report each one's state. Re-reads when a
 * dataset's resolved params change (after its `debounce`, when it has one), on its `poll`,
 * when one of its declared bus keys is invalidated, and when the tab becomes visible. A
 * failed re-read keeps the last good data and reports the failure beside it — the card
 * decides whether stale data shows.
 */
export function useDataSources(
  sources: Record<string, DataSource> | undefined,
  scope: Record<string, unknown>,
): { data: Record<string, unknown>; status: Record<string, SourceStatus> } {
  const read = useContext(ReaderCtx);
  const entries = useMemo(() => Object.entries(sources ?? {}), [sources]);
  // The resolved params, as one string: the effect re-runs when a VALUE changes, not
  // every time the scope object does (the clock ticks it every second).
  const kinds = useMemo(() => entries.map(([, s]) => s), [entries]);
  const paramsKey = useSettled(kinds, JSON.stringify(entries.map(([, s]) => (s.kind === 'dataset' ? resolveParams(s.params, scope) : null))));
  const [data, setData] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<Record<string, SourceStatus>>(() =>
    Object.fromEntries(entries.map(([name]) => [name, { state: 'loading' as SourceState }])));

  useEffect(() => {
    if (!entries.length) return;
    let dead = false;
    const params: (ReadParams | null)[] = JSON.parse(paramsKey);
    const timers: ReturnType<typeof setInterval>[] = [];
    const unsubs: Array<() => void> = [];
    const loaders: Array<() => void> = [];
    entries.forEach(([name, s], i) => {
      let subscribed = false;
      const load = async () => {
        let r: SourceRead;
        try { r = await read(name, s, params[i] ?? {}); } catch (e) { r = { state: 'offline', error: String(e) }; }
        if (dead) return;
        setStatus((st) => ({ ...st, [name]: { state: r.state, ...(r.error ? { error: r.error } : {}) } }));
        if (r.state === 'ready' || r.state === 'empty') setData((d) => ({ ...d, [name]: r.data }));
        if (!subscribed && r.invalidates?.length) { subscribed = true; unsubs.push(subscribe(r.invalidates, load)); }
      };
      loaders.push(load);
      void load();
      if (s.poll && s.poll > 0) timers.push(setInterval(load, s.poll * 1000));
    });
    const onVisible = () => { if (document.visibilityState === 'visible') loaders.forEach((l) => l()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      timers.forEach(clearInterval);
      unsubs.forEach((u) => u());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [entries, paramsKey, read]);

  return { data, status };
}

/** The one state a card with sources is in. */
export type CardState =
  | { kind: 'ready'; stale?: { app: string } }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'signed-out' }
  | { kind: 'forbidden'; error?: string }
  | { kind: 'offline'; app: string }
  | { kind: 'unavailable'; error?: string };

/**
 * Fold each source's state into the card's — what the FRAME draws, so no widget author
 * has to (and none can forget): a signed-out viewer is asked to sign in, a down app is
 * named, a first read shows loading, and only when every source answered nothing is the
 * card empty. In that order, because it is the order a person needs them in:
 *
 *   signed-out   any source — nothing else can be read until they sign in
 *   forbidden    any source, with nothing to show
 *   unavailable  any source (undeclared, a lying answer, a refused URL)
 *   offline      a source with no data yet; one that had data stays READY, marked stale
 *   loading      a source with no answer yet
 *   empty        every source answered, and answered nothing
 *   ready        otherwise (an `idle` source — a parameter not known yet — is the body's
 *                business: it has asked for nothing)
 */
export function cardState(
  sources: Record<string, DataSource> | undefined,
  status: Record<string, SourceStatus>,
  data: Record<string, unknown>,
): CardState {
  const names = Object.keys(sources ?? {});
  if (!names.length) return { kind: 'ready' };
  const st = (n: string): SourceState => status[n]?.state ?? 'loading';
  const has = (n: string) => n in data;
  const appOf = (n: string) => { const s = sources![n]; return s.kind === 'dataset' ? s.app : new URL(s.url, 'https://x').hostname; };

  if (names.some((n) => st(n) === 'signed-out')) return { kind: 'signed-out' };
  const forbidden = names.find((n) => st(n) === 'forbidden' && !has(n));
  if (forbidden) return { kind: 'forbidden', error: status[forbidden]?.error };
  const broken = names.find((n) => st(n) === 'unavailable' || st(n) === 'refused');
  if (broken) return { kind: 'unavailable', error: status[broken]?.error };
  const down = names.find((n) => st(n) === 'offline' && !has(n));
  if (down) return { kind: 'offline', app: appOf(down) };
  if (names.some((n) => st(n) === 'loading' && !has(n))) return { kind: 'loading' };
  if (names.every((n) => st(n) === 'empty')) return { kind: 'empty' };
  const stale = names.find((n) => st(n) === 'offline');
  return stale ? { kind: 'ready', stale: { app: appOf(stale) } } : { kind: 'ready' };
}
