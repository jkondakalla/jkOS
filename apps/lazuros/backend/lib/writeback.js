'use strict';
// writeback.js — delegated result write-back (Phase 6, G1).
//
// When the compute-node worker reports a DONE result for a write-capable capability,
// the STATE NODE (not the worker) commits it into the target app AS the acting user,
// using weaveServerClient's on-behalf-of path. Keeping this here — rather than the
// spec's "worker mints a token" — means the delegation secret (JKOS_SERVICE_CLIENT_*)
// lives only on the State node, never distributed to every compute node, and reuses
// the audited weaveServerClient delegation path instead of reimplementing it in Python.
//
// Requires jkAuth enrollment (Phase 6): the `lazuros` service client in
// JKOS_DELEGATION_CLIENTS and holding the target app's write scope (beigeboard:write).
//
// review-first: parse-document is intentionally NOT here — its result is stored on the
// job for human review, never auto-written. query/widget-generate also don't write back.
const { weaveServerClient, IDEMPOTENCY_FIELD } = require('@jkos/weave/server');

// WV-6: the target is named by APP + CAPABILITY ID, and the PATH is resolved
// from that peer's served capability doc at call time.
//
// ⚠️ It used to hardcode `path: '/import'` beside the app. Which app a result
// belongs in is a genuine routing decision and stays here; the path is not — it
// is BeigeBoard's to declare, and a hardcoded copy is a second source that goes
// stale the moment the route moves, failing as a 404 inside a background job
// rather than anywhere a person is looking. Resolving it is the whole point of a
// capability doc: this file now consumes the declaration instead of duplicating
// what it says.
//
// `fallbackPath` is what the path was before, kept for one specific case: the
// peer being unreachable when a job completes. Losing a completed result because
// the doc fetch failed would be a worse outcome than writing to the path that has
// been correct for the life of the app — and a mismatch surfaces as a 404 the
// caller already handles.
const WRITEBACK = {
  'parse-task':     { app: 'beigeboard', capability: 'importItems', fallbackPath: '/import' },
  'breakdown-goal': { app: 'beigeboard', capability: 'importItems', fallbackPath: '/import' },
};

/** The peer's declared path for a capability id, or null if it cannot be read.
 *  Cached per app for the process: a capability doc changes on deploy, and this
 *  runs once per completed job. */
const _pathCache = new Map();
async function declaredPath(client, app, capabilityId) {
  const key = `${app}:${capabilityId}`;
  if (_pathCache.has(key)) return _pathCache.get(key);
  let path = null;
  try {
    const r = await client.get('/capabilities');
    const caps = r?.data?.capabilities || r?.capabilities || [];
    path = caps.find((c) => c.id === capabilityId)?.path || null;
  } catch {
    path = null;   // unreachable peer — the caller falls back
  }
  _pathCache.set(key, path);
  return path;
}

// The worker returns { response, model }; `response` is the model text, which — given
// the capability's prompt (prompts.json) — is a JSON document in the target's import
// shape. Parse it here; a non-JSON response is a prompt/model fault, surfaced as such.
function parseImportDoc(result) {
  if (result && typeof result === 'object' && !('response' in result)) return result; // already structured
  const raw = result && typeof result === 'object' ? result.response : result;
  if (typeof raw !== 'string') throw new Error('writeback: result has no parseable document');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('writeback: model response was not valid JSON');
  }
}

/* ⭐ THE WRITE-BACK'S IDEMPOTENCY KEY (RESET A2c.4) — derived from the JOB, never random.
 *
 * ⚠️ A job can legitimately finish TWICE. The reaper (queue.js requeueStaleJobs) hands a
 * job that has been IN_PROGRESS past its timeout back to the queue, and a slow inference
 * does not know it was reaped: the first worker finishes, a second worker finishes, and
 * both post DONE. Each DONE ran this function, and each imported the whole tree into
 * BeigeBoard — a parsed task twice, a broken-down goal's milestones twice — with two
 * 201s and nothing anywhere to say so.
 *
 * The job id is the identity of "this result", so it is the key: every write-back of one
 * job is recognisably the same write, and BeigeBoard's import door replays the first.
 * A random key would satisfy "has a key" and defeat the mechanism entirely. */
const writebackKey = (job) => `lazuros:writeback:${job.id}`;

/** The document with the key on it. A bare array is the import's list form, which has no
 *  top level to carry a field, so it is wrapped into the `{ items }` form it already means.
 *  Anything else that is not an object goes as-is: the peer rejects it, and a key on a
 *  write that cannot succeed protects nothing. */
function withWritebackKey(doc, job) {
  if (Array.isArray(doc)) return { items: doc, [IDEMPOTENCY_FIELD]: writebackKey(job) };
  if (doc && typeof doc === 'object') return { ...doc, [IDEMPOTENCY_FIELD]: writebackKey(job) };
  return doc;
}

// Returns { skipped } for non-write capabilities, else { written, app, status }.
// Throws only on an actual write failure (caller decides whether that fails the job).
async function runWriteback(job, result, { makeClient = weaveServerClient } = {}) {
  const target = WRITEBACK[job.capability];
  if (!target) return { skipped: true };
  if (!job.user_id) throw new Error('writeback: job has no user_id to act as');

  if (job.id == null) throw new Error('writeback: job has no id to derive an idempotency key from');

  /* The key OVERWRITES anything the model put there. The model's text chooses what is
     written; it must never choose which earlier write this one is "the same as". */
  const doc = withWritebackKey(parseImportDoc(result), job);
  /* ⚠️ The ZONE goes with the acting user, or the peer answers in UTC for a user who
     is not in UTC. BeigeBoard's import mints routine occurrences relative to
     `callerDay(req)`, and BB-1 opened that reconcile to service callers — so without
     this, a write-back east of Greenwich between local and UTC midnight lands the
     user's occurrence on the wrong day. `job.acting_zone` is the zone of the request
     that asked for the work; null falls back to UTC exactly as before. */
  const client = makeClient(target.app, { actingUser: job.user_id, actingZone: job.acting_zone });
  const path = (await declaredPath(client, target.app, target.capability)) || target.fallbackPath;
  const r = await client.post(path, doc);
  if (!r.ok) throw new Error(`writeback to ${target.app}${path} failed: ${r.error || r.status}`);
  return { written: true, app: target.app, status: r.status };
}

module.exports = { runWriteback, parseImportDoc, writebackKey, WRITEBACK };
