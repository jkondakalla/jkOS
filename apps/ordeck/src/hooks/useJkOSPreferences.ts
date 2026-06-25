// ORDECK preferences = the shared @jkos/auth-client hook + ORDECK's CRT extras.
// Types/defaults are re-exported so existing ORDECK imports keep working.
import { useJkOSPreferences as useSharedPreferences } from '@jkos/auth-client';

export type {
  JkOSTheme, JkosUser, EffectsPreferences, LazurPreferences, UserPreferences, AuthProfile,
} from '@jkos/auth-client';
export { DEFAULT_THEME, DEFAULT_EFFECTS, DEFAULT_LAZUROS, AUTH_URL } from '@jkos/auth-client';

/**
 * Single source of truth for ORDECK's theme/effects/AI prefs. The shared hook
 * applies mode/accent to <html>; the auth/login hardware chrome (Led/Screw/Vent)
 * is pure CSS and re-themes off the --hub-* tokens, so no app-specific onApply
 * is needed.
 */
export function useJkOSPreferences() {
  return useSharedPreferences();
}
