/**
 * weave/useSuiteApps.ts — hydrate the app manifest from jkAuth's registry.
 *
 * jkAuth's `app_registry` is the authoritative directory; this hook fetches it
 * (GET /auth/apps), maps each row to the camelCase SuiteApp shape, merges those
 * over the static SUITE_APPS fallback (registry enriches/overrides by id), and
 * publishes the result via setLiveApps so the non-hook helpers (apiBase/appOrigin/
 * probeApps) resolve against the live directory too.
 *
 * Returns the merged map so consumers (e.g. useSystems) re-render reactively when
 * the registry resolves — adding an app to the registry surfaces it with no portal
 * code change. On failure it keeps the static fallback (offline-safe).
 */

import { useCallback } from 'react';
import { AUTH_URL } from '@jkos/auth-client';
import { usePolledResource } from './resource';
import { SUITE_APPS, setLiveApps, type SuiteApp } from './manifest';

/** A raw /auth/apps row (snake_case, `name` not `label`). */
interface AppRow {
  id: string;
  name?: string;
  origin?: string | null;
  api_base?: string | null;
  health_path?: string | null;
  capabilities_path?: string | null;
  datasets_path?: string | null;
  ai?: number | boolean | null;
}

/** Map a registry row to SuiteApp, OMITTING empty fields so the merge below never
 *  clobbers a static value with a registry null. */
function mapRow(row: AppRow): SuiteApp {
  const app: SuiteApp = { id: row.id, label: row.name || row.id };
  if (row.origin) app.origin = row.origin;
  if (row.api_base) app.apiBase = row.api_base;
  if (row.health_path) app.healthPath = row.health_path;
  if (row.capabilities_path) app.capabilitiesPath = row.capabilities_path;
  if (row.datasets_path) app.datasetsPath = row.datasets_path;
  if (row.ai) app.ai = true;
  return app;
}

/** Registry rows merged over the static fallback, keyed by id. */
function mergeRegistry(rows: AppRow[]): Record<string, SuiteApp> {
  const merged: Record<string, SuiteApp> = {};
  for (const [id, a] of Object.entries(SUITE_APPS)) merged[id] = { ...a };
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    const m = mapRow(row);
    const base = merged[m.id];
    // mapRow always produces a label (falls back to the id), but a registry row
    // with no `name` must NOT clobber a nicer static label — keep the existing
    // one, matching how every other field is omitted-when-empty above.
    if (!row.name && base?.label) m.label = base.label;
    merged[m.id] = { ...base, ...m };
  }
  return merged;
}

export function useSuiteApps(): Record<string, SuiteApp> {
  const fetcher = useCallback(async (): Promise<Record<string, SuiteApp>> => {
    const r = await fetch(`${AUTH_URL}/auth/apps`, { credentials: 'include' });
    if (!r.ok) throw new Error('auth apps');
    const d = await r.json();
    const rows: AppRow[] = Array.isArray(d) ? d : d.apps ?? [];
    const merged = mergeRegistry(rows);
    setLiveApps(merged);     // so non-hook helpers resolve against the registry too
    return merged;
  }, []);
  // Seed with the static fallback; on failure usePolledResource keeps it (and
  // liveApps stays null, so the helpers fall back too — offline-safe).
  return usePolledResource(fetcher, SUITE_APPS, { refetchOnVisible: true });
}
