// jobs.js — the common declared shape of ASYNCHRONOUS WORK (WEAVE.md §3.1's other half).
//
// An async capability declares `returns: [{ name: 'job_id' }]` (the handle the call
// answers with) and `resolves` (what the work eventually produces). That said WHAT the
// result is and nothing about WHERE to read it: a caller holding a job_id had to know,
// from LazurOS's source, that GET /jobs?job_id=… answers a row whose `result` holds it.
// A widget's form, a trigger and an AI composer each need the same three facts — how
// to look the job up, when it is finished, and where its result is — so they are
// declared once, here, as a SHAPE an app's dataset answers in. Not a shared table: the
// app keeps its own queue and says `shape: 'jobs'` on the dataset that reads it.
//
// A jobs dataset:
//   • is a list (cardinality 'many') with a `job_id` filter that selects one job by
//     the handle an async capability returned;
//   • answers rows carrying `id`, `status`, `result` and `error`;
//   • finishes in exactly one of two states — DONE (its `result` holds the fields its
//     capability's `resolves` declares) or FAILED (its `error` says why). Every other
//     status means "not yet", whatever the app calls its intermediate states.
//
// Pure ESM, like docShape.js and datasetShape.js, so the prober, the renderer and a
// backend (require(ESM)) share it.

/** The one filter that looks a job up by the handle a capability returned. */
export const JOB_HANDLE = 'job_id'

/** The two terminal statuses. */
export const JOB_DONE = 'DONE'
export const JOB_FAILED = 'FAILED'

/** The fields every jobs row carries, and their types. */
export const JOB_FIELDS = [
  { name: 'id', type: 'string' },
  { name: 'status', type: 'enum' },
  { name: 'result', type: 'json' },
  { name: 'error', type: 'string' },
]

/** Where a job stands: 'done' | 'failed' | 'pending'. */
export function jobPhase(row) {
  const s = row && row.status
  return s === JOB_DONE ? 'done' : s === JOB_FAILED ? 'failed' : 'pending'
}

/**
 * Problems with a dataset declaring `shape: 'jobs'`; [] when it is one.
 * @param {{ id: string, shape?: string, cardinality?: string, item?: object[], filters?: object[] }} def
 * @returns {string[]}
 */
export function checkJobsDataset(def) {
  const out = []
  const at = `'${def && def.id}'`
  if (!def || def.shape !== 'jobs') return [`${at} does not declare shape: 'jobs'`]
  if (def.cardinality && def.cardinality !== 'many') out.push(`${at} is a jobs dataset and must be a list (cardinality 'many')`)
  const item = Array.isArray(def.item) ? def.item : []
  for (const want of JOB_FIELDS) {
    const f = item.find((x) => x.name === want.name)
    if (!f) out.push(`${at} is a jobs dataset and declares no '${want.name}' field`)
    else if (f.type !== want.type && !(want.type === 'string' && f.type === 'text')) out.push(`${at}.${want.name} must be '${want.type}' (declared '${f.type}')`)
  }
  const status = item.find((x) => x.name === 'status')
  if (status && status.type === 'enum') {
    for (const s of [JOB_DONE, JOB_FAILED]) {
      if (!Array.isArray(status.enum) || !status.enum.includes(s)) out.push(`${at}.status must include '${s}' — the terminal states are common to every jobs dataset`)
    }
  }
  const handle = (def.filters || []).find((f) => f.name === JOB_HANDLE)
  if (!handle) out.push(`${at} is a jobs dataset and declares no '${JOB_HANDLE}' filter — nothing can look a job up by its handle`)
  else if ((handle.op && handle.op !== 'eq') || (handle.column && handle.column !== 'id')) {
    out.push(`${at}'s '${JOB_HANDLE}' filter must match the row id exactly (op 'eq' over 'id')`)
  }
  return out
}
