'use strict';
// capability.js — the one handler that serves EVERY capability. Which tier a request
// routes to is data (the capability's `targetTier` resolved against the deployment's
// tier registry), not a branch; which backend serves that tier is data
// (tier.computeBackend → providers.computeBackends[...]); whether to wake it is the
// ComputeBackend.probe()/wake() contract, never a hardcoded "ping Emily". Adding a
// sixth capability to docs.js reuses this handler unchanged.

const db = require('../db');
const { createJob, setJobStatus } = require('../lib/queue');
const {
  callerZone,                                            // D5: WHERE the caller is
  withIdempotency, idempotencyKeyOf, idempotencyKeyError, IDEMPOTENCY_FIELD,  // A2c.4: dedup at the write door
} = require('@jkos/weave/server');

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
    // req.user.sub is a real human (or a delegated acting user, G1). The capability
    // doc deliberately declares NO user_id body field (the workshop shouldn't render
    // an input the server discards); a stray body user_id is still stripped here.
    if (req.user?.sub == null) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const user_id = String(req.user.sub);
    // A key that is present but cannot be honoured is refused before any work is queued.
    const keyErr = idempotencyKeyError(req.body);
    if (keyErr) return res.status(400).json({ error: keyErr, code: 'VALIDATION' });
    /* The idempotency key is a property of the REQUEST, not of the work, so it never
       reaches the payload: the worker renders `template.format(**payload)`, and a job
       row carrying the key would make two otherwise-identical jobs look different. */
    const { user_id: _ignoredBodyUser, [IDEMPOTENCY_FIELD]: _key, ...payload } = req.body || {};

    const tier = resolveTier(capDef.targetTier, deploymentCfg.tiers);
    if (!tier) return res.status(500).json({ error: `no tier resolves "${capDef.targetTier}"` });

    const backend = providers.computeBackends[tier.computeBackend];
    if (!backend) return res.status(500).json({ error: `tier ${tier.id} references unknown computeBackend "${tier.computeBackend}"` });

    /* ⭐ DEDUP AT THE WRITE DOOR (WEAVE.md §3.4). Every capability here enqueues work,
       and work here is expensive and WRITES: a retried trigger DO that enqueued twice
       ran the model twice and — for parse-task and breakdown-goal — imported the result
       into BeigeBoard twice. A repeated key now hands back the FIRST job's handle.
       Scoped per capability and per user; see @jkos/weave/server's idempotency.js for
       why the user is in the key. The zone travels with the job (D5) — this is the one
       moment a browser is on the other end; the write-back is a service call. */
    const enq = withIdempotency(db, {
      scope: `lazuros.${capDef.id}`,
      userId: user_id,
      key: idempotencyKeyOf(req.body),
      write: () => ({
        status: 202,
        body: {
          job_id: createJob({
            user_id, capability: capDef.id, payload, tier_id: tier.id,
            acting_zone: callerZone(req),
          }),
        },
      }),
    });
    /* A replay neither probes nor wakes. The first attempt already did both, and the
       job it created is whatever state it has reached since — possibly DONE. Marking
       it PENDING_WAKEUP now would pull a finished job back into the claimable set. */
    if (enq.replayed) {
      res.set('Idempotent-Replay', 'true');
      return res.status(enq.status).json(enq.body);
    }
    const jobId = enq.body.job_id;

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
