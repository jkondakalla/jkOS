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
import { suiteApp, resourceKey, type AppId } from './manifest';
import { usePolledResource, type PolledOptions } from './resource';
import { fetchCapabilities, getCapability } from './fetchCapabilities';
import { fetchDatasets } from './fetchDatasets';
import { readDataset, type DatasetRead } from './readDataset';
import { runCommand, type CommandResult } from './dispatch';

export type ListFilters = Record<string, string | number | boolean | undefined | null>;

/** Imperative, discovery-driven peer client. Cheap to construct (no hooks). */
export function weaveClient(appId: AppId) {
  return {
    /** The peer's CapabilityDoc (cached). */
    capabilities: (force?: boolean) => fetchCapabilities(appId, force),
    /** The peer's DatasetDoc (cached). */
    datasets: (force?: boolean) => fetchDatasets(appId, force),

    /** One read of a declared dataset, with its STATE — ready, empty, signed-out,
     *  offline, unavailable… (readDataset). What to call when "nothing" and "could
     *  not tell" must look different, which on a screen is always. */
    read: (datasetId: string, params?: ListFilters): Promise<DatasetRead> => readDataset(appId, datasetId, params),

    /** The rows of a declared list dataset, or [] — for a caller that genuinely draws
     *  every failure the same way. Anything shown to a person wants `read`. */
    async list<T = unknown>(datasetId: string, filters?: ListFilters): Promise<T[]> {
      const r = await readDataset(appId, datasetId, filters);
      return Array.isArray(r.data) ? (r.data as T[]) : [];
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
