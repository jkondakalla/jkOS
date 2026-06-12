import type { JkOSTheme, EffectsPreferences, LazurPreferences } from './types';

export const DEFAULT_THEME: JkOSTheme = {
  mode:      'system',
  primary:   '#ffb000',
  secondary: '#4ecdc4',
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
