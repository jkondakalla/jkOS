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
  /** Gated behind the suite-wide LazurOS kill switch. */
  ai?: boolean;
}

/**
 * Insertion order is the systems-panel probe order. Ids match the canonical
 * jkAuth `app_registry` ids (so registry rows merge over these by id) — note the
 * auth app is keyed `auth`, not `jkauth`. `lazuros` has no registry row (it's an
 * internal AI gateway, not a launchable app) so it lives here as the only
 * static-only entry; the registry enriches/overrides the rest at runtime.
 */
export const SUITE_APPS: Record<string, SuiteApp> = {
  auth:       { id: 'auth',       label: 'jkAuth',     origin: AUTH_URL,                       healthPath: '/health/auth' },
  beigeboard: { id: 'beigeboard', label: 'BeigeBoard', origin: 'https://beigeboard.jkos.net', apiBase: '/api/bb',      healthPath: '/health/bb',       capabilitiesPath: '/api/bb/capabilities' },
  sylibos:    { id: 'sylibos',    label: 'SylibOS',    origin: 'https://sylibos.jkos.net',    apiBase: '/api/sylib',   healthPath: '/health/sylibos' },
  lazuros:    { id: 'lazuros',    label: 'LazurOS',                                            apiBase: '/api/lazuros', healthPath: '/api/lazuros/health', ai: true },
};

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
