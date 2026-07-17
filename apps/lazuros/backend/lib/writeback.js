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

const WRITEBACK = {
  'parse-task':     { app: 'beigeboard', path: '/import' },
  'breakdown-goal': { app: 'beigeboard', path: '/import' },
};

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
  const r = await client.post(target.path, doc);
  if (!r.ok) throw new Error(`writeback to ${target.app}${target.path} failed: ${r.error || r.status}`);
  return { written: true, app: target.app, status: r.status };
}

module.exports = { runWriteback, parseImportDoc, WRITEBACK };
