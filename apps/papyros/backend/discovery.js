'use strict';
// discovery.js — PapyrOS's Weave discovery declarations, DERIVED from a collection.
//
// Scaffolded by `pnpm new-app`. The reference is apps/beigeboard/backend/discovery.js.
// One CollectionDef (a name + typed fields) is the single source: the storage + CRUD
// routes (server.js) AND these discovery docs — what can be DONE to PapyrOS
// (CAPABILITIES) and READ from it (DATASETS) — all derive from it via defineCollection,
// so the table, the routes, and the served contract can't drift (Layer D / F3). Pure
// data + zero side effects (defineCollection only builds plain objects): safe for the
// suite-prober, a workshop GUI, or an AI composer to require() with no env/DB/network.
//
// Layer-A contract, for free: every capability gets a TYPED `returns` (its output stud),
// the dataset gets a typed `item` row + filters that carry their own column/op (so the
// declared-readable filter IS the enforced one), and the invalidation bus key is DERIVED
// from the app id. Add a field below → it flows to the column, the body, and the row.
const { defineCollection } = require('@jkos/weave/collection');

/* Define PapyrOS's data type ONCE. Edit these fields to shape the app; everything
   downstream (table, create/update/delete capabilities, the items dataset) follows. */
const ITEMS = defineCollection({
  app: 'papyros', id: 'items', label: 'Items',
  fields: [
    { name: 'title',   type: 'string',  label: 'Title', required: true, max: 200 },
    { name: 'notes',   type: 'text',    label: 'Notes' },
    { name: 'done',    type: 'boolean', label: 'Done', filter: 'eq' },
    { name: 'tags',    type: 'string',  label: 'Tags (comma-separated)', list: true, filter: 'tags' },
    { name: 'ext_ref', type: 'string',  label: 'External ref', filter: 'prefix' },
  ],
});

/* The served discovery docs — the capability/dataset envelopes around the derived
   primitives. Bump `version` on a breaking field change. */
const CAPABILITIES = { app: 'papyros', version: 1, capabilities: ITEMS.capabilities };
const DATASETS = { app: 'papyros', version: 1, datasets: [ITEMS.dataset] };

module.exports = { CAPABILITIES, DATASETS, ITEMS, ITEM_SHAPE: ITEMS.item };
