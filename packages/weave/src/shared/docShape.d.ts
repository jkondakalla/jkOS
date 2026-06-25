// Types for the runtime doc-shape validator (docShape.js). Consumed by the TS
// frontend (fetchCapabilities/fetchDatasets) and, untyped, by the CJS backend
// (server/contracts.js). The authoritative doc interfaces live in ../capability.ts
// and ../dataset.ts; this only types the structural guard.

export type DocListKey = 'capabilities' | 'datasets';

/** null when the doc is structurally valid, else a human-readable error string. */
export function checkDocShape(doc: unknown, listKey: DocListKey): string | null;

/** true when the doc is structurally valid. */
export function isValidDoc(doc: unknown, listKey: DocListKey): boolean;
