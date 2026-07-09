'use strict';
// routes/library.js — the `rescanLibrary` capability route (task 2.3). Admin-scoped:
// the capability doc declares `scopes: ['papyros:admin']` (jkAuth mints that scope for
// every admin on a reachable app — apps/jkauth/src/db.js roleClaims), but this route
// enforces the EQUIVALENT req.user.role === 'admin' check rather than a raw scope-array
// lookup. Two reasons, both about staying consistent with the rest of the suite:
//   1. weaveAuth's documented dev fallback (no JKOS_AUTH_PUBLIC_KEY/JWKS_URI configured
//      — see apps/papyros/.env.example) injects { sub, role: 'admin' } with NO scope
//      array. A bare requireScope('papyros:admin') would 403 that stub even though it
//      IS the admin identity, breaking local/dev use of this route.
//   2. It's the suite's existing admin-gate precedent — apps/lazuros/backend/routes/
//      jobs.js and apps/sylibos/backend both gate on req.user.role, not a scope array.
// role and scope agree for every REAL token (jkAuth grants papyros:admin exactly when
// role === 'admin'), so this is the same check, just resilient to the dev stub.

const { Router } = require('express');
const { CODES, authError } = require('@jkos/auth-middleware');

/**
 * @param {{ scanLibrary: () => Promise<{scanned:number, upserted:number, removed:number, skipped:number}> }} deps
 */
function createLibraryRouter({ scanLibrary }) {
  const router = Router();

  router.post('/api/library/rescan', async (req, res) => {
    if (req.user?.role !== 'admin') {
      return authError(res, 403, CODES.INSUFFICIENT_SCOPE, 'Insufficient scope', { required: ['papyros:admin'] });
    }
    try {
      const counts = await scanLibrary();
      res.json(counts);
    } catch (err) {
      console.error(`[papyros] rescanLibrary failed: ${err.message}`);
      res.status(500).json({ error: 'Scan failed', message: err.message });
    }
  });

  return router;
}

module.exports = { createLibraryRouter };
