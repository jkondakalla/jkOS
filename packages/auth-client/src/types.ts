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

export interface LazurPreferences {
  enabled: boolean;   // suite-wide AI kill switch — false hides all LazurOS UI
  url:     string;
  model:   string;
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

export interface UserPreferences {
  scheme?:  string;   // SylibOS preset id
  theme?:   JkOSTheme;
  effects?: EffectsPreferences;
  lazuros?: LazurPreferences;
  // ORDECK's HUD layout document — an opaque blob from the suite's perspective
  // (ORDECK owns and validates its own shape). Lives here so the dashboard syncs
  // across devices via the same per-user store as theme, with no ORDECK backend.
  hud?:     unknown;
  // ORDECK "HUD shelf" — pins (a heterogeneous, suite-wide collection) and focus
  // (a suite-wide singleton). ORDECK-owned, stored here so ANY app can surface
  // its items on the HUD by {app,id} without ORDECK-specific columns/endpoints.
  hudPins?:  HudPin[];
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
}
