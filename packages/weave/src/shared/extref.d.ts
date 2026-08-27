// Types for the cross-app addressing convention (extref.js). The prose lives in
// that file and in ../extref.ts, which re-exports these for the frontend.

/** Build "<app>:<id>". */
export function extRef(app: string, id: string | number): string;

/** Split on the FIRST ':' so ids may themselves contain colons. */
export function parseExtRef(ref: string): { app: string; id: string };
