// ORDECK preferences = the shared @jkos/auth-client hook + ORDECK's CRT extras.
// Types/defaults are re-exported so existing ORDECK imports keep working.
import { useJkOSPreferences as useSharedPreferences } from '@jkos/auth-client';

export type {
  JkOSTheme, JkosUser, EffectsPreferences, LazurPreferences, UserPreferences, AuthProfile,
} from '@jkos/auth-client';
export { DEFAULT_THEME, DEFAULT_EFFECTS, DEFAULT_LAZUROS, AUTH_URL } from '@jkos/auth-client';

/**
 * Single source of truth for ORDECK's theme/effects/AI prefs. Adds the CRT
 * scanline overlay var + `ordeck-mode` event on top of the shared applier so
 * the portal's hardware chrome reacts to mode changes.
 */
// scanStrength is a 0–1 user-facing slider; the overlay var is a raw opacity
// where anything past ~0.05 blacks out the screen (1px amber line every 3px).
// Full slider = 0.05; the 0.25 default lands on the hub.css dark value (0.012).
const SCANLINE_OPACITY_MAX = 0.05;

export function useJkOSPreferences() {
  return useSharedPreferences({
    onApply: ({ isDark, effects }) => {
      document.documentElement.style.setProperty(
        '--crt-scanline-opacity',
        isDark && effects.scanLines
          ? String(effects.scanStrength * SCANLINE_OPACITY_MAX)
          : '0',
      );
      window.dispatchEvent(new CustomEvent('ordeck-mode', { detail: { isDark } }));
    },
  });
}
