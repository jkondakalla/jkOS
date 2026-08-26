// The suite's ONE auth-gate hook: "who am I, and what do I do if the answer is nobody".
//
// This started as apps/ordeck/src/hooks/useAuth.ts. PapyrOS copied it, then KourOS
// copied PapyrOS — its header said "mirrors apps/papyros/src/hooks/useAuth.ts
// verbatim", which was true: the two were byte-identical apart from their comments.
// Three copies of a token-refresh state machine is three places for a session bug to
// be fixed in two of them.
//
// ORDECK's version was a strict SUPERSET of the other two — it alone surfaced
// `signIn` (it renders a click-to-sign-in panel) and the `?error=` query param. So
// no parameterisation was needed to unify them: this is ORDECK's shape, and the
// apps that redirect instead of prompting simply never read `signIn`. Each app
// keeps a thin `hooks/useAuth.ts` re-export so its own call sites still say
// `from '../hooks/useAuth'`.
//
// `signIn` was `loginWithGoogle` until the 2026-08 reset removed jkAuth's Google
// OAuth. It never did anything Google-specific — it has always just bounced the
// browser to the jkAuth portal, which now prompts for a password.
//
// The bootstrap sequence is the load-bearing part: ask who I am → if the access
// token lapsed, rotate the remember-me refresh cookie and ask again → only then
// declare logged-out. Skipping the middle step logs out every returning user whose
// 15-minute access token expired while the tab was closed.
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { getMe, refreshToken, redirectToLogin, logout as authLogout } from './client';
import type { JkosUser } from './types';
import { useSessionKeepalive } from './useSessionKeepalive';

/** The suite-canonical user shape, aliased so apps can re-export it as AuthUser. */
export type AuthUser = JkosUser;

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  /** `error` is set from the `?error=` the portal appends on a failed round-trip. */
  | { status: 'unauthenticated'; error?: string };

export interface AuthContextValue {
  state:  AuthState;
  /** Only meaningful for an app that prompts (ORDECK); redirect-style apps ignore it. */
  signIn: () => void;
  logout: () => Promise<void>;
}

// Exported so any view — or an ORDECK plugin — can read `user` via useAuth().
export const authContext = createContext<AuthContextValue>({
  state:  { status: 'loading' },
  signIn: () => redirectToLogin(),
  logout: async () => { /* noop until a provider mounts */ },
});

export function useAuth(): AuthContextValue {
  return useContext(authContext);
}

/**
 * Owns the identity check only. What to DO about `unauthenticated` is the host
 * AuthGuard's call — ORDECK renders a sign-in panel, PapyrOS/KourOS redirect to the
 * portal — which is why this hook never navigates on its own.
 */
export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const user = await getMe();
      if (user) { setState({ status: 'authenticated', user }); return true; }
    } catch { /* 5xx (broken backend ≠ logged out) — fall through to unauthenticated */ }
    return false;
  }, []);

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

  useEffect(() => { check(); }, [check]);

  // Keep the access token fresh so a long-open tab never 401s mid-session.
  useSessionKeepalive();

  const signIn = useCallback(() => redirectToLogin(), []);
  const logout = useCallback(() => authLogout(), []);

  return { state, signIn, logout };
}
