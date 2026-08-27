'use strict';
// routes/library.js — the `rescanLibrary` capability route (git history: item 18.2). Mirrors
// papyros's src/routes/library.js verbatim — see that file's header for the full
// admin-gate rationale: role-based (`req.user.role === 'admin'`), not a raw
// `kouros:admin` scope-array lookup, so weaveAuth's documented dev fallback (no
// JKOS_AUTH_PUBLIC_KEY/JWKS_URI configured) still passes locally, and it matches the
// suite's existing admin-gate precedent (apps/lazuros/backend/routes/jobs.js).

const { Router } = require('express');
const { CODES, authError } = require('@jkos/auth-middleware');

/**
 * @param {{ scanLibrary: () => Promise<{scanned:number, upserted:number, removed:number, skipped:number}> }} deps
 */
function createLibraryRouter({ scanLibrary }) {
  const router = Router();

  router.post('/api/library/rescan', async (req, res) => {
    if (req.user?.role !== 'admin') {
      return authError(res, 403, CODES.INSUFFICIENT_SCOPE, 'Insufficient scope', { required: ['kouros:admin'] });
    }
    try {
      const counts = await scanLibrary();
      res.json(counts);
    } catch (err) {
      console.error(`[kouros] rescanLibrary failed: ${err.message}`);
      res.status(500).json({ error: 'Scan failed', message: err.message });
    }
  });

  return router;
}

module.exports = { createLibraryRouter };
