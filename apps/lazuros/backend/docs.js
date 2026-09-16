'use strict';
// docs.js — LazurOS's Weave discovery declarations, as importable DATA.
//
// What can be DONE to LazurOS (CAPABILITIES_DOC, the write contract) and what can be
// READ from it (DATASETS_DOC, the read contract), declared once as pure data so the
// server can serve them AND any tool — the suite-prober, a workshop GUI, the ORDECK
// widget composer — can require() them without parsing server.js. serveCapabilities/
// serveDatasets validate the envelope shape at boot (@jkos/weave/src/shared/docShape).
//
// The invalidation bus key is DERIVED from the app id via resourceKey (A5), not a
// free-typed 'lazuros.jobs' repeated on each capability + the dataset — so the
// capability and dataset can't disagree on which resource a job mutation bumps.
//
// `targetTier: 'highest' | 'lowest'` (not a literal tier number): a capability doc
// must not hardcode how many tiers a deployment has. The route handler resolves these
// against the loaded tier registry at request time (see composability mandate).

const { resourceKey } = require('@jkos/suite-manifest');
const { defineActivity, canonicalTime, extRef, idempotencyBodyField } = require('@jkos/weave/activity'); // D6: the activity contract (lean subpath — this file is imported as DATA by the prober)

/** This app's one polled resource: the async inference job queue. */
const JOBS_KEY = resourceKey('lazuros', 'jobs'); // 'lazuros.jobs'

/* Every capability ANSWERS with the same async-job handle: the queue row id a caller
   polls the `jobs` dataset for. Declared once (like BB's ITEM_SHAPE) so the five
   capabilities provably share one output stud.
 *
 * ⚠️ THIS IS `returns`, NOT THE RESULT (WV-5). It is what the HTTP call hands back
 * immediately, and it is useless for composition: a binding engine reading it sees a
 * `string` where the real answer lives and will cheerfully type-check a job UUID into
 * a task title. No error, no warning — just a task called `a3f1c8e2-…`. What the WORK
 * produces is declared separately, per capability, as `resolves`. */
const JOB_HANDLE = [{ name: 'job_id', type: 'string' }];

/* ⭐ THE RESERVED IDEMPOTENCY FIELD (RESET A2c.4), on every capability — each one
   ENQUEUES WORK, and a retried trigger DO must not run the model twice. A repeated key
   answers with the first job's handle (routes/capability.js). Never a prompt input:
   the handler strips it before the payload is stored, so no `prompts.json` template may
   reference it. */
const IDEMPOTENCY = idempotencyBodyField();

/* ⭐ WHAT THE WORK PRODUCES (WV-5). The presence of `resolves` IS the declaration
   that a capability is asynchronous — there is deliberately no separate `async: true`,
   because two fields that must agree are two fields that can disagree.
 *
 * Three of the five produce an IMPORT DOCUMENT: the worker's model text is, given
 * that capability's prompt, a JSON document in BeigeBoard's `importItems` body shape,
 * and lib/writeback.js parses it as exactly that. So the stud these capabilities
 * actually offer a binder is `items`/`defaults` — which is what makes
 * `parse-task → importItems` a composable pair instead of a hand-wired special case
 * (the WV-6 branch that literal used to be). */
const IMPORT_DOC = [
  /* `schema` names WHERE the shape lives (D3's remainder): these are literally
     BeigeBoard's `items` rows, which is what makes parse-task → importItems a
     composable pair rather than a hand-wired special case. */
  { name: 'items',    type: 'json', label: 'Items — a nested tree or a flat ref/parent list', schema: 'beigeboard.items' },
  { name: 'defaults', type: 'json', label: 'Field defaults applied to every item', schema: 'beigeboard.items' },
];

/* ── What can be DONE to LazurOS (the write contract) ─────────────────────────
   Canonical Layer-A dialect: `body`/`returns` are arrays of {name,type,…} fields —
   the same spelling BeigeBoard declares and the ORDECK Widget Workshop renders
   forms from (it reads `cap.body[].name`), so LazurOS capabilities are workshop-
   authorable like any other app's. `user_id` is deliberately NOT a body field:
   the handler takes the acting user from the verified token (delegation `act`
   claim or session sub), never from the request body. */
const CAPABILITIES_DOC = {
  app: 'lazuros',
  version: 1,
  capabilities: [
    {
      id: 'parse-task', label: 'Parse task from text',
      description: 'Parse free-form text into a structured BeigeBoard task.',
      method: 'POST', path: '/api/lazuros/parse-task', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      body: [
        { name: 'text', type: 'string', label: 'Free text', required: true },
        IDEMPOTENCY,
      ],
      returns: JOB_HANDLE, resolves: IMPORT_DOC, invalidates: [JOBS_KEY],
    },
    {
      id: 'breakdown-goal', label: 'Break goal into milestones',
      description: 'Parse a goal description and return a milestone list for BeigeBoard.',
      method: 'POST', path: '/api/lazuros/breakdown-goal', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      body: [
        { name: 'goal_text', type: 'string', label: 'Goal description', required: true },
        IDEMPOTENCY,
      ],
      returns: JOB_HANDLE, resolves: IMPORT_DOC, invalidates: [JOBS_KEY],
    },
    {
      id: 'parse-document', label: 'Parse document into tasks',
      description: 'Extract tasks/goals from document text. Returns job_id; result requires review before BeigeBoard write.',
      method: 'POST', path: '/api/lazuros/parse-document', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      body: [
        { name: 'content', type: 'string', label: 'Document text', required: true },
        IDEMPOTENCY,
      ],
      returns: JOB_HANDLE, resolves: IMPORT_DOC, invalidates: [JOBS_KEY],
    },
    {
      id: 'widget-generate', label: 'Generate widget spec from description',
      description: 'Produce a WidgetSpec JSON from a natural language description.',
      method: 'POST', path: '/api/lazuros/widget-generate', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      body: [
        { name: 'description', type: 'string', label: 'Widget description', required: true },
        IDEMPOTENCY,
      ],
      returns: JOB_HANDLE,
      resolves: [{ name: 'spec', type: 'json', label: 'A WidgetSpec document', schema: 'Documentation/ARCHITECTURE.md' }],
      invalidates: [JOBS_KEY],
    },
    {
      id: 'query', label: 'Open-ended assistant query',
      description: 'Voice or text query of unknown intent. Enters at the lowest configured tier and escalates per the tier registry.',
      method: 'POST', path: '/api/lazuros/query', scope: 'lazuros:write',
      requestShape: 'open-ended', targetTier: 'lowest',
      body: [
        { name: 'text', type: 'string', label: 'Query text (or transcript)' },
        { name: 'audio_b64', type: 'string', label: 'Base64 audio (alternative to text)' },
        IDEMPOTENCY,
      ],
      returns: JOB_HANDLE,
      /* Open-ended: the answer is prose, and saying so is the point — a binder can
         wire it into a notes field and must not be offered it as a title. */
      resolves: [{ name: 'response', type: 'text', label: 'The assistant\'s answer' }],
      invalidates: [JOBS_KEY],
    },
  ],
};

/* ── What can be READ from LazurOS (the read contract) ───────────────────────── */
const DATASETS_DOC = {
  app: 'lazuros', version: 1,
  datasets: [{
    id: 'jobs', label: 'AI Jobs', description: 'Async inference job queue.',
    path: '/api/lazuros/jobs', invalidates: [JOBS_KEY],
    filters: [
      { name: 'job_id', column: 'id', op: 'eq', type: 'string' },
      { name: 'status', column: 'status', op: 'eq', type: 'string' },
      { name: 'user_id', column: 'user_id', op: 'eq', type: 'string' },
      { name: 'capability', type: 'string', label: 'Capability (exact)', column: 'capability', op: 'eq' },
      { name: 'since', type: 'string', label: 'Updated since (updated_at delta cursor)', column: 'updated_at', op: 'gt' },
    ],
  }],
};

/* ── D6 / XC-2: the ACTIVITY contract ─────────────────────────────────────────────
   ⚠️ LazurOS's per-user record of what happened is a WORK QUEUE that happens to
   remember — `jobs`, whose reason to exist is dispatching inference, not logging.
   The other three ledgers in the suite are a play-history table (twice) and two
   columns on an items row. Four honest schemas answering four different local needs,
   which is why XC-2's answer is one declared SHAPE and not one shared table: forcing
   a queue into a common ledger would mean either a second write on every dispatch or
   a queue that has to survive a suite-wide migration to change its own columns.

   This is also the half of XC-2 that matters most for §1's action-audit trail. "What
   did the user ask the AI to do, and did it work" is precisely the question an audit
   asks, and until now it could only be answered by reading LazurOS's private queue.

   ONE kind, not one per capability: `capability` is data (it varies per deployment
   and grows with the tier registry), and a `kinds` list is a closed vocabulary a
   consumer renders a filter from. The capability name rides in `label`.

   `completed` uses all three states honestly — DONE true, FAILED false, and a job
   still queued or running null, because at read time its outcome is genuinely not
   yet known. */
const ACTIVITY = defineActivity({
  app: 'lazuros',
  kinds: [{ id: 'ai_job', label: 'Asked LazurOS', verb: 'asked LazurOS to run' }],
  read(db, userId, { since, until, limit }) {
    const where = ['user_id = ?'];
    const params = [String(userId)];
    if (since) { where.push('created_at > ?'); params.push(since); }
    if (until) { where.push('created_at < ?'); params.push(until); }
    const rows = db
      .prepare(
        `SELECT id, capability, status, created_at
           FROM jobs
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(...params, limit);
    return rows.map((r) => ({
      id: `jobs:${r.id}`,
      kind: 'ai_job',
      at: canonicalTime(r.created_at),
      ref: extRef('lazuros', r.id),
      label: r.capability || null,
      /* Null, not `updated_at - created_at`. That difference is the round trip the
         user WAITED, most of which can be queue time, whereas `ms` means time
         actually spent on the act in every other app that reports it. One field, one
         meaning across four apps, is the entire value of having a contract. */
      ms: null,
      completed: r.status === 'DONE' ? true : r.status === 'FAILED' ? false : null,
    }));
  },
});

module.exports = { CAPABILITIES_DOC, DATASETS_DOC, JOBS_KEY, ACTIVITY };
