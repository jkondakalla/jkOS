// KourOS's auth gate is the suite's shared one — see
// packages/auth-client/src/useAuthProvider.ts. It mirrors nothing; it re-exports.
//
// Kept as a re-export so KourOS's call sites still import from './hooks/useAuth'.
// KourOS only ever runs behind the auth portal, so it never reads
// `signIn` — AuthGuard redirects instead.
export {
  authContext,
  useAuth,
  useAuthProvider,
  type AuthUser,
  type AuthState,
  type AuthContextValue,
} from '@jkos/auth-client';
