// Widget render conformance — every widget the suite ships, DRAWN, in a real browser.
//
// Every other widget gate reads the spec. This one renders it: the real renderer and
// the HUD's real selectors (apps/ordeck/preview, via scripts/widget/render.mjs), headless
// Chromium over the DevTools Protocol, each built-in and each apps/*/widgets/*.json in
// both faces, at every tier (desktop, mobile, and the smallest footprint a user may
// resize it to), in every state (ready, empty, offline, signed-out, loading).
//
//   HARD — no preview page error, no uncaught exception, no WIDGET FAULT tile in any
//   cell. A spec that throws on real-shaped data ships as a red box on every HUD.
//
//   RATCHET — a card outgrowing its footprint (wider or taller) and text cut off
//   without an ellipsis are pinned in test/widget-render.baseline.json, as they stood
//   when this gate was written. A NEW one fails: a widget got worse. A pinned one that
//   no longer happens also fails, until it is removed with `--update` — the baseline
//   only ever shrinks by someone saying so, and never hides a regression.
//
// Skips without a browser, as check:token-identity does.
//
// Run:  node test/widget-render.mjs [--update]    (wired as `pnpm check:widget-render`)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, shippedWidgets } from '../scripts/widget/catalog.mjs';
import { renderWidgets } from '../scripts/widget/render.mjs';

const BASELINE = join(REPO_ROOT, 'test/widget-render.baseline.json');
const UPDATE = process.argv.includes('--update');
let failed = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };

const widgets = (await shippedWidgets()).filter((w) => w.def);
const results = await renderWidgets(widgets, { modes: ['paper', 'dark'] });
if (!results) {
  console.log('⚠ widget-render: no Chromium found (~/.cache/ms-playwright, then PATH) — skipped');
  process.exit(0);
}

const found = new Set();
for (const r of results) {
  const at = `${r.id} (${r.mode})`;
  if (r.report.error) { fail(`${at}: the preview page failed — ${r.report.error.split('\n')[0]}`); continue; }
  if (r.report.pageErrors.length) fail(`${at}: uncaught in the page — ${r.report.pageErrors[0].split('\n')[0]}`);
  if (r.report.unsettled) fail(`${at}: ${r.report.unsettled} fixture request(s) never answered`);
  const faults = r.report.cells.filter((c) => c.fault).map((c) => `${c.tier}/${c.state}`);
  if (faults.length) fail(`${at}: WIDGET FAULT in ${faults.join(', ')}`);
  for (const c of r.report.cells) {
    if (c.overflowX) found.add(`${r.id} · ${c.tier} · ${c.state} · wider than its footprint`);
    if (c.overflowY) found.add(`${r.id} · ${c.tier} · ${c.state} · taller than its footprint`);
    if (c.clipped.length) found.add(`${r.id} · ${c.tier} · ${c.state} · text cut off without an ellipsis`);
  }
}
if (!failed) ok(`${widgets.length} widgets × 2 faces × every tier and state render with no fault and no page error`);

// ORDECK compiles the widget files in with a Vite glob (hud/catalog.ts); a pattern that
// missed an app would ship a HUD without its cards and nothing else would say so. The
// preview is a real Vite build of that module, so what it reports is what the glob found.
const compiled = results.find((r) => r.report.catalog)?.report.catalog ?? [];
const files = widgets.map((w) => w.def.id).sort();
if (JSON.stringify(compiled) === JSON.stringify(files)) ok(`the build compiles in exactly the ${files.length} widget files on disk`);
else fail(`the build's catalog is not the widget files — compiled [${compiled}] vs files [${files}]`);

const now = [...found].sort();
if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`wrote ${now.length} pinned finding(s) to test/widget-render.baseline.json`);
} else {
  const pinned = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : []);
  const worse = now.filter((f) => !pinned.has(f));
  const fixed = [...pinned].filter((f) => !found.has(f));
  for (const f of worse) fail(`NEW: ${f} — look at it: pnpm widget shot ${f.split(' · ')[0]}`);
  for (const f of fixed) fail(`FIXED (remove it from the baseline: node test/widget-render.mjs --update): ${f}`);
  if (!worse.length && !fixed.length) ok(`layout findings match the baseline (${pinned.size} pinned, none new)`);
}

if (failed) { console.error(`\n✗ widget-render: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ widget-render: all assertions passed');
