// Types for @jkos/auth-middleware/codes — the canonical error-code vocabulary.
// Mirrors codes.js (the runtime source of truth). Imported by TS consumers
// (auth-client's authFetch) so a renamed code is a type error, not a silent miss.

export type AuthCode =
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_SCOPE'
  | 'NO_AUTH'
  | 'READ_ONLY'
  | 'NO_USER_CONTEXT'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED';

/** Frozen map of code name → identical string value. */
export declare const CODES: { readonly [K in AuthCode]: K };

/** Send a `{ error, code, ...extra }` JSON envelope with the given HTTP status. */
export declare function authError(
  res: any,
  status: number,
  code: AuthCode,
  error: string,
  extra?: Record<string, unknown>,
): any;
