/**
 * weave/collection.ts — the COLLECTION primitive (Layer D / F3).
 *
 * The first "new brick": a user (via the Workshop GUI or by describing intent to an
 * AI) defines a data type once — a name and a list of typed fields — and the suite
 * derives EVERYTHING a hand-written app used to spell out by hand and keep in sync:
 *   • storage     — a SQLite table (+ the weave updated_at delta triggers),
 *   • writes      — typed create/update/delete CapabilityDef[] (Layer A),
 *   • reads       — a DatasetDef with the declared filters + row shape (Layer A),
 *   • the routes  — the Express CRUD wiring, scoped per user.
 * One spec, no drift: the table, the capabilities, the dataset, and the SQL all
 * derive from the SAME CollectionDef. Before this, every backend hand-rolled a
 * table + routes + a discovery doc that could silently disagree (the scaffolder's
 * `items` was three coupled copies); now they are one source.
 *
 * This file is the DESIGN-TIME shape (the source of truth a GUI/AI emits), the twin
 * of capability.ts / dataset.ts. The runtime factory that expands a CollectionDef
 * lives in ./server/collection.js (a zero-extra-dep CJS module so the offline
 * discovery doc AND the live backend both build from the one spec); its `.d.ts`
 * types `defineCollection`. Reuses the write contract's FieldType so a collection
 * field, a capability body field, and a dataset row field share one vocabulary.
 */

import type { FieldType, BodyField } from './capability';
import type { FilterOp, DatasetDef } from './dataset';
import type { CapabilityDef } from './capability';

/** One field of a user-defined collection — a column AND a typed stud. */
export interface CollectionField {
  name: string;            // column + wire key; ^[a-z][a-z0-9_]*$ (it is interpolated
                           // into SQL, so it is validated as an identifier, never user input)
  type: FieldType;         // the shared field vocabulary (string/text/number/boolean/…/ref)
  label?: string;          // human label for the workshop mapper
  required?: boolean;      // NOT NULL + required in the create body
  enum?: string[];         // when type === 'enum'
  ref?: string;            // when type === 'ref': the referenced dataset, '<app>.<dataset>'
                           // — the typed stud another lego (e.g. a trigger) snaps onto
  default?: unknown;       // literal column default
  max?: number;            // length cap surfaced to the body field (string/text)
  unique?: boolean;        // UNIQUE column
  list?: boolean;          // a JSON-array-of-strings column (the suite's `tags` shape):
                           // CSV/array in → JSON text stored → array out. Filter with op 'tags'.
  filter?: FilterOp | boolean;   // expose this field as a list-endpoint filter. true → 'eq';
                                 // give an op for ranges/prefix/tags. The dataset filter and
                                 // the enforced SQL derive from this ONE flag (no drift, P3).
  readOnly?: boolean;      // server-managed: not client-writable, omitted from create/update
                           // bodies, still present in the row shape (e.g. a derived column)
}

/** A user-defined collection: a typed table + its derived read/write contract. */
export interface CollectionDef {
  app: string;             // owning app id — namespaces the resource key + write scope
  id: string;              // collection id, the dataset id AND the table name, e.g. 'items'
  label: string;           // 'Tasks & events'
  fields: CollectionField[];
  scoped?: boolean;        // rows are owned per-user (default true): a user_id column +
                           // every route filters to req.user.sub. false → a shared table.
  noun?: string;           // capability noun, e.g. 'Item' → createItem/updateItem/deleteItem.
                           // Defaults to a singularised id (items → Item).
}

/** What `defineCollection(def)` resolves to: the derived Layer-A primitives (pure
 *  data, safe to import offline) plus the backend store half. The pure-data fields
 *  are what a discovery doc serves; `ddl`/`mount` are what the live backend wires. */
export interface Collection {
  app: string;
  id: string;
  key: string;                     // resourceKey(app, id), e.g. 'beigeboard.items'
  item: BodyField[];               // the row shape — capabilities `returns` it, the dataset is `item`
  capabilities: CapabilityDef[];   // create/update/delete, typed, scoped to the app's write scope
  dataset: DatasetDef;             // the readable collection with its filters
  scoped: boolean;
  /** CREATE TABLE + indexes + updated_at delta triggers for this collection. */
  ddl(): string;
  /** Coerce a client value to its stored column form (booleans → 0/1, list → JSON text). */
  coerce(field: string, value: unknown): unknown;
  /** A stored row → its wire shape (booleans back, list parsed). */
  toRow(raw: Record<string, unknown> | null): Record<string, unknown> | null;
  /**
   * Wire the CRUD routes onto an Express router/app: GET (list, filtered + scoped),
   * POST (create), PATCH (update), DELETE — each enforcing per-user ownership when
   * `scoped`. Pass the better-sqlite3 handle. Mount AFTER weaveAuth + weaveWriteGate.
   */
  mount(router: unknown, db: unknown, opts?: { basePath?: string }): void;
}
