'use strict';
// capability.js — the one handler that serves EVERY capability. Which tier a request
// routes to is data (the capability's `targetTier` resolved against the deployment's
// tier registry), not a branch; which backend serves that tier is data
// (tier.computeBackend → providers.computeBackends[...]); whether to wake it is the
// ComputeBackend.probe()/wake() contract, never a hardcoded "ping Emily". Adding a
// sixth capability to docs.js reuses this handler unchanged.

const { createJob, setJobStatus } = require('../lib/queue');

/** Resolve a capability's declared targetTier against the loaded tier registry.
 *  'highest'/'lowest' keep capability docs deployment-agnostic (a doc must not know
 *  how many tiers exist); a numeric id targets a specific tier. */
function resolveTier(targetTier, tiers) {
  if (targetTier === 'highest') return tiers[tiers.length - 1];
  if (targetTier === 'lowest') return tiers[0];
  return tiers.find((t) => t.id === targetTier);
}

function makeHandler(capDef) {
  return async (req, res) => {
    const { providers, deploymentCfg } = req.app.locals;

    // Owner is the AUTHENTICATED identity, never a body field — a client must not be
    // able to enqueue work as another user. weaveAuth + weaveWriteGate already ran, so
    // req.user.sub is a real human (or a delegated acting user, G1). The doc's
    // `user_id` field stays as declared context; the rest of the body is the payload.
    if (req.user?.sub == null) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const user_id = String(req.user.sub);
    const { user_id: _ignoredBodyUser, ...payload } = req.body || {};

    const tier = resolveTier(capDef.targetTier, deploymentCfg.tiers);
    if (!tier) return res.status(500).json({ error: `no tier resolves "${capDef.targetTier}"` });

    const backend = providers.computeBackends[tier.computeBackend];
    if (!backend) return res.status(500).json({ error: `tier ${tier.id} references unknown computeBackend "${tier.computeBackend}"` });

    const jobId = createJob({ user_id, capability: capDef.id, payload, tier_id: tier.id });

    // If the tier's backend is offline, mark the job PENDING_WAKEUP and best-effort
    // wake it (WoL for a wol-backend; a no-op for an always-on one). The worker picks
    // it up once the node answers. Wake failures don't fail the request — the job
    // stays queued.
    const online = await backend.probe();
    if (!online) {
      setJobStatus(jobId, 'PENDING_WAKEUP');
      try { await backend.wake(); }
      catch (e) { console.warn(`[lazuros] wake of backend "${tier.computeBackend}" failed: ${e.message}`); }
      console.log(`[lazuros] backend "${tier.computeBackend}" offline → job ${jobId} → PENDING_WAKEUP`);
    }

    res.status(202).json({ job_id: jobId });
  };
}

module.exports = { makeHandler, resolveTier };
