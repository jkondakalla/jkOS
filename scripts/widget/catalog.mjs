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
export async function catalogModuleSource() {
  const { drawableIn } = await import(WIDGETS_URL);
  const host = await ordeckHost();
  const files = widgetFiles().filter((w) => w.def);
  const all = Object.fromEntries(files.map((w) => [w.def.id, w.def]));
  // CATALOG is the HUD cards only — a footprint, and drawable in ORDECK — as
  // hud/catalog.ts filters it.
  const placeable = files.filter((w) => w.def.sizing != null && drawableIn(w.def, host, all).length === 0);
  const catalog = Object.fromEntries(placeable.map((w) => [w.def.id, w.def]));
  const apps = Object.fromEntries(placeable.map((w) => [w.def.id, w.app]));
  return `export const WIDGETS = Object.freeze(${JSON.stringify(all)});\nexport const CATALOG = Object.freeze(${JSON.stringify(catalog)});\nexport const CATALOG_APP = Object.freeze(${JSON.stringify(apps)});\n`;
}

/** ORDECK as a host, as hud/catalog.ts ORDECK_HOST builds it: its declared slices and
 *  actions, its own manifest molecules, and no routes — what drawableIn holds a widget to. */
export async function ordeckHost() {
  const { moleculesOf } = await import(WIDGETS_URL);
  const { slices, actions } = await hudDeclaration();
  return { slices: Object.keys(slices), actions: Object.keys(actions), navigate: false, kinds: moleculesOf('ordeck') };
}

/** Every declared host, by app — what the gate finds each widget file a home in. A host is
 *  its slices, its molecules, its actions, and whether it routes. */
export async function hosts() {
  const decls = await hostDeclarations();
  return Object.fromEntries(Object.entries(decls).map(([id, d]) => [id, {
    slices: Object.keys(d.slices), actions: Object.keys(d.actions), navigate: d.navigate, kinds: d.kinds,
  }]));
}

/** Every host's DECLARATION, by app: its slices and actions as data (what the second tier
 *  checks a widget drawn there against), the molecules it draws, whether it routes, and
 *  the screens it routes that are not widget pages yet (`legacyRoutes` — a `go` may name
 *  one). ORDECK's is hud/slices.ts; KourOS's is src/widgets/declaration.ts. */
export async function hostDeclarations() {
  const { moleculesOf } = await import(WIDGETS_URL);
  const hud = await hudDeclaration();
  const k = await kourosDeclaration();
  return {
    ordeck: { slices: hud.slices, actions: hud.actions, navigate: false, legacyRoutes: [], kinds: moleculesOf('ordeck') },
    kouros: { slices: k.slices, actions: k.actions, navigate: true, legacyRoutes: k.legacyRoutes, kinds: moleculesOf('kouros') },
  };
}

/** KourOS's host declaration (src/widgets/declaration.ts): its slices, its actions, and
 *  its routes still drawn by hand-built views. Type-only imports, so it transpiles to data. */
export async function kourosDeclaration() {
  const mod = await transpiledModule('apps/kouros/src/widgets/declaration.ts');
  return { slices: mod.KOUROS_SLICES, actions: mod.KOUROS_ACTIONS, legacyRoutes: [...mod.KOUROS_LEGACY_ROUTES] };
}

/**
 * The contexts the second tier checks one widget file in: one per host that can draw it
 * (its homes — portability is derived, drawableIn), each with that host's slices and
 * actions, and the app's pages — the routes its page files declare, plus the routes its
 * own host still draws by hand (a `go` may name either). A file with no home is checked
 * against its own app's host, or ORDECK's (the gate reports the missing home on its own).
 * @returns {Promise<{ host: string, ctx: object }[]>}
 */
export async function secondTierContexts(def, app, { files } = {}) {
  const { drawableIn, routeTable } = await import(WIDGETS_URL);
  const all = files ?? widgetFiles();
  const widgets = Object.fromEntries(all.filter((w) => w.def).map((w) => [w.def.id, w.def]));
  const decls = await hostDeclarations();
  const shapes = await hosts();
  const pages = [
    ...routeTable(all.filter((w) => w.app === app && w.def).map((w) => w.def)).routes.keys(),
    ...(decls[app]?.legacyRoutes ?? []),
  ];
  const homes = Object.keys(shapes).filter((id) => drawableIn(def, shapes[id], widgets).length === 0);
  return (homes.length ? homes : [decls[app] ? app : 'ordeck']).map((host) => ({
    host,
    ctx: { docs: appDocs(), widgets, slices: decls[host].slices, actions: decls[host].actions, pages },
  }));
}

/** Every widget file's def, by id — what the second tier checks a `use` against. */
export function widgetsById() {
  return Object.fromEntries(widgetFiles().filter((w) => w.def).map((w) => [w.def.id, w.def]));
}

/** ORDECK's host declaration (hud/slices.ts): its slices (HUD_SLICES) and its actions
 *  (HUD_ACTIONS). Its imports are type-only, so the real file transpiles to plain data —
 *  what the second validation tier checks a binding into a slice, or a `do`, against. */
export async function hudDeclaration() {
  const mod = await transpiledModule('apps/ordeck/src/hud/slices.ts');
  return { slices: mod.HUD_SLICES, actions: mod.HUD_ACTIONS };
}

/** A TypeScript module whose imports are type-only, transpiled and imported as data. */
async function transpiledModule(rel) {
  const tmp = mkdtempSync(join(tmpdir(), 'jkos-widget-decl-'));
  try {
    const out = join(tmp, 'decl.mjs');
    writeFileSync(out, transpile(readFileSync(join(REPO_ROOT, rel), 'utf8'), rel.split('/').pop()));
    return await import(pathToFileURL(out).href);
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
