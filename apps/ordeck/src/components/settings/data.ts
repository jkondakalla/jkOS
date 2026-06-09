import type { Settings } from './types';

export const SETTINGS_KEY = 'ordeck-settings-v2';  // bumped: old settings have removed fields

export const DEFAULT_SETTINGS: Settings = {
  scanlines:   0.012,
  vignette:    0.45,
  gridDensity: 1,
  boldGlow:    false,
  showBus:     true,
  showRail:    true,
  showScrews:  true,
};
