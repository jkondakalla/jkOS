// KourOS's auth gate is the suite's shared one — see
// packages/auth-client/src/useAuthProvider.ts. This file's header used to read
// "mirrors apps/papyros/src/hooks/useAuth.ts verbatim", which it did — byte for
// byte apart from the comments. Now it mirrors nothing; it re-exports.
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
