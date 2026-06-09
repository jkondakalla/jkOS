import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const JKOS_AUTH_URL = (import.meta.env.VITE_JKOS_AUTH_URL as string | undefined)
  ?? 'https://auth.jkos.net';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:         string;
  email:      string;
  name:       string;
  avatar_url: string | null;
  role:       string;
}

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
  loginWithGoogle: () => {
    window.location.href = `${JKOS_AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}`;
  },
  logout: async () => { /* noop */ },
});

export function useAuth(): AuthContext {
  return useContext(authContext);
}

// ─── Core hook ────────────────────────────────────────────────────────────────

export function useAuthProvider(): AuthContext {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const fetchMe = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`${JKOS_AUTH_URL}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setState({ status: 'authenticated', user: data.user as AuthUser });
      return true;
    }
    return false;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`${JKOS_AUTH_URL}/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
    });
    return res.ok;
  }, []);

  const check = useCallback(async () => {
    try {
      const ok = await fetchMe();
      if (ok) return;

      const refreshed = await refresh();
      if (refreshed) {
        const retried = await fetchMe();
        if (retried) return;
      }

      const params = new URLSearchParams(window.location.search);
      const error  = params.get('error') ?? undefined;
      setState({ status: 'unauthenticated', error });
    } catch {
      setState({ status: 'unauthenticated' });
    }
  }, [fetchMe, refresh]);

  useEffect(() => {
    check();
  }, [check]);

  const loginWithGoogle = useCallback(() => {
    window.location.href =
      `${JKOS_AUTH_URL}/auth/login?redirect_to=${encodeURIComponent(window.location.href)}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${JKOS_AUTH_URL}/auth/logout`, {
        method:      'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = `${JKOS_AUTH_URL}/auth/login`;
    }
  }, []);

  return { state, loginWithGoogle, logout };
}
