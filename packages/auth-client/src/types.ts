// jkOS cross-app preferences contract. Stored as JSON in jkAuth users.preferences
// and served by GET /auth/profile. The flat theme shape is canonical; the legacy
// nested { dark, light } shape is migrated by normaliseTheme().

export interface JkOSTheme {
  mode:      'light' | 'dark' | 'system';
  primary:   string;   // single hex; CSS color-mix() adapts per mode
  secondary: string;
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
  url:   string;
  model: string;
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
