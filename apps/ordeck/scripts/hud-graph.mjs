// ORDECK's HUD-state graph (types → engine → state), loaded in Node — the REAL code, never a
// re-implementation that could drift.
//
// The graph is pure TypeScript, so this transpiles it with the repo's own `typescript` (the
// house pattern, test/lib/unit.mjs), stubbing only the two non-pure leaf imports: @jkos/
// auth-client's network profile calls and @jkos/weave's appOrigin. Two readers:
//
//   • check:hud (check-hud-doc.mjs) validates HUD docs and drives the published-widget merge.
//   • check:native (test/native.mjs) runs native/hud-order-cases.json through loadHudState and
//     layoutForBreakpoint — the order the phone app draws the HUD in must be the web's.
//
// The profile the stubbed getProfile answers is whatever `setProfile` last set ({} until then),
// so loadHudState reads a given preferences blob exactly as it reads a live one.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { catalogModuleSource } from '../../../scripts/widget/catalog.mjs';

/** Load the graph into `tmp` with `emitTs` (both from test/lib/unit.mjs's unit()). */
export async function loadHudGraph({ tmp, emitTs }) {
  // Rewrite the graph's bare import specifiers to the temp-dir siblings / stubs.
  const REWRITES = {
    './types': './types.mjs',
    './engine': './engine.mjs',
    '@jkos/design': './jkos-design.mjs',
    '@jkos/auth-client': './stub-auth-client.mjs',
    '@jkos/weave': './stub-weave.mjs',
    // The widget vocabulary is plain JS with no imports of its own — the REAL package,
    // by absolute URL, never a stub (state.ts asks it which slices a def binds).
    '@jkos/widgets': pathToFileURL(resolve(import.meta.dirname, '../../../packages/widgets/src/index.js')).href,
    // hud/catalog.ts is a Vite glob; the SAME widget files, as data (scripts/widget/catalog.mjs).
    './catalog': './catalog.mjs',
  };
  const transpileTo = (srcRel, outName) => emitTs(srcRel, outName, REWRITES);

  /* ⚠️ getProfile/patchProfile are stubbed (they are the network); readHudPref and
     writeHudPref are NOT — the REAL ones are transpiled in below and re-exported here.
     They are a data migration over live user data whose every failure mode is silent,
     and a stub would have a check exercising a fiction of them. */
  writeFileSync(join(tmp, 'stub-auth-client.mjs'),
    'export const getProfile = async () => globalThis.__jkosHudProfile ?? {};\n'
    + 'export const patchProfile = async () => ({});\n'
    + "export { readHudPref, writeHudPref } from './hudPrefs.mjs';\n");
  writeFileSync(join(tmp, 'stub-weave.mjs'),
    "export const appOrigin = (id) => 'https://' + id + '.jkos.net';\n");
  // Real suite breakpoints — the same pure source @jkos/design re-exports (kept
  // drift-free by test/responsive.mjs), transpiled rather than hand-inlined.
  transpileTo('packages/design/responsive/breakpoints.ts', 'jkos-design.mjs');
  // XC-5's read-fallback / lazy re-write, real rather than stubbed (see above).
  transpileTo('packages/auth-client/src/hudPrefs.ts', 'hudPrefs.mjs');
  transpileTo('apps/ordeck/src/hud/types.ts', 'types.mjs');
  transpileTo('apps/ordeck/src/hud/engine.ts', 'engine.mjs');
  writeFileSync(join(tmp, 'catalog.mjs'), await catalogModuleSource());
  transpileTo('apps/ordeck/src/hud/state.ts', 'state.mjs');
  // XC-3: the BeigeBoard delta merge — pure by construction, no imports at all.
  transpileTo('apps/ordeck/src/pages/hud/bbDelta.ts', 'bbDelta.mjs');

  const load = (name) => import(pathToFileURL(join(tmp, name)).href);
  return {
    types: await load('types.mjs'),
    engine: await load('engine.mjs'),
    state: await load('state.mjs'),
    bbDelta: await load('bbDelta.mjs'),
    /** What the stubbed getProfile answers next: a profile, `{ preferences }`. */
    setProfile: (profile) => { globalThis.__jkosHudProfile = profile; },
  };
}
