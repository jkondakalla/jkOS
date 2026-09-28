// Widget factory conformance — the vocabulary, and what a widget may make the browser
// do, held in code. The validator's own behaviour is the @jkos/widgets package test;
// this gate holds everything that must AGREE with it across the suite.
//
//   1. GENERATED FILES ARE FRESH. ORDECK's `WidgetNode` union (hud/nodes.gen.ts) is
//      projected from packages/widgets/src/manifest.js. Stale means the renderer is
//      type-checked against a vocabulary the validator no longer speaks.
//   2. EVERY WIDGET THE SUITE SHIPS IS VALID. ORDECK's built-in catalog (the REAL
//      defaultHudState(), transpiled) and every committed widget file
//      (apps/*/widgets/*.json) pass the validator jkAuth holds a publish to — so
//      "committed" and "publishable" cannot disagree.
//   3. THE WORKSHOP EDITS LOSSLESSLY. The real workshop/model.ts, whose tree shape is
//      now derived from the manifest, round-trips every shipped body byte-for-byte:
//      what you open in the canvas is what you publish.
//   4. ONE WALKER. The three hand-rolled binding walkers (the renderer's collectSrcs,
//      the tray's scanSrcs, the HUD doc's bindsSlice) are @jkos/widgets' sourcesOf now;
//      a regrown one is the regression.
//   5. HREFS. `link.href`, `frame.href` and Focus's deeplink resolve from live data,
//      and React 18 renders `javascript:` with only a dev-mode warning. Every dynamic
//      href in the widget renderer passes through safeHref (whose behaviour the
//      package test pins).
//
// Run:  node test/widgets.mjs      (wired as `pnpm check:widgets`, folded into
//                                   `pnpm test:contracts`)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unit, REPO_ROOT } from './lib/unit.mjs';
import { shippedWidgets, WIDGETS_URL as WIDGETS } from '../scripts/widget/catalog.mjs';

const { check, importTs, done } = unit('widgets');
const { validateWidget } = await import(WIDGETS);
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const fmt = (errs) => errs.map((e) => `${e.path} ${e.code}${e.fix ? ` (${e.fix})` : ''}`).join('; ');

// ── 1. generated files are fresh ────────────────────────────────────────────
try {
  execFileSync(process.execPath, [join(REPO_ROOT, 'packages/widgets/scripts/gen.mjs'), '--check'], { stdio: 'pipe' });
  check(true, 'files generated from the manifest are fresh');
} catch (e) {
  check(false, `files generated from the manifest are stale — run \`pnpm widgets:gen\`\n${e.stdout}${e.stderr}`);
}

// ── 2. every widget the suite ships is valid ────────────────────────────────
// ORDECK's built-ins (the REAL defaultHudState(), transpiled) and every app widget
// file — read by scripts/widget/catalog.mjs, the same list the CLI and render gate use.
const shipped = await shippedWidgets();
check(shipped.some((w) => w.where.startsWith('built-in')), `ORDECK's built-in catalog loads (${shipped.filter((w) => w.where.startsWith('built-in')).length} widgets)`);
for (const w of shipped) {
  if (!w.def) { check(false, `${w.where} is JSON — ${w.error}`); continue; }
  if (w.file) check(w.def.id === w.where.split('/').pop().replace(/\.json$/, ''), `${w.where}: the file is named for its widget id`);
}
for (const { where, def } of shipped.filter((w) => w.def)) {
  const errs = validateWidget(def);
  check(errs.length === 0, `${where} is a valid widget${errs.length ? ` — ${fmt(errs)}` : ''}`);
}

// ── 3. the Workshop edits losslessly ────────────────────────────────────────
const model = await importTs('apps/ordeck/src/workshop/model.ts', 'model.mjs', { '@jkos/widgets': WIDGETS });
for (const { where, def } of shipped.filter((w) => w.def)) {
  if (!def.spec) continue;
  const back = model.enToNode(model.nodeToEn(def.spec.body));
  check(JSON.stringify(back) === JSON.stringify(def.spec.body), `${where} round-trips through the Workshop tree byte-for-byte`);
}

// ── 4. one walker ────────────────────────────────────────────────────────────
for (const rel of ['apps/ordeck/src/hud/registry.tsx', 'apps/ordeck/src/hud/state.ts', 'apps/ordeck/src/hud/WidgetTray.tsx']) {
  const src = read(rel);
  check(/\bsourcesOf\b/.test(src) && /from '@jkos\/widgets'/.test(src), `${rel} asks @jkos/widgets' sourcesOf which slices a widget binds`);
  const regrown = ['collectSrcs', 'scanSrcs', 'bindsSlice'].filter((n) => new RegExp(`function ${n}\\b`).test(src));
  check(regrown.length === 0, `${rel} does not regrow a binding walker${regrown.length ? ` (${regrown.join(', ')})` : ''}`);
}

// ── 5. every dynamic href in the widget renderer goes through safeHref ──────
const HUD = join(REPO_ROOT, 'apps/ordeck/src/hud');
for (const f of readdirSync(HUD).filter((n) => n.endsWith('.tsx'))) {
  const src = readFileSync(join(HUD, f), 'utf8');
  for (const [, expr] of src.matchAll(/href=\{([^}]*)\}/g)) {
    const ok = /^\s*safeHref\(/.test(expr) || /^\s*href\s*$/.test(expr) && /const href = [^;]*safeHref\(/.test(src);
    check(ok, `hud/${f}: href={${expr.trim()}} passes through safeHref`);
  }
}

done();
