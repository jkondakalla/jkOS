// catalog.mjs — every widget the suite ships, loaded as data.
//
// Two places ship widgets: ORDECK's built-in catalog (defaultHudState() in
// apps/ordeck/src/hud/state.ts) and app-owned widget files (apps/<app>/widgets/<id>.json,
// with optional fixtures beside them in <id>.fixtures.json). The gate, the CLI and
// the render harness all need the same list, so it is read here, once.
//
// The built-ins come from the REAL state.ts, transpiled with the repo's own TypeScript
// (the network leaves stubbed, as check:hud does) — never a copy of the defaults.
//
// And every app's Weave declarations (CapabilityDoc / DatasetDoc), required as data
// from the modules the suite-prober reads (BACKEND_DOCS), so a harness can serve a
// widget the capabilities its forms discover.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { transpile, REPO_ROOT } from '../../test/lib/unit.mjs';
import { BACKEND_DOCS } from '../../packages/suite-prober/src/sources.mjs';

export { REPO_ROOT };
export const WIDGETS_URL = pathToFileURL(join(REPO_ROOT, 'packages/widgets/src/index.js')).href;
/** The second tier (checkBindings) — a subpath of its own, never bundled into ORDECK. */
export const SEMANTIC_URL = pathToFileURL(join(REPO_ROOT, 'packages/widgets/src/semantic.js')).href;

/** Every host the suite answers on — what jkAuth passes the validator at publish, so a
 *  file the gate passes is one jkAuth would accept (validateWidget's ctx.suiteHosts). */
export function suiteHosts() {
  const { APPS } = createRequire(join(REPO_ROOT, 'package.json'))(join(REPO_ROOT, 'packages/suite-manifest/apps.js'));
  return [...new Set(APPS.filter((a) => a.origin).map((a) => new URL(a.origin).hostname))];
}

/** ORDECK's built-in defs, from the real defaultHudState(). */
export async function builtinDefs() {
  const tmp = mkdtempSync(join(tmpdir(), 'jkos-widget-catalog-'));
  try {
    writeFileSync(join(tmp, 'stub-auth-client.mjs'),
      'export const getProfile = async () => ({});\nexport const patchProfile = async () => ({});\n'
      + 'export const readHudPref = () => null;\nexport const writeHudPref = () => ({});\n');
    writeFileSync(join(tmp, 'stub-weave.mjs'), "export const appOrigin = (id) => 'https://' + id + '.jkos.net';\n");
    const RW = {
      './types': './types.mjs', './engine': './engine.mjs', '@jkos/design': './jkos-design.mjs',
      '@jkos/auth-client': './stub-auth-client.mjs', '@jkos/weave': './stub-weave.mjs', '@jkos/widgets': WIDGETS_URL,
    };
    const emit = (rel, out) => {
      let src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      for (const [from, to] of Object.entries(RW)) src = src.split(`'${from}'`).join(`'${to}'`);
      writeFileSync(join(tmp, out), transpile(src, rel));
      return pathToFileURL(join(tmp, out)).href;
    };
    emit('packages/design/responsive/breakpoints.ts', 'jkos-design.mjs');
    emit('apps/ordeck/src/hud/types.ts', 'types.mjs');
    emit('apps/ordeck/src/hud/engine.ts', 'engine.mjs');
    const state = await import(emit('apps/ordeck/src/hud/state.ts', 'state.mjs'));
    return Object.values(state.defaultHudState().widgets);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** ORDECK's HUD slice declaration (hud/slices.ts HUD_SLICES) — its imports are type-only,
 *  so the real file transpiles to plain data. What the second validation tier checks a
 *  binding into a slice against. */
export async function hudSlices() {
  const tmp = mkdtempSync(join(tmpdir(), 'jkos-widget-slices-'));
  try {
    const out = join(tmp, 'slices.mjs');
    writeFileSync(out, transpile(readFileSync(join(REPO_ROOT, 'apps/ordeck/src/hud/slices.ts'), 'utf8'), 'slices.ts'));
    return (await import(pathToFileURL(out).href)).HUD_SLICES;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Everything the second tier checks a widget against: every app's declarations and
 *  ORDECK's slices (@jkos/widgets checkBindings' ctx). */
export async function declarations() {
  return { docs: appDocs(), slices: await hudSlices() };
}

/** Every committed widget file: [{ where, app, file, def, fixtures, error? }]. */
export function widgetFiles() {
  const out = [];
  const apps = join(REPO_ROOT, 'apps');
  for (const app of readdirSync(apps)) {
    const dir = join(apps, app, 'widgets');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.fixtures.json'))) {
      const where = `apps/${app}/widgets/${f}`;
      const fx = join(dir, f.replace(/\.json$/, '.fixtures.json'));
      try {
        out.push({
          where, app, file: join(dir, f),
          def: JSON.parse(readFileSync(join(dir, f), 'utf8')),
          fixtures: existsSync(fx) ? JSON.parse(readFileSync(fx, 'utf8')) : null,
        });
      } catch (e) {
        out.push({ where, app, file: join(dir, f), def: null, fixtures: null, error: e.message });
      }
    }
  }
  return out;
}

/** Everything the suite ships: built-ins first, then app files. */
export async function shippedWidgets() {
  const builtins = (await builtinDefs()).map((def) => ({ where: `built-in '${def.id}'`, app: 'ordeck', file: null, def, fixtures: null }));
  return [...builtins, ...widgetFiles()];
}

/** Each app's Weave declarations as data: { [app]: { capabilities, datasets } }. */
export function appDocs() {
  const require = createRequire(join(REPO_ROOT, 'package.json'));
  const docs = {};
  for (const row of BACKEND_DOCS) {
    if (!row.module) continue;
    const mod = require(join(REPO_ROOT, row.module));
    docs[row.app] = { capabilities: mod.CAPABILITIES ?? mod.CAPABILITIES_DOC ?? null, datasets: mod.DATASETS ?? mod.DATASETS_DOC ?? null };
  }
  return docs;
}
