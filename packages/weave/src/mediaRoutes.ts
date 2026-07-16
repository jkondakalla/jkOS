/**
 * weave/mediaRoutes.ts — the MEDIA-ROUTES primitive (Layer D / 17.3).
 *
 * The fourth new brick (next to defineCollection / defineConnector / triggers): the
 * routes every catalog-backed media backend hand-wrote — range-aware streaming, cover
 * art, whole-item download (1 file direct, N zipped store-only), and the compat/
 * transcode pipeline — declared as one pure-data SPEC. The one piece worth promoting is
 * the PLAYBACK DECISION ENGINE (`decidePlayback`): client capabilities in, a
 * `{ rung, rendition, reason }` out — Jellyfin's direct-play → direct-stream → transcode
 * ladder, which video (Wave 19) inherits. papyros's Firefox-m4b ladder is that engine
 * wearing an audiobook disguise; its rules become app-SUPPLIED ladder config, not brick
 * literals.
 *
 * Design-time shapes only; the runtime factory is ./server/mediaRoutes.js (subpath
 * `@jkos/weave/mediaRoutes`). Sits on `@jkos/files` for the Range logic; path
 * containment stays the app's job (its resolveFile vouches for the paths it returns).
 */

/** One rung of the transcode ladder, lowest-cost first. `direct` (level 0, no `args`)
 *  serves the source itself; every other rung generates a variant via ffmpeg `args`. */
export interface PlaybackRung {
  level: number;
  strategy: 'direct' | 'remux' | 'reencode';
  ext?: string;                                    // variant file extension, e.g. '.m4a'
  contentType?: string;                            // descriptive rendition mime (serving uses spec.contentType)
  /** ffmpeg args builder: (srcPath, tmpOutPath) => argv (no binary — that is spec.ffmpeg). */
  args?: (srcPath: string, tmpPath: string) => string[];
  /** capability-driven mode: can the client consume THIS rung's output? Absent = universal. */
  satisfies?: (source: unknown, client: unknown) => boolean;
}

/** The decision engine's answer: the chosen rung's strategy + its rendition (the rung
 *  itself for a non-direct rung, else null — nothing to generate) + a human reason. */
export interface PlaybackDecision {
  rung: 'direct' | 'remux' | 'reencode' | null;
  level: number | null;
  rendition: PlaybackRung | null;
  reason: string;
}

/** What an app's `resolveFile(id)` returns: the file(s) on disk for a media id. `path`
 *  is an ABSOLUTE path the app has already containment-checked (null = a containment
 *  violation the app refused to resolve — the brick treats it as not-found). `name`
 *  seeds the download filename; `id` is the canonical id used in the variant filename. */
export interface MediaFileSet {
  id?: string | number;
  name?: string;
  files: Array<{ index: number; path: string | null }>;
}

export interface MediaRoutesSpec {
  /** id → the file(s) on disk (absolute, app-vouched). null = the media id doesn't exist. */
  resolveFile: (id: string) => MediaFileSet | null;
  /** id → an absolute cover-art path, or null (404). Omit to serve no cover route. */
  resolveCover?: (id: string) => string | null;
  /** absPath → Content-Type (source + variant serving). Required — the brick bakes in no mime map. */
  contentType: (absPath: string) => string;
  /** absPath → cover Content-Type. Defaults to `contentType`. */
  coverContentType?: (absPath: string) => string;
  /** Cover Cache-Control. Default 'private, max-age=86400'. */
  coverCacheControl?: string;
  /** The transcode ladder (app config). Omit for a stream/cover/download-only backend. */
  ladder?: PlaybackRung[];
  /** Directory variants are written under. Required when a ladder is supplied. */
  cacheDir?: string;
  /** ffmpeg binary name or path. Default 'ffmpeg'. */
  ffmpeg?: string;
  /** The `archiver` module, injected (weave never hard-depends on it). Needed only for N-file zips. */
  archiver?: unknown;
  /** Route path bases. Defaults: /api/stream, /api/cover, /api/download. */
  routes?: { stream?: string; cover?: string; download?: string };
  /** Variant filename builder. Default `${id}-${fileIndex}.c${level}${ext}`. */
  variantName?: (id: string | number, fileIndex: number, level: number, ext: string) => string;
  /** Error sink, `(context, err) => void`. Default console.error. */
  onError?: (context: string, err: unknown) => void;
}

export interface MediaRoutes {
  /** Wire GET stream (+ POST …/prepare when a ladder is present), GET cover, GET download. */
  mount(router: unknown): void;
  /** Generate one rung (single-flight). `wait:true` awaits (for a pre-generation sweep). */
  ensurePrepared(args: { id: string | number; fileIndex: number; level: number; wait?: boolean }):
    Promise<{ status: 'invalid' | 'missing' | 'ready' | 'pending' | 'error' }>;
  /** Freshness-only probe (no generation) — for a detail route reporting rung readiness. */
  prepared(args: { id: string | number; fileIndex: number; level: number }): boolean;
  isPrepared(args: { id: string | number; fileIndex: number; level: number }): boolean;
  /** This instance's ladder, pre-bound (`{ source?, client?, requestedLevel? }` in). */
  decide(args?: { source?: unknown; client?: unknown; requestedLevel?: number | null }): PlaybackDecision;
  ladder: PlaybackRung[];
}

// The runtime factory + the pure `decidePlayback` engine live in ./server/mediaRoutes.js
// (subpath `@jkos/weave/mediaRoutes`); this file carries design-time shapes only — the
// twin of capability.ts / collection.ts / connector.ts, which are likewise types-only.
