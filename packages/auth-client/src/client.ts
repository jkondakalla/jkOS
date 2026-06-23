import type { AuthProfile, UserPreferences, JkosUser } from './types';

/** jkAuth origin. Override per app via VITE_JKOS_AUTH_URL (e.g. dev proxy, staging). */
export const AUTH_URL =
  ((import.meta as any).env?.VITE_JKOS_AUTH_URL as string | undefined) ?? 'https://auth.jkos.net';

/** GET /auth/profile → user + cross-app preferences. Returns null on any auth failure.
 *  Goes through authFetch so a 15-min-expired access token is refreshed + retried —
 *  the on-visibility prefs re-pull then survives returning to a long-idle tab. */
export async function getProfile(): Promise<AuthProfile | null> {
  try {
    const r = await authFetch(`${AUTH_URL}/auth/profile`);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/** PATCH /auth/profile — merge-patches top-level preference keys. Refresh-aware
 *  (authFetch) so a preference save issued just past the access-token TTL still
 *  persists instead of silently 401ing. */
export async function patchProfile(preferences: Partial<UserPreferences>): Promise<void> {
  await authFetch(`${AUTH_URL}/auth/profile`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ preferences }),
  });
}

/** GET /auth/me → current user. Throws on 5xx (broken backend ≠ logged out).
 *  Deliberately a plain fetch (no authFetch): useAuthProvider.check() owns the
 *  refresh-then-retry around this call, so auto-refreshing here would double up. */
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

/* Module-level dedupe: concurrent 401s (every card polls at once) share ONE
 * in-flight refresh instead of stampeding /auth/refresh. Cleared when it settles. */
let refreshing: Promise<boolean> | null = null;
function refreshOnce(): Promise<boolean> {
  if (!refreshing) refreshing = refreshToken().finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * The single refresh-aware fetch for the whole suite. Always sends cookies. On a
 * 401 whose body carries `code: TOKEN_EXPIRED | UNAUTHENTICATED`, it silently
 * rotates the access token from the (remember-me) refresh cookie and retries the
 * request once. Any other response — including a 401 that survives the refresh
 * (genuinely logged out) — is returned untouched, so callers keep their existing
 * sign-in handling. This is what lets a 15-min access token expire under a live
 * 30-day session without bouncing the user. (Replaces the per-app copies.)
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const opts: RequestInit = { credentials: 'include', ...init };
  const r = await fetch(input, opts);
  if (r.status !== 401) return r;

  // Read the code off a clone so the caller can still consume the body.
  let code: string | undefined;
  try { code = (await r.clone().json())?.code; } catch { return r; }
  if (code !== 'TOKEN_EXPIRED' && code !== 'UNAUTHENTICATED') return r;

  const ok = await refreshOnce();
  if (!ok) return r;
  return fetch(input, opts);
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
