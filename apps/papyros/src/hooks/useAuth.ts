import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  getMe, refreshToken, logout as authLogout, useSessionKeepalive, type JkosUser,
} from '@jkos/auth-client';

// ─── Types ────────────────────────────────────────────────────────────────────
// Mirrors apps/ordeck/src/hooks/useAuth.ts (the ORDECK-style auth-guard pattern this
// task adapts): the suite-canonical user shape lives in @jkos/auth-client, aliased so
// the rest of PapyrOS keeps importing AuthUser from here.

export type AuthUser = JkosUser;

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' };

export interface AuthContextValue {
  state:  AuthState;
  logout: () => Promise<void>;
}

// ─── Context (exported so any view can read `user` via useAuth()) ────────────────

export const authContext = createContext<AuthContextValue>({
  state:  { status: 'loading' },
  logout: async () => { /* noop */ },
});

export function useAuth(): AuthContextValue {
  return useContext(authContext);
}

// ─── Core hook ────────────────────────────────────────────────────────────────
// Unlike ORDECK (which shows a click-to-sign-in LoginPage on 'unauthenticated'),
// PapyrOS preserves the scaffold's automatic-redirect behaviour — AuthGuard reacts
// to 'unauthenticated' by sending the browser straight to the auth portal. This hook
// only owns the identity check; the redirect lives in AuthGuard.

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const user = await getMe();
      if (user) { setState({ status: 'authenticated', user }); return true; }
    } catch { /* 5xx (broken backend ≠ logged out) — fall through to unauthenticated */ }
    return false;
  }, []);

  // Mount bootstrap: who am I? → if the access token lapsed, rotate the remember-me
  // refresh cookie and ask again → else surface logged-out. (Per-request refresh for
  // data calls is handled by authFetch in @jkos/auth-client; this is just the gate.)
  const check = useCallback(async () => {
    try {
      if (await fetchMe()) return;
      if (await refreshToken() && await fetchMe()) return;
      setState({ status: 'unauthenticated' });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, [fetchMe]);

  useEffect(() => { check(); }, [check]);

  // Keep the access token fresh so a long-open tab never 401s mid-session.
  useSessionKeepalive();

  const logout = useCallback(() => authLogout(), []);

  return { state, logout };
}
