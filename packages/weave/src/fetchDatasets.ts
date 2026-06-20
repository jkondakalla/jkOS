/**
 * weave/fetchDatasets.ts — discover what an app can be READ for.
 *
 * The read-side twin of fetchCapabilities: fetches an app's DatasetDoc from its
 * manifest `datasetsPath` (edge-proxied, same-origin so cookies flow), cached per
 * app id with the same transient-failure eviction so a brief outage doesn't
 * permanently disable a reader.
 */

import { suiteApp } from './manifest';
import type { DatasetDoc, DatasetDef } from './dataset';

const cache = new Map<string, Promise<DatasetDoc | null>>();

/** The app's DatasetDoc, or null if it declares none / is unreachable. Cached;
 *  pass force to re-fetch. */
export function fetchDatasets(appId: string, force = false): Promise<DatasetDoc | null> {
  if (!force && cache.has(appId)) return cache.get(appId)!;
  const p = (async (): Promise<DatasetDoc | null> => {
    const path = suiteApp(appId)?.datasetsPath;
    if (!path) return null;
    try {
      const r = await fetch(path, { credentials: 'include' });
      if (!r.ok) return null;
      const doc = (await r.json()) as DatasetDoc;
      return doc && Array.isArray(doc.datasets) ? doc : null;
    } catch {
      return null;
    }
  })();
  cache.set(appId, p);
  // Evict a settled-null so the next caller retries (mirrors fetchCapabilities).
  void p.then((doc) => { if (!doc && cache.get(appId) === p) cache.delete(appId); });
  return p;
}

/** Find one dataset by id within a doc. */
export function getDataset(doc: DatasetDoc | null, id: string): DatasetDef | null {
  return doc?.datasets.find((d) => d.id === id) ?? null;
}
