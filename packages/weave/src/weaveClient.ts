/**
 * weave/weaveClient.ts — the one-call peer SDK (frontend).
 *
 * The symmetric front door: ANY app (not just the portal) talks to ANY peer the
 * same way. `weaveClient('beigeboard')` bundles discovery + read + command over
 * the existing primitives (manifest, fetchCapabilities/fetchDatasets, runCommand,
 * usePolledResource), so a cross-app read is one line:
 *
 *     const tasks = useWeaveList('beigeboard', 'items', { kind: 'task' })
 *
 * and a cross-app write is one await:
 *
 *     await weaveClient('beigeboard').command('createItem', { title })
 *
 * All requests are edge-proxied + same-origin (cookies flow), so the owning app
 * stays the single source of truth and the trust boundary stays at the edge.
 */

import { useCallback } from 'react';
import { authFetch } from '@jkos/auth-client';
import { apiBase, suiteApp, resourceKey, type AppId } from './manifest';
import { usePolledResource, type PolledOptions } from './resource';
import { fetchCapabilities, getCapability } from './fetchCapabilities';
import { fetchDatasets, getDataset } from './fetchDatasets';
import { runCommand, type CommandResult } from './dispatch';

export type ListFilters = Record<string, string | number | boolean | undefined | null>;

/** Build a `?a=1&b=2` query string, dropping empty values. */
function toQuery(filters?: ListFilters): string {
  if (!filters) return '';
  const pairs = Object.entries(filters)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return pairs.length ? '?' + new URLSearchParams(pairs).toString() : '';
}

/** Imperative, discovery-driven peer client. Cheap to construct (no hooks). */
export function weaveClient(appId: AppId) {
  return {
    /** The peer's CapabilityDoc (cached). */
    capabilities: (force?: boolean) => fetchCapabilities(appId, force),
    /** The peer's DatasetDoc (cached). */
    datasets: (force?: boolean) => fetchDatasets(appId, force),

    /** One-shot read of a declared dataset. Resolves the dataset's path via
     *  discovery, then edge-proxied fetches it. Returns [] on any miss. */
    async list<T = unknown>(datasetId: string, filters?: ListFilters): Promise<T[]> {
      const ds = getDataset(await fetchDatasets(appId), datasetId);
      if (!ds) return [];
      try {
        // authFetch: a 15-min-expired access token is silently refreshed + retried
        // from the remember-me cookie, so a polled peer read never flips to "signed
        // out" while a valid 30-day session is live.
        const r = await authFetch(`${apiBase(appId)}${ds.path}${toQuery(filters)}`);
        if (!r.ok) return [];
        const data = await r.json();
        return Array.isArray(data) ? (data as T[]) : [];
      } catch {
        return [];
      }
    },

    /** Run a declared capability: discover it, then dispatch + invalidate. */
    async command(capId: string, body: Record<string, unknown> = {}): Promise<CommandResult> {
      const app = suiteApp(appId);
      if (!app) return { ok: false, status: 0, error: `weave: unknown app '${appId}'` };
      const cap = getCapability(await fetchCapabilities(appId), capId);
      if (!cap) return { ok: false, status: 0, error: `weave: unknown capability '${appId}.${capId}'` };
      return runCommand(app, cap, body);
    },
  };
}

/**
 * Reactive read of a peer dataset — the hook form of `weaveClient(app).list`.
 * Polls/​invalidates through the shared bus. The subscription key is DERIVED —
 * `resourceKey(app, dataset)`, the same `id.resource` convention every capability
 * declares in `invalidates` — so a write to the collection refreshes this read
 * with no caller-typed bus key (a typo'd literal used to silently never refresh).
 * Pass `invalidateOn` only to REPLACE the default (e.g. an aggregate view fed by
 * several keys). Returns [] until the first resolve.
 */
export function useWeaveList<T = unknown>(
  appId: AppId,
  datasetId: string,
  filters?: ListFilters,
  opts?: PolledOptions,
): T[] {
  const filterKey = filters ? JSON.stringify(filters) : '';
  // Reuse the imperative client's read path — one definition of discover→fetch→
  // coerce instead of a second copy that could drift from it.
  const fetcher = useCallback(
    () => weaveClient(appId).list<T>(datasetId, filters),
    // filters is captured by value through filterKey; appId/datasetId are primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appId, datasetId, filterKey],
  );
  // reloadKey forces an immediate refetch when app/dataset/filters change (the
  // fetcher is ref-read by usePolledResource, so it wouldn't refetch on its own).
  return usePolledResource<T[]>(fetcher, [], {
    invalidateOn: [resourceKey(appId, datasetId)],
    ...opts,
    reloadKey: `${appId}|${datasetId}|${filterKey}`,
  });
}
