// jkOS cross-app preferences contract. Stored as JSON in jkAuth users.preferences
// and served by GET /auth/profile. The flat theme shape is canonical; the legacy
// nested { dark, light } shape is migrated by normaliseTheme().

export interface JkOSTheme {
  mode:      'light' | 'dark' | 'system';
  primary:   string;   // single hex; CSS color-mix() adapts per mode
  secondary: string;
  // True when the user typed an exact hex (vs picked a preset). Presets are
  // auto-darkened in light mode so they don't wash out on the beige paper;
  // a hand-picked color is always honored exactly. Defaults to preset behavior.
  customAccent?: boolean;
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

export interface UserPreferences {
  scheme?:  string;   // SylibOS preset id
  theme?:   JkOSTheme;
  effects?: EffectsPreferences;
  lazuros?: LazurPreferences;
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
