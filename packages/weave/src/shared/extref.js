// extref.js — the cross-app addressing convention, once, for BOTH halves.
//
// An ext_ref is "<app>:<localId>" — one opaque string, owned by the writing app,
// that says "this thing lives in app X with id Y." No central join table, no
// referential integrity, deliberately: the writing app owns the string, readers
// split it to know which app to deeplink or query.
//
// ⚠️ It lived only in extref.ts, which is TypeScript, so no Node backend could
// import it — and the activity contract (D6) needs it on the SERVER side, where
// every app is CJS. The choice was a fifth hand-typed copy of `${app}:${id}` or
// one shared definition; this is the shared definition, in the same ESM-consumed-
// by-both form docShape.js already uses. extref.ts re-exports it for the frontend.
//
// ⚠️ THE NAMESPACE ITSELF IS NOT SETTLED (BB-5). `beigeboard:41`, `itunes:1234567`
// and `routine:24:2026-08-18` all live in one column today, and an author reading
// the dataset docs cannot tell them apart. D7 resolves that. This file is where
// the resolution goes — which is the other reason not to have made a fifth copy.

/** Build "<app>:<id>". */
export const extRef = (app, id) => `${app}:${id}`

/** Split on the FIRST ':' so ids may themselves contain colons. */
export function parseExtRef(ref) {
  const s = String(ref)
  const i = s.indexOf(':')
  return i < 0 ? { app: '', id: s } : { app: s.slice(0, i), id: s.slice(i + 1) }
}
