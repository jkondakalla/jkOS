// Mirror the canonical design-factory tokens into the deploy console's static dir.
//
// jkos-deploy is a Python/FastAPI service outside the pnpm workspace, so it can't
// import '@jkos/design/tokens.css' — the console is one static index.html served
// by FileResponse. This copies the single source of truth
// (packages/design/tokens/hub.css) into static/jkos-tokens.css, which index.html
// <link>s (served by the /jkos-tokens.css route in main.py). Run it whenever the
// factory tokens change:
//
//   node jkos-deploy/scripts/sync-tokens.mjs
//
// The generated file is committed so production (which doesn't run this) ships it.
//
// Run with --check to FAIL instead of write when the committed mirror has drifted
// from the source — wired into the root `pnpm check:tokens` gate alongside jkAuth's.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../packages/design/tokens/hub.css');
const out = resolve(here, '../static/jkos-tokens.css');
const indexHtml = resolve(here, '../static/index.html');

const banner =
  '/* GENERATED — mirror of @jkos/design/tokens/hub.css. DO NOT EDIT.\n' +
  '   Regenerate: node jkos-deploy/scripts/sync-tokens.mjs */\n\n';

const expected = banner + readFileSync(src, 'utf8');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch { /* missing → drift */ }
  if (current !== expected) {
    console.error(
      `✗ jkos-deploy design-token mirror is STALE: ${out}\n` +
      `  It no longer matches packages/design/tokens/hub.css.\n` +
      `  Regenerate + commit:  node jkos-deploy/scripts/sync-tokens.mjs`);
    process.exit(1);
  }
  console.log('✓ jkos-deploy design-token mirror is in sync with @jkos/design');

  // ── Alias-resolution check (same contract as jkAuth's) ──────────────────
  // The mirror being byte-identical only proves the *copy* is fresh. The
  // console's inline <style> references var(--hub-*) directly — rename a token
  // in hub.css and the page would silently render with undefined var()s and no
  // failing gate. So: parse every var(--…) used in index.html and assert each
  // resolves to a custom-property DEFINITION, locally or in the token source.
  const html = readFileSync(indexHtml, 'utf8');
  const defsIn = (css) =>
    new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const defined = new Set([...defsIn(html), ...defsIn(expected)]);
  const referenced = [...html.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]);
  const unresolved = [...new Set(referenced)].filter((n) => !defined.has(n));
  if (unresolved.length) {
    console.error(
      `✗ jkos-deploy index.html references CSS variables with no definition:\n` +
      unresolved.map((n) => `    --${n}`).join('\n') + '\n' +
      `  These resolve neither locally in static/index.html nor in the\n` +
      `  @jkos/design token source — likely a --hub-* token was renamed or\n` +
      `  removed in packages/design/tokens/hub.css.`);
    process.exit(1);
  }
  console.log('✓ jkos-deploy index.html tokens all resolve to a defined token');
} else {
  writeFileSync(out, expected);
  console.log(`✓ wrote ${out}`);
}
