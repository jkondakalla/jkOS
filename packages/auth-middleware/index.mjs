// ESM entry — re-exports the CJS implementation so ESM backends (type: module)
// can `import { jkosAuth, verifyToken } from '@jkos/auth-middleware'`.
import mw from './index.js';

export const jkosAuth = mw.jkosAuth;
export const verifyToken = mw.verifyToken;
export default mw;
