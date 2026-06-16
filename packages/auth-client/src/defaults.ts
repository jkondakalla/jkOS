import { ACCENT_SCHEMES } from '@jkos/design';
import type { JkOSTheme, EffectsPreferences, LazurPreferences } from './types';

// The house default is the first accent scheme (amber · cyan) — single source of
// truth in @jkos/design, so the default and the chooser's first slot never drift.
const HOUSE = ACCENT_SCHEMES[0];

export const DEFAULT_THEME: JkOSTheme = {
  mode:      'system',
  primary:   HOUSE.primary,
  secondary: HOUSE.secondary,
};

export const DEFAULT_EFFECTS: EffectsPreferences = {
  grain:         true,
  grainStrength: 0.35,
  halation:      true,
  scanLines:     false,
  scanStrength:  0.25,
  artifacts:     false,
};

export const DEFAULT_LAZUROS: LazurPreferences = {
  enabled: true,
  url:     '',
  model:   'llama3.2',
};
