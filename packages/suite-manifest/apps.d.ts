// Types for @jkos/suite-manifest — mirrors apps.js (the runtime source of truth).
// Imported by TS consumers (Weave's manifest.ts) so a shape change is a type error.

/** Every canonical app id, in APPS order. This literal tuple is the ONE typed
 *  mirror of the runtime rows (a hand-written .d.ts cannot derive literals from
 *  CJS): `pnpm new-app` appends to it and the weave test gate asserts it matches
 *  `APP_IDS` in apps.js, so a drifted id fails red. */
export declare const APP_IDS: readonly ['auth', 'beigeboard', 'sylibos', 'ordeck', 'staging', 'lazuros'];

/** The canonical app-id union. Weave's public app-addressing signatures take THIS
 *  instead of `string`, so a typo'd or unregistered app id is a compile error at
 *  the call site (an unregistered id would otherwise fail silently at runtime —
 *  empty reads, never-refreshing widgets). */
export type AppId = (typeof APP_IDS)[number];

/** One row in the suite app directory. The `id` is the only identifier; all edge
 *  paths derive from it unless an override pins them (SylibOS / LazurOS). */
export interface AppRow {
  id: string;
  name: string;
  origin: string | null;
  allowedRoles: string[];
  /** container:port — the only stored infra fact. Absent = no proxied backend. */
  upstream?: string;
  /** Has a /health/<id> probe. */
  health?: boolean;
  /** Exposes an edge-proxied /api/<id> surface. */
  api?: boolean;
  /** Serves a Weave CapabilityDoc at apiBase/capabilities. */
  capabilities?: boolean;
  /** Serves a Weave DatasetDoc at apiBase/datasets. */
  datasets?: boolean;
  /** Gated by the suite-wide AI kill switch. */
  ai?: boolean;
  /** false = no jkAuth app_registry row (internal gateway). */
  registry?: boolean;
  /** nginx special-case marker (e.g. 'lazuros' host-network block). */
  kind?: string;
  /** Pins the edge API root when the slug ≠ id (un-migrated / bespoke). */
  apiBase?: string;
  /** Pins the health path when it isn't /health/<id>. */
  healthPath?: string;
}

/** A SUITE_APPS fallback entry (structurally the Weave SuiteApp). */
export interface ManifestEntry {
  id: string;
  label: string;
  origin?: string;
  apiBase?: string;
  healthPath?: string;
  capabilitiesPath?: string;
  datasetsPath?: string;
  ai?: boolean;
}

/** A jkAuth app_registry seed row. */
export interface RegistryRow {
  id: string;
  name: string;
  origin: string | null;
  icon_url: null;
  allowed_roles: string;
  api_base: string | null;
  health_path: string | null;
  capabilities_path: string | null;
  datasets_path: string | null;
  ai: 0 | 1;
}

/** An nginx peer-proxy row. */
export interface PeerRow {
  id: string;
  slug: string;
  upstream: string;
  health?: string;
  apiPrefix?: string;
  kind?: string;
}

export declare const APPS: AppRow[];

export declare function apiBaseOf(app: AppRow): string | null;
export declare function healthPathOf(app: AppRow): string | null;
export declare function capabilitiesPathOf(app: AppRow): string | null;
export declare function datasetsPathOf(app: AppRow): string | null;

/** The invalidation bus key, e.g. resourceKey('beigeboard','items') → 'beigeboard.items'. */
export declare function resourceKey(id: AppId, resource: string): string;
/** The capability scope, e.g. scopeFor('beigeboard','write') → 'beigeboard:write'. */
export declare function scopeFor(id: AppId, verb: string): string;

export declare function registrySeed(): RegistryRow[];
export declare function manifestApps(): Record<string, ManifestEntry>;
export declare function peers(): PeerRow[];
