// SylibOS consumes the shared jkOS auth + preferences contract from
// @jkos/auth-client. Only the session check is SylibOS-specific (same-origin
// /api/auth/me proxy), so it stays local; everything else is re-exported.
export {
  AUTH_URL,
  getProfile as getAuthProfile,
  patchProfile as patchAuthProfile,
  normaliseTheme,
  refreshToken,
  redirectToLogin,
  logout,
  DEFAULT_THEME,
  DEFAULT_EFFECTS,
  DEFAULT_LAZUROS,
} from '@jkos/auth-client';

export type {
  JkOSTheme,
  EffectsPreferences,
  LazurPreferences,
  JkosUser,
  UserPreferences,
  AuthProfile,
} from '@jkos/auth-client';

import type { JkosUser } from '@jkos/auth-client';

/**
 * Session check through SylibOS's same-origin proxy (/api/auth/me).
 * Throws on 5xx so a broken backend isn't treated as "logged out".
 */
export async function getMe(): Promise<JkosUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.ok) return ((await res.json()).user as JkosUser) ?? null;
  if (res.status >= 500) throw new Error(`Auth check failed: ${res.status}`);
  return null;
}
