// TEST-12 — ORDECK HUD document validator + healer-idempotency check.
//
// The HUD doc (a per-user prefs blob: `preferences.hud`, a { version, widgets,
// layouts, shelf } object) is the thing the last three fix-sessions kept
// re-healing: placed ids with no def, footprints below the legibility floor or
// past the grid edge, a stale schema version, and — the headline class — a
// `mergePublished` that WASN'T idempotent, so re-publishing a resized card left
// the doc snapping forever (the "sizing-follow / staleness" bugs). This asserts
// the invariants that were being hand-checked, and drives the REAL merge to prove
// it's a stable healer.
//
// It runs the actual ORDECK code — no re-implementation that could drift. The HUD
// state graph (types → engine → state) is pure TypeScript, so this transpiles it
// in-memory with the repo's own `typescript` dep (the TEST-9 house pattern),
// stubbing only the two non-pure leaf imports it never exercises here
// (@jkos/auth-client's network profile fns, @jkos/weave's appOrigin) and feeding
// the REAL suite breakpoints. No new dependency; ORDECK's broken vite dev is not
// involved.
//
// Modes:
//   node check-hud-doc.mjs                 gate: self-validate the built-in
//                                          catalog + synthetic merge idempotency.
//   node check-hud-doc.mjs <file.json>     validate a doc / a full profile
//                                          ({preferences:{hud}}) / an array of
//                                          either (a staging-DB export = fleet check).
//   node check-hud-doc.mjs --live [--base URL] [--token JWT]
//                                          GET {base}/auth/profile and validate its
//                                          hud slice (base defaults to prod jkAuth).
//
// Wired into the gate (no-arg mode) as `pnpm check:hud`.
//
// NOTE: "no flex:none card root" is a CSS-render invariant (hud.css § "a card root
// must never opt out with flex:none"), not representable in the doc JSON, so it is
// pinned by that stylesheet comment + the grid CSS, not here.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-hud-doc-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// ── In-memory transpile of the pure HUD-state graph ─────────────────────────
// Rewrite the graph's bare import specifiers to the temp-dir siblings / stubs,
// then transpile TS → ESM (type-only imports are erased) and write it out.
const REWRITES = {
  './types': './types.mjs',
  './engine': './engine.mjs',
  '@jkos/design': './jkos-design.mjs',
  '@jkos/auth-client': './stub-auth-client.mjs',
  '@jkos/weave': './stub-weave.mjs',
};
function transpileTo(srcRel, outName) {
  let src = readFileSync(resolve(repo, srcRel), 'utf8');
  for (const [from, to] of Object.entries(REWRITES)) {
    src = src.replaceAll(`'${from}'`, `'${to}'`);
  }
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
    fileName: srcRel,
  });
  writeFileSync(join(tmp, outName), outputText);
}

// Stubs for the two non-pure leaf imports (never called on the merge path).
writeFileSync(join(tmp, 'stub-auth-client.mjs'),
  'export const getProfile = async () => ({});\nexport const patchProfile = async () => ({});\n');
writeFileSync(join(tmp, 'stub-weave.mjs'),
  "export const appOrigin = (id) => 'https://' + id + '.jkos.net';\n");
// Real suite breakpoints — the same pure source @jkos/design re-exports (kept
// drift-free by test/responsive.mjs), transpiled rather than hand-inlined.
transpileTo('packages/design/responsive/breakpoints.ts', 'jkos-design.mjs');
transpileTo('apps/ordeck/src/hud/types.ts', 'types.mjs');
transpileTo('apps/ordeck/src/hud/engine.ts', 'engine.mjs');
transpileTo('apps/ordeck/src/hud/state.ts', 'state.mjs');

const types = await import(pathToFileURL(join(tmp, 'types.mjs')).href);
const engine = await import(pathToFileURL(join(tmp, 'engine.mjs')).href);
const state = await import(pathToFileURL(join(tmp, 'state.mjs')).href);
const { HUD_STATE_VERSION, BREAKPOINTS } = types;
const { minSize } = engine;
const { mergePublished, defaultHudState } = state;

const colsOf = (name) => BREAKPOINTS.find((b) => b.name === name)?.cols;

// ── Structural invariants over one HUD doc ──────────────────────────────────
function validateDoc(doc, label) {
  if (!doc || typeof doc !== 'object' || !doc.widgets || !doc.layouts) {
    fail(`${label}: not a HUD document (missing widgets/layouts)`);
    return;
  }
  let problems = 0;
  const flag = (m) => { fail(`${label}: ${m}`); problems++; };

  if (doc.version !== HUD_STATE_VERSION)
    flag(`schema version is ${doc.version}, current is ${HUD_STATE_VERSION} (a stale doc renders retired ids)`);

  for (const [tier, items] of Object.entries(doc.layouts)) {
    if (!items) continue;
    const cols = colsOf(tier);
    if (cols == null) { flag(`layout tier "${tier}" is not a known breakpoint`); continue; }
    for (const it of items) {
      const def = doc.widgets[it.i];
      if (!def) { flag(`${tier}: placed id "${it.i}" has no widget def`); continue; }
      if (!(it.w >= 1 && it.h >= 1)) flag(`${tier}/${it.i}: non-positive size ${it.w}×${it.h}`);
      if (it.x < 0 || it.x + it.w > cols) flag(`${tier}/${it.i}: overflows the ${cols}-col grid (x=${it.x} w=${it.w})`);
      const m = minSize(def, cols);
      if (it.w < m.w || it.h < m.h)
        flag(`${tier}/${it.i}: ${it.w}×${it.h} is below the legibility floor ${m.w}×${m.h}`);
    }
  }
  for (const id of doc.shelf ?? [])
    if (!doc.widgets[id]) flag(`shelf id "${id}" has no widget def`);

  if (problems === 0) ok(`${label}: structurally valid (v${doc.version}, ${Object.keys(doc.widgets).length} widgets)`);
}

// ── mergePublished idempotency ──────────────────────────────────────────────
// The healer must be a fixed point: merging the same published set twice yields a
// byte-identical doc. Exercise it with the doc's own widget defs promoted to
// "published" (drives normalizePublished + the sizing snap) AND with an empty set
// (drives the hygiene/shelf pass).
function checkIdempotent(doc, label) {
  for (const [name, published] of [
    ['own-defs', Object.values(doc.widgets)],
    ['empty', []],
  ]) {
    let once, twice;
    try {
      once = mergePublished(structuredClone(doc), structuredClone(published));
      twice = mergePublished(structuredClone(once), structuredClone(published));
    } catch (e) {
      fail(`${label}: mergePublished threw (${name}): ${e.message}`);
      continue;
    }
    if (JSON.stringify(once) === JSON.stringify(twice))
      ok(`${label}: mergePublished is idempotent (${name} published set)`);
    else
      fail(`${label}: mergePublished is NOT idempotent (${name}) — a second merge changed the doc (sizing-follow/staleness class)`);
  }
}

// ── Modes ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const files = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--base' && args[args.indexOf(a) - 1] !== '--token');

// Pull every HUD doc out of an arbitrary parsed JSON payload (bare doc, a full
// profile, or an array of either), tagged for reporting.
function extractDocs(json, origin) {
  const out = [];
  const visit = (v, path) => {
    if (Array.isArray(v)) { v.forEach((e, i) => visit(e, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    if (v.version !== undefined && v.widgets && v.layouts) { out.push([v, path]); return; }
    if (v.preferences?.hud) { out.push([v.preferences.hud, `${path}(${v.email ?? v.id ?? 'user'}).hud`]); return; }
    if (v.hud?.widgets) { out.push([v.hud, `${path}.hud`]); }
  };
  visit(json, origin);
  return out;
}

if (args.includes('--live')) {
  const base = (flagVal('--base') ?? 'https://jkauth.jkos.net').replace(/\/$/, '');
  const token = flagVal('--token');
  const headers = token ? { cookie: `jkos_at=${token}`, authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${base}/auth/profile`, { headers });
  if (!res.ok) { fail(`--live: GET ${base}/auth/profile → ${res.status}`); }
  else {
    const docs = extractDocs(await res.json(), `${base}/auth/profile`);
    if (!docs.length) ok('--live: profile carries no hud slice (nothing to validate)');
    for (const [doc, label] of docs) { validateDoc(doc, label); checkIdempotent(doc, label); }
  }
} else if (files.length) {
  for (const f of files) {
    let docs;
    try { docs = extractDocs(JSON.parse(readFileSync(resolve(f), 'utf8')), f); }
    catch (e) { fail(`${f}: ${e.message}`); continue; }
    if (!docs.length) { fail(`${f}: no HUD doc found (expected a doc, a profile, or an array)`); continue; }
    for (const [doc, label] of docs) { validateDoc(doc, label); checkIdempotent(doc, label); }
  }
} else {
  // Gate mode: the built-in catalog must satisfy every invariant, the merge must
  // be idempotent on it, and a deliberately-stale doc must HEAL to a fixed point.
  const builtin = defaultHudState();
  validateDoc(builtin, 'built-in default doc');
  checkIdempotent(builtin, 'built-in default doc');

  // A doc whose stored footprint is stale vs a (re)published def, not user-sized:
  // the first merge snaps it to the def, the second must be a no-op.
  const pubDef = {
    id: 'demo', label: 'Demo',
    sizing: { desktop: { w: 4, h: 3 }, mobile: { w: 2, h: 3 }, min: { w: 2, h: 2 } },
    spec: { body: { t: 'text', value: 'hi' } },
  };
  const stale = {
    version: HUD_STATE_VERSION,
    widgets: { demo: { ...pubDef, sizing: { desktop: { w: 2, h: 2 }, mobile: { w: 2, h: 2 } } } },
    layouts: { desktop: [{ i: 'demo', x: 0, y: 0, w: 2, h: 2 }] },
    shelf: [],
  };
  const healed = mergePublished(structuredClone(stale), [pubDef]);
  const snapped = healed.layouts.desktop[0];
  if (snapped.w === 4 && snapped.h === 3) ok('stale footprint snaps to the republished def (author-resize follow)');
  else fail(`stale footprint did not snap: got ${snapped.w}×${snapped.h}, expected 4×3`);
  checkIdempotent(healed, 'healed stale doc');

  // A user-sized cell must be left alone by the merge (the one snap exception).
  const usered = {
    version: HUD_STATE_VERSION,
    widgets: { demo: pubDef },
    layouts: { desktop: [{ i: 'demo', x: 0, y: 0, w: 6, h: 5, userSized: true }] },
    shelf: [],
  };
  const afterUser = mergePublished(structuredClone(usered), [pubDef]);
  const uit = afterUser.layouts.desktop[0];
  if (uit.w === 6 && uit.h === 5) ok('user-sized cell is preserved across a republish (snap exception holds)');
  else fail(`user-sized cell was clobbered: got ${uit.w}×${uit.h}, expected 6×5`);
}

// ── summary ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error(`\n✗ check-hud-doc: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ check-hud-doc: HUD document invariants + merge idempotency hold');
