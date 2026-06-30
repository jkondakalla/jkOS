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

/** This app's one polled resource: the async inference job queue. */
const JOBS_KEY = resourceKey('lazuros', 'jobs'); // 'lazuros.jobs'

/* ── What can be DONE to LazurOS (the write contract) ────────────────────────── */
const CAPABILITIES_DOC = {
  app: 'lazuros',
  version: 1,
  capabilities: [
    {
      id: 'parse-task', label: 'Parse task from text',
      description: 'Parse free-form text into a structured BeigeBoard task.',
      method: 'POST', path: '/api/lazuros/parse-task', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      fields: [
        { id: 'text', type: 'string', label: 'Free text', required: true },
        { id: 'user_id', type: 'string', label: 'Acting user (sub)', required: true },
      ],
      returns: { job_id: 'string' }, invalidates: [JOBS_KEY],
    },
    {
      id: 'breakdown-goal', label: 'Break goal into milestones',
      description: 'Parse a goal description and return a milestone list for BeigeBoard.',
      method: 'POST', path: '/api/lazuros/breakdown-goal', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      fields: [
        { id: 'goal_text', type: 'string', label: 'Goal description', required: true },
        { id: 'user_id', type: 'string', label: 'Acting user (sub)', required: true },
      ],
      returns: { job_id: 'string' }, invalidates: [JOBS_KEY],
    },
    {
      id: 'parse-document', label: 'Parse document into tasks',
      description: 'Extract tasks/goals from document text. Returns job_id; result requires review before BeigeBoard write.',
      method: 'POST', path: '/api/lazuros/parse-document', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      fields: [
        { id: 'content', type: 'string', label: 'Document text', required: true },
        { id: 'user_id', type: 'string', label: 'Acting user (sub)', required: true },
      ],
      returns: { job_id: 'string' }, invalidates: [JOBS_KEY],
    },
    {
      id: 'widget-generate', label: 'Generate widget spec from description',
      description: 'Produce a WidgetSpec JSON from a natural language description.',
      method: 'POST', path: '/api/lazuros/widget-generate', scope: 'lazuros:write',
      requestShape: 'structured', targetTier: 'highest',
      fields: [
        { id: 'description', type: 'string', label: 'Widget description', required: true },
        { id: 'user_id', type: 'string', label: 'Acting user (sub)', required: true },
      ],
      returns: { job_id: 'string' }, invalidates: [JOBS_KEY],
    },
    {
      id: 'query', label: 'Open-ended assistant query',
      description: 'Voice or text query of unknown intent. Enters at the lowest configured tier and escalates per the tier registry.',
      method: 'POST', path: '/api/lazuros/query', scope: 'lazuros:write',
      requestShape: 'open-ended', targetTier: 'lowest',
      fields: [
        { id: 'text', type: 'string', label: 'Query text (or transcript)', required: false },
        { id: 'audio_b64', type: 'string', label: 'Base64 audio (alternative to text)', required: false },
        { id: 'user_id', type: 'string', label: 'Acting user (sub)', required: true },
      ],
      returns: { job_id: 'string' }, invalidates: [JOBS_KEY],
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
      { id: 'job_id', column: 'id', op: 'eq', type: 'string' },
      { id: 'status', column: 'status', op: 'eq', type: 'string' },
      { id: 'user_id', column: 'user_id', op: 'eq', type: 'string' },
    ],
  }],
};

module.exports = { CAPABILITIES_DOC, DATASETS_DOC, JOBS_KEY };
