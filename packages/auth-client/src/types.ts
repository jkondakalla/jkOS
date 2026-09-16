// jkOS cross-app preferences contract. Stored as JSON in jkAuth users.preferences
// and served by GET /auth/profile. The flat theme shape is canonical; the legacy
// nested { dark, light } shape is migrated by normaliseTheme().

export interface JkOSTheme {
  mode:      'light' | 'dark' | 'system';
  primary:   string;   // user's primary accent; hub.css deepens for paper, raw + glow for dark
  secondary: string;   // user's secondary accent — a co-equal vivid accent, not a neutral
}

export interface EffectsPreferences {
  grain:         boolean;
  grainStrength: number;   // 0–1
  halation:      boolean;
  scanLines:     boolean;
  scanStrength:  number;   // 0–1
  artifacts:     boolean;
}

/** The suite-wide AI kill switch, and nothing else. LazurOS is reached at one fixed
 *  edge path (/api/lazuros) and picks its own model per tier from the deployment's
 *  mounted deployment.json — so there is no per-user gateway URL or model to set.
 *  Owned by the jkAuth portal; every other app only READS `enabled`. */
export interface LazurPreferences {
  enabled: boolean;   // false hides all LazurOS UI, suite-wide
}

/** A reference to something surfaced on the ORDECK HUD (a pin, or the focus).
 *  App-agnostic: any suite app pins/focuses its own items by {app,id}, so the
 *  HUD shelf isn't tied to one app's schema. ORDECK enriches a reference from
 *  live app data when it has it, else renders the snapshot. */
export interface HudRef {
  app:       string;   // source app id (matches the suite manifest)
  id:        string;   // item id within that app
  label:     string;   // snapshot of the display text
  deeplink?: string;   // URL back to the item in its app
  tone?:     string;   // optional status-colour snapshot (an ORDECK tone key)
}
/** Same as HudRef but `id` may arrive as a number from a caller's data. */
export interface HudRefInput extends Omit<HudRef, 'id'> { id: string | number }
export type HudPin = HudRef & { ts?: number };
export type HudFocus = HudRef;

/** The cross-app preferences blob (`users.preferences`, served by GET/PATCH
 *  /auth/profile). It is the ONE per-user store that follows a person across
 *  devices, so what may live here — and under what key — is a contract.
 *
 *  ⚠️ XC-5: the convention, stated because there wasn't one and the blob was
 *  accreting flat keys from whichever app got there first.
 *
 *    · SUITE-WIDE settings sit at the TOP LEVEL: `theme`, `effects`, `timezone`.
 *      These mean the same thing to every app, and an app that reads one is
 *      reading a shared fact rather than reaching into a neighbour.
 *    · APP-OWNED settings live under a key equal to the APP ID: `lazuros`
 *      already does this correctly. The app owns and validates its own shape;
 *      nothing else may write it.
 *
 *  ⚠️ `hud`, `hudPins` and `hudFocus` were ORDECK's and predated the rule. They now
 *  live under `ordeck.*`, with the top-level keys kept as a READ FALLBACK and
 *  nulled on the next write — a lazy per-user migration, because they are live user
 *  data and a rename is silent data loss for anyone who does not save afterwards.
 *
 *  ⚠️ And it is not the whole story: PapyrOS, KourOS and ORDECK each keep some
 *  state in `localStorage` that never reaches here (volume, queue prefs, a
 *  weather widget's config), so it does not follow the user across devices. That
 *  is a real asymmetry, documented in ARCHITECTURE.md rather than pretended away.
 */
export interface UserPreferences {
  // ── suite-wide ────────────────────────────────────────────────────────────
  theme?:   JkOSTheme;
  effects?: EffectsPreferences;
  /** IANA zone (e.g. 'America/Chicago'). The suite has no notion of WHERE the
   *  user is, so "today" is currently four different answers across four files
   *  — see BACKLOG.md's D5. This is where the one answer belongs. */
  timezone?: string;

  // ── app-owned, keyed by app id ────────────────────────────────────────────
  lazuros?: LazurPreferences;
  /** ORDECK's slice — the HUD layout document, the shelf pins and the focus
   *  singleton. App-owned, under a key equal to the APP ID, per the convention
   *  above. Opaque from the suite's perspective: ORDECK owns and validates its own
   *  shape. Lives here so the dashboard syncs across devices via the same per-user
   *  store as theme, with no ORDECK backend. */
  ordeck?: OrdeckPreferences;

  /* ── LEGACY, top-level, being migrated away (XC-5) ─────────────────────────
   * ⚠️ These three predate the namespacing rule and sit at the top level where they
   * do not belong. They are LIVE USER DATA — someone's dashboard layout — so the
   * move is a READ-FALLBACK plus a LAZY RE-WRITE, never a rename: a rename is a
   * silent data loss for anyone who does not happen to save afterwards.
   *
   * Readers prefer `ordeck.*` and fall back to these. Writers write `ordeck.*` AND
   * null the legacy key in the same patch, so a blob converts itself the first time
   * the user touches their dashboard and never converts twice.
   *
   * ⚠️ Do not delete these fields until the legacy keys are gone from real blobs.
   * There is no migration that can run for them — jkAuth stores the blob opaquely
   * and does not know what a `hud` is. */
  /** @deprecated read `ordeck.hud` */
  hud?:     unknown;
  /** @deprecated read `ordeck.hudPins` */
  hudPins?:  HudPin[];
  /** @deprecated read `ordeck.hudFocus` */
  hudFocus?: HudFocus | null;
}

/** ORDECK's own preference slice. Namespaced under the app id (XC-5). */
export interface OrdeckPreferences {
  /** The HUD layout document. Opaque to everything but ORDECK. */
  hud?:      unknown;
  /** Pins — a heterogeneous, suite-wide collection. Stored here so ANY app can
   *  surface its items on the HUD by {app,id} with no ORDECK-specific columns. */
  hudPins?:  HudPin[];
  /** Focus — a suite-wide singleton. */
  hudFocus?: HudFocus | null;
}

export interface JkosUser {
  id:         string;
  email:      string;
  name:       string;
  avatar_url: string | null;
  role:       string;
}

export interface AuthProfile {
  user:        JkosUser;
  preferences: UserPreferences;
  /** Optimistic-lock cursor for the preferences blob (ARCH-7.2). Echo it back on
   *  PATCH so a write built on a stale blob 409s instead of clobbering a concurrent
   *  one; the shared hook tracks it and re-applies on conflict. Absent from a
   *  pre-ARCH-7 server → treated as unversioned (no lock, last-write-wins). */
  prefs_version?: number;
}
