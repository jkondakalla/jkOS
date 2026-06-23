import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  getMe, refreshToken, redirectToLogin, logout as authLogout,
  useSessionKeepalive, type JkosUser,
} from '@jkos/auth-client';

// ─── Types ────────────────────────────────────────────────────────────────────

// The suite-canonical user shape lives in @jkos/auth-client; alias it so the rest
// of ORDECK keeps importing AuthUser from here.
export type AuthUser = JkosUser;

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated'; error?: string };

export interface AuthContext {
  state:           AuthState;
  loginWithGoogle: () => void;
  logout:          () => Promise<void>;
}

// ─── Context (exported so plugins can consume it) ─────────────────────────────

export const authContext = createContext<AuthContext>({
  state:           { status: 'loading' },
  loginWithGoogle: () => redirectToLogin(),
  logout:          async () => { /* noop */ },
});

export function useAuth(): AuthContext {
  return useContext(authContext);
}

// ─── Core hook ────────────────────────────────────────────────────────────────

export function useAuthProvider(): AuthContext {
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

      const error = new URLSearchParams(window.location.search).get('error') ?? undefined;
      setState({ status: 'unauthenticated', error });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, [fetchMe]);

  useEffect(() => {
    check();
  }, [check]);

  // Keep the access token fresh on a long-open HUD so cards never blip to "SIGN IN".
  useSessionKeepalive();

  const loginWithGoogle = useCallback(() => redirectToLogin(), []);
  const logout = useCallback(() => authLogout(), []);

  return { state, loginWithGoogle, logout };
}
