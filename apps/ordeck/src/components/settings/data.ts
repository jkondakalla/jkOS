import type { Settings } from './types';

export const SETTINGS_KEY = 'ordeck-settings-v2';  // bumped: old settings have removed fields

export const DEFAULT_SETTINGS: Settings = {
  gridDensity: 1,
  showBus:     true,
  showRail:    true,
  showScrews:  true,
};
