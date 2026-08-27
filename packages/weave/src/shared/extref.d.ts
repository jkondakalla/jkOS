// Types for the cross-app addressing convention (extref.js). The prose lives in
// that file and in ../extref.ts, which re-exports these for the frontend.

/** Build "<app>:<id>". */
export function extRef(app: string, id: string | number): string;

/** Split on the FIRST ':' so ids may themselves contain colons. */
export function parseExtRef(ref: string): { app: string; id: string };

/** The three classes a scheme can belong to. */
export const EXT_REF_CLASSES: readonly ['suite', 'external', 'internal'];

/** Schemes owned by suite tooling rather than by any app. */
export const RESERVED_SCHEMES: Readonly<Record<string, string>>;

/** The scheme part of a ref — everything before the FIRST ':'. */
export function refScheme(ref: string): string;

export interface ExtRefScheme {
  /** lowercase snake_case, globally unique across the suite */
  id: string;
  /** 'external' (a third-party catalog) or 'internal' (app-private engine identity).
   *  'suite' is never declared — a suite scheme IS an app id. */
  class: 'external' | 'internal';
  label: string;
  /** the literal shape, starting `<id>:` — e.g. 'routine:<routineId>:<date>' */
  shape: string;
}

export interface ExtRefDoc {
  app: string;
  version: number;
  schemes: ExtRefScheme[];
}

export function checkExtRefDoc(doc: unknown): string | null;
export function extRefFieldDoc(doc: ExtRefDoc): string;
