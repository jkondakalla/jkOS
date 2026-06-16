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
