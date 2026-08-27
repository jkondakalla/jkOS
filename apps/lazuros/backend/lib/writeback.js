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
const { weaveServerClient } = require('@jkos/weave/server');

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

// Returns { skipped } for non-write capabilities, else { written, app, status }.
// Throws only on an actual write failure (caller decides whether that fails the job).
async function runWriteback(job, result, { makeClient = weaveServerClient } = {}) {
  const target = WRITEBACK[job.capability];
  if (!target) return { skipped: true };
  if (!job.user_id) throw new Error('writeback: job has no user_id to act as');

  const doc = parseImportDoc(result);
  const client = makeClient(target.app, { actingUser: job.user_id });
  const path = (await declaredPath(client, target.app, target.capability)) || target.fallbackPath;
  const r = await client.post(path, doc);
  if (!r.ok) throw new Error(`writeback to ${target.app}${path} failed: ${r.error || r.status}`);
  return { written: true, app: target.app, status: r.status };
}

module.exports = { runWriteback, parseImportDoc, WRITEBACK };
