// ORDECK's auth gate is the suite's shared one — see
// packages/auth-client/src/useAuthProvider.ts, which this file used to BE before
// other apps grew copies of it.
//
// Kept as a re-export so ORDECK's call sites (and any plugin) still import from
// '../hooks/useAuth'. `AuthContext` keeps its original ORDECK name here.
export {
  authContext,
  useAuth,
  useAuthProvider,
  type AuthUser,
  type AuthState,
  type AuthContextValue as AuthContext,
} from '@jkos/auth-client';
