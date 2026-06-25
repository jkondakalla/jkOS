/**
 * weave/manifest.ts — the jkOS app manifest.
 *
 * ONE place that knows the suite's apps and how a portal reaches each:
 *   • origin           — external URL to open the app (deeplink target, "open" links)
 *   • apiBase          — edge-proxied, same-origin API root (cookies flow, no CORS)
 *   • healthPath       — edge-proxied health probe
 *   • capabilitiesPath — edge-proxied GET that returns the app's CapabilityDoc
 *                        (what can be DONE to it); null/absent = read-only app
 *
 * This is the STATIC fallback. jkAuth's `app_registry` is the authoritative
 * source at runtime — `useSuiteApps()` hydrates the live manifest from
 * `GET /auth/apps`, and the helpers below prefer that map when present, falling
 * back to these defaults before the fetch resolves and when offline.
 *
 * Adding a NEW app's interop is one seed row in the registry; this table only
 * needs an entry if the app must be reachable before the first /auth/apps load.
 */

import { AUTH_URL } from '@jkos/auth-client';
import { manifestApps, resourceKey, scopeFor, type ManifestEntry } from '@jkos/suite-manifest';

/** The invalidation bus key for an app resource, e.g. `'beigeboard.items'`. The bus
 *  key is DERIVED from the app id (`id.resource`), never a free string — re-exported
 *  from the single source so writers/readers/widgets reference one helper (ToDo A5). */
export { resourceKey, scopeFor };

export interface SuiteApp {
  id: string;
  label: string;
  /** External URL to launch / deeplink into the app. */
  origin?: string;
  /** Edge-proxied API root (same-origin; cookies flow). */
  apiBase?: string;
  /** Edge-proxied health probe path. */
  healthPath?: string;
  /** Edge-proxied path returning the app's CapabilityDoc; absent = read-only. */
  capabilitiesPath?: string;
  /** Edge-proxied path returning the app's DatasetDoc (what can be READ); absent = undeclared. */
  datasetsPath?: string;
  /** Gated behind the suite-wide LazurOS kill switch. */
  ai?: boolean;
}

/**
 * The static fallback, DERIVED from the single source (`@jkos/suite-manifest`) so it
 * can't drift from the registry seed / nginx peers (ToDo A2). Insertion order is the
 * systems-panel probe order. Ids match the canonical jkAuth `app_registry` ids (so
 * registry rows merge over these by id) — note the auth app is keyed `auth`. `lazuros`
 * has no registry row (internal AI gateway) so it's static-only; the registry
 * enriches/overrides the rest at runtime.
 *
 * Auth's `origin` is the one field NOT taken from the manifest: it's overridden with
 * the env-configurable `AUTH_URL` (so a dev proxy / staging can repoint sign-in).
 */
export const SUITE_APPS: Record<string, SuiteApp> = Object.fromEntries(
  Object.entries(manifestApps() as Record<string, ManifestEntry>).map(([id, e]) => [
    id,
    id === 'auth' ? { ...e, origin: AUTH_URL } : e,
  ]),
);

/**
 * The live manifest, when hydrated from the registry. `useSuiteApps()` sets this
 * so the plain (non-hook) helpers below resolve against the authoritative source.
 * Until then it is null and the helpers fall back to SUITE_APPS.
 */
let liveApps: Record<string, SuiteApp> | null = null;

/** Called by useSuiteApps once /auth/apps resolves; merges over the static defaults. */
export function setLiveApps(apps: Record<string, SuiteApp> | null): void {
  liveApps = apps;
}

/** Resolve one app, preferring the live registry over the static fallback. */
export function suiteApp(id: string): SuiteApp | undefined {
  return liveApps?.[id] ?? SUITE_APPS[id];
}

/** The current app map (live if hydrated, else the static fallback). */
export function suiteApps(): Record<string, SuiteApp> {
  return liveApps ?? SUITE_APPS;
}

/** API base for an app, or '' if it exposes none (callers build `${base}/items`). */
export function apiBase(id: string): string {
  return suiteApp(id)?.apiBase ?? '';
}

/** External origin for an app, or '' (used for "open the app" links/deeplinks). */
export function appOrigin(id: string): string {
  return suiteApp(id)?.origin ?? '';
}

/** Apps that expose a health probe, honoring the AI kill switch. Pass an explicit
 *  map (e.g. the hydrated one from useSuiteApps) to make callers reactive to
 *  registry changes; defaults to the current live-or-static map. */
export function probeApps(
  aiEnabled: boolean,
  apps: Record<string, SuiteApp> = suiteApps(),
): SuiteApp[] {
  return Object.values(apps).filter((a) => a.healthPath && (!a.ai || aiEnabled));
}
