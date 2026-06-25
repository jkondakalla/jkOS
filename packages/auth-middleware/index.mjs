// ESM entry — re-exports the CJS implementation so ESM backends (type: module)
// can `import { jkosAuth, verifyToken } from '@jkos/auth-middleware'`.
import mw from './index.js';

export const jkosAuth = mw.jkosAuth;
export const verifyToken = mw.verifyToken;
export const requireScope = mw.requireScope;
export const CODES = mw.CODES;
export const authError = mw.authError;
export const resolveIssuer = mw.resolveIssuer;
export const resolveCookieName = mw.resolveCookieName;
export const cookieName = mw.cookieName;
export const ISSUER_DEFAULT = mw.ISSUER_DEFAULT;
export const ACCESS_COOKIE_BASE = mw.ACCESS_COOKIE_BASE;
export default mw;
