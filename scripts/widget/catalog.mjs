// catalog.mjs — every widget the suite ships, loaded as data.
//
// Every widget the suite ships is a file — apps/<app>/widgets/<id>.json, with optional
// fixtures beside it in <id>.fixtures.json — ORDECK's own cards included (they used to be
// a literal in state.ts that each tool had to transpile to read). The gate, the CLI and
// the render harness all need the same list, so it is read here, once; ORDECK compiles
// the same files in (hud/catalog.ts).
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

/** The source of a module standing in for ORDECK's hud/catalog.ts under Node, where
 *  there is no Vite to resolve its glob: the SAME files, as data. For harnesses that
 *  transpile state.ts (check:hud). */
export function catalogModuleSource() {
  const files = widgetFiles().filter((w) => w.def);
  const all = Object.fromEntries(files.map((w) => [w.def.id, w.def]));
  // CATALOG is the HUD cards only (a footprint), as hud/catalog.ts filters it.
  const placeable = files.filter((w) => w.def.sizing != null);
  const catalog = Object.fromEntries(placeable.map((w) => [w.def.id, w.def]));
  const apps = Object.fromEntries(placeable.map((w) => [w.def.id, w.app]));
  return `export const WIDGETS = Object.freeze(${JSON.stringify(all)});\nexport const CATALOG = Object.freeze(${JSON.stringify(catalog)});\nexport const CATALOG_APP = Object.freeze(${JSON.stringify(apps)});\n`;
}

/** Every widget file's def, by id — what the second tier checks a `use` against. */
export function widgetsById() {
  return Object.fromEntries(widgetFiles().filter((w) => w.def).map((w) => [w.def.id, w.def]));
}

/** ORDECK's host declaration (hud/slices.ts): its slices (HUD_SLICES) and its actions
 *  (HUD_ACTIONS). Its imports are type-only, so the real file transpiles to plain data —
 *  what the second validation tier checks a binding into a slice, or a `do`, against. */
export async function hudDeclaration() {
  const tmp = mkdtempSync(join(tmpdir(), 'jkos-widget-slices-'));
  try {
    const out = join(tmp, 'slices.mjs');
    writeFileSync(out, transpile(readFileSync(join(REPO_ROOT, 'apps/ordeck/src/hud/slices.ts'), 'utf8'), 'slices.ts'));
    const mod = await import(pathToFileURL(out).href);
    return { slices: mod.HUD_SLICES, actions: mod.HUD_ACTIONS };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Everything the second tier checks a widget against: every app's declarations and
 *  ORDECK's slices and actions (@jkos/widgets checkBindings' ctx). */
export async function declarations() {
  return { docs: appDocs(), ...(await hudDeclaration()), widgets: widgetsById() };
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

/** Everything the suite ships — ORDECK's own cards included — is a widget file. */
export async function shippedWidgets() {
  return widgetFiles();
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
