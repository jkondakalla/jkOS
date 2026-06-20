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

/** One readable collection an app exposes. */
export interface DatasetDef {
  id: string;                // stable within the app, e.g. 'items'
  label: string;             // 'Tasks & events'
  path: string;              // RELATIVE to the app's apiBase: '/items'
  filters?: BodyField[];     // query params the list endpoint honours (kind, since, …)
  item?: BodyField[];        // shape hint for one returned row (drives readers/AI)
  scopes?: string[];         // fine read gate, if the collection is scoped
  invalidates?: string[];    // the resource key writers bump (e.g. 'bb.items') so a
                             // reader can subscribe its poll to live writes
}

/** What an app returns from its datasetsPath. */
export interface DatasetDoc {
  app: string;               // must match the manifest id
  version: number;           // bump on breaking shape changes
  datasets: DatasetDef[];
}
