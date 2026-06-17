// ORDECK preferences = the shared @jkos/auth-client hook + ORDECK's CRT extras.
// Types/defaults are re-exported so existing ORDECK imports keep working.
import { useJkOSPreferences as useSharedPreferences } from '@jkos/auth-client';

export type {
  JkOSTheme, JkosUser, EffectsPreferences, LazurPreferences, UserPreferences, AuthProfile,
} from '@jkos/auth-client';
export { DEFAULT_THEME, DEFAULT_EFFECTS, DEFAULT_LAZUROS, AUTH_URL } from '@jkos/auth-client';

/**
 * Single source of truth for ORDECK's theme/effects/AI prefs. Emits the
 * `ordeck-mode` event on top of the shared applier so the portal's hardware
 * chrome (AuthGuard / LoginPage primitives) reacts to mode changes.
 */
export function useJkOSPreferences() {
  return useSharedPreferences({
    onApply: ({ isDark }) => {
      window.dispatchEvent(new CustomEvent('ordeck-mode', { detail: { isDark } }));
    },
  });
}
