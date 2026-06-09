import type { ReactNode } from 'react';
import { authContext, useAuthProvider } from '../hooks/useAuth';
import LoginPage from '../pages/LoginPage';
import { Led } from './hardware';

// ─── AuthGuard ────────────────────────────────────────────────────────────────

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Wraps the app with auth state. Renders:
 *   - A pulsing amber LED spinner while the session is loading
 *   - LoginPage when the user is unauthenticated
 *   - children when authenticated
 *
 * Also provides AuthContext so plugins can read `user` via `useAuth()`.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const auth = useAuthProvider();

  return (
    <authContext.Provider value={auth}>
      {auth.state.status === 'loading' && <LoadingOverlay />}
      {auth.state.status === 'unauthenticated' && <LoginPage />}
      {auth.state.status === 'authenticated' && children}
    </authContext.Provider>
  );
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

function LoadingOverlay() {
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      background:     'var(--hub-bg-0)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            16,
      zIndex:         8000,
      fontFamily:     'var(--hub-font-mono)',
    }}>
      <Led color="amber" size="lg" />
      <span style={{
        fontSize:      9,
        letterSpacing: '0.24em',
        color:         'var(--hub-cream-dim, #b8a882)',
        textTransform: 'uppercase',
      }}>
        VERIFYING SESSION
      </span>
    </div>
  );
}
