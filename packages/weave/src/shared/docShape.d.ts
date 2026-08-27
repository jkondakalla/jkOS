// Types for the runtime doc-shape validator (docShape.js). Consumed by the TS
// frontend (fetchCapabilities/fetchDatasets) and, untyped, by the CJS backend
// (server/contracts.js). The authoritative doc interfaces live in ../capability.ts
// and ../dataset.ts; this only types the structural guard.

export type DocListKey = 'capabilities' | 'datasets';

/** null when the doc is structurally valid, else a human-readable error string. */
export function checkDocShape(doc: unknown, listKey: DocListKey): string | null;

/** true when the doc is structurally valid. */
export function isValidDoc(doc: unknown, listKey: DocListKey): boolean;

/** The highest declaration version this code understands. A consumer reading a
 *  HIGHER version fails closed — a half-understood contract is worse than a refused
 *  one (RESET A2c.3). */
export const MAX_DOC_VERSION: number;

/** The code a version refusal carries, so "speaks a dialect I don't know" is
 *  distinguishable from "is broken". */
export const DOC_VERSION_UNSUPPORTED: 'DOC_VERSION_UNSUPPORTED';
