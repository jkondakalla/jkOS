/**
 * weave/dataset.ts — the READ contract (the mirror of capability.ts).
 *
 * Where a CapabilityDoc declares what can be DONE to an app (writes), a DatasetDoc
 * declares what can be READ from it: the collections it exposes, the filters it
 * honours, and the shape of a row. Served by the app at its `datasetsPath`
 * (GET /api/<app>/datasets) — app-owned data, the read-side twin of
 * `app_registry` + capabilities. So a peer (or the portal, or an AI step)
 * discovers what it may read with zero per-pair code, exactly as it discovers
 * what it may write.
 *
 * Pure data shapes. Filter/row fields reuse the write contract's BodyField so the
 * two halves share one field vocabulary.
 */

import type { BodyField } from './capability';
import type { Cardinality } from './shared/datasetShape.js';
export { CARDINALITIES, cardinalityOf, checkDatasetAnswer, type Cardinality } from './shared/datasetShape.js';
export { JOB_HANDLE, JOB_DONE, JOB_FAILED, JOB_FIELDS, jobPhase, checkJobsDataset, type JobPhase } from './shared/jobs.js';

/** How a filter value is matched against its column. Mirrors the server-side
 *  `buildItemFilters` operators (@jkos/weave/server/filters) one-to-one. */
export type FilterOp =
  | 'eq'      // column = value
  | 'gt'      // column > value (deltas, e.g. ?since= over updated_at)
  | 'prefix'  // column LIKE value%  (an app's own ext_ref namespace)
  | 'tags';   // JSON-array membership, one clause per CSV tag

/**
 * One query param a dataset's list endpoint honours. Extends BodyField (the public,
 * GUI/AI-facing shape: name/type/label/enum) with the ENFORCEMENT mapping (column/op)
 * so the filter a dataset DECLARES and the SQL the server actually runs are ONE
 * source — they cannot drift (the server's `filterSpec()` projects these into the
 * spec `buildItemFilters` enforces). `column` defaults to `name`, `op` to 'eq'.
 */
export interface FilterField extends BodyField {
  column?: string;           // DB column this param filters (defaults to `name`)
  op?: FilterOp;             // how the value is matched (defaults to 'eq')
}

/** One readable collection an app exposes. */
export interface DatasetDef {
  id: string;                // stable within the app, e.g. 'items'
  label: string;             // 'Tasks & events'
  path: string;              // RELATIVE to the app's apiBase: '/items'
  /** What one GET answers. 'many' (the default): a bare JSON array of rows, each shaped
   *  like `item` — the list contract (weaveClient.list reads a non-array as NO rows).
   *  'one': a single JSON document (a session, a stats block, one book in full), whose
   *  top-level fields `item` describes. A list with metadata beside it ({ basis,
   *  results }) is a document: declare it 'one' and its list as a `json` field with a
   *  `schema`. Each app's smoke holds its real answers to this (shared/datasetShape.js). */
  cardinality?: Cardinality;
  /** 'jobs': this dataset reads an app's asynchronous work in the common declared shape
   *  (shared/jobs.js) — a `job_id` filter that finds the job an async capability's handle
   *  names, rows carrying id/status/result/error, and DONE/FAILED as the only ends. An
   *  app with an async capability declares exactly one (the async-contract probe). */
  shape?: 'jobs';
  filters?: FilterField[];   // query params the list endpoint honours (kind, since, …),
                             // carrying their own enforcement mapping (column/op)
  item?: BodyField[];        // the fields of one row ('many') or of the document ('one')
  scopes?: string[];         // fine read gate, if the collection is scoped
  invalidates?: string[];    // the resource key writers bump (e.g. 'beigeboard.items') so a
                             // reader can subscribe its poll to live writes
}

// The bridge that projects these `filters` into the `{param,column,op}` spec the
// server's list endpoint enforces lives ONCE, server-side, as `filterSpec()` in
// @jkos/weave/server (it's a backend concern, co-located with `buildItemFilters`
// which consumes it). The dataset declaration is authoritative; the enforced SQL
// filter derives from it (P3), so declared-readable == actually-filtered.

/** What an app returns from its datasetsPath. */
export interface DatasetDoc {
  app: string;               // must match the manifest id
  version: number;           // bump on breaking shape changes
  datasets: DatasetDef[];
}
