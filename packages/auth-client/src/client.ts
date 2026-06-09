import type { AuthProfile, UserPreferences, JkosUser } from './types';

/** jkAuth origin. Override per app via VITE_JKOS_AUTH_URL (e.g. dev proxy, staging). */
export const AUTH_URL =
  ((import.meta as any).env?.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net';

/** GET /auth/profile → user + cross-app preferences. Returns null on any auth failure. */
export async function getProfile(): Promise<AuthProfile | null> {
  try {
    const r = await fetch(`${AUTH_URL}/auth/profile`, { credentials: 'include' });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/** PATCH /auth/profile — merge-patches top-level preference keys. */
export async function patchProfile(preferences: Partial<UserPreferences>): Promise<void> {
  await fetch(`${AUTH_URL}/auth/profile`, {
    method:      'PATCH',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ preferences }),
  });
}

/** GET /auth/me → current user. Throws on 5xx (broken backend ≠ logged out). */
export async function getMe(): Promise<JkosUser | null> {
  const r = await fetch(`${AUTH_URL}/auth/me`, { credentials: 'include' });
  if (r.ok) return ((await r.json()).user as JkosUser) ?? null;
  if (r.status >= 500) throw new Error(`Auth check failed: ${r.status}`);
  return null;
}

/** POST /auth/refresh — rotate access token from the refresh cookie. */
export async function refreshToken(): Promise<boolean> {
  const r = await fetch(`${AUTH_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  return r.ok;
}

/** Redirect to the jkAuth login page, returning to the current URL after login. */
export function redirectToLogin(): void {
  window.location.href = `${AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}`;
}

/** POST /auth/logout, then send the user to the login page. */
export async function logout(): Promise<void> {
  await fetch(`${AUTH_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  window.location.href = `${AUTH_URL}/auth/login`;
}
