import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { redirectToLogin } from '@jkos/auth-client';
import { authContext, useAuthProvider } from '../hooks/useAuth';
import { Lab } from '@jkos/ui';

// ─── AuthGuard ────────────────────────────────────────────────────────────────
// Mirrors apps/papyros/src/components/AuthGuard.tsx verbatim (itself ORDECK-
// style): owns the auth lifecycle, provides AuthContext so any view can read
// `user` via useAuth(), and renders:
//   - a loading veil while the session check is in flight
//   - a brief "redirecting" veil (then window.location.href → the auth portal,
//     preserving the scaffold's redirect_to-preserving behaviour) when signed out
//   - children once authenticated
// KourOS has no click-to-sign-in LoginPage — the app only ever runs behind the
// auth portal, so an automatic redirect stays the UX.

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const auth = useAuthProvider();

  return (
    <authContext.Provider value={auth}>
      {auth.state.status === 'loading' && <AuthVeil label="Verifying session" />}
      {auth.state.status === 'unauthenticated' && <Redirecting />}
      {auth.state.status === 'authenticated' && children}
    </authContext.Provider>
  );
}

// ─── Redirect (preserves redirect_to via @jkos/auth-client's redirectToLogin) ─────

function Redirecting() {
  useEffect(() => { redirectToLogin(); }, []);
  return <AuthVeil label="Redirecting to sign-in" />;
}

// ─── Loading veil ─────────────────────────────────────────────────────────────

function AuthVeil({ label }: { label: string }) {
  return (
    <div className="auth-veil">
      <span className="auth-veil-mark" aria-hidden="true" />
      <Lab size="sm">{label}</Lab>
    </div>
  );
}
