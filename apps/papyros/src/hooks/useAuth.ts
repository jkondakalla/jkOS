// PapyrOS's auth gate is the suite's shared one — see
// packages/auth-client/src/useAuthProvider.ts. This file was a copy of ORDECK's;
// KourOS then copied this one, making three copies of one state machine.
//
// Kept as a re-export so PapyrOS's call sites still import from './hooks/useAuth'.
// PapyrOS redirects rather than prompting, so it never reads `loginWithGoogle` —
// AuthGuard owns that decision.
export {
  authContext,
  useAuth,
  useAuthProvider,
  type AuthUser,
  type AuthState,
  type AuthContextValue,
} from '@jkos/auth-client';
