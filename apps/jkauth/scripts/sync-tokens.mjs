// Mirror the canonical design-factory tokens into jkAuth's static dir.
//
// jkAuth is a server-rendered Express app with NO bundler, so it can't `import
// '@jkos/design/tokens.css'` the way the Vite apps do — the browser fetches CSS
// over HTTP from express.static('public'). This copies the single source of truth
// (packages/design/tokens/hub.css) into public/jkos-tokens.css, which style.css
// then @imports. Run it whenever the factory tokens change:
//
//   pnpm --filter @jkos/jkauth sync:tokens
//
// The generated file is committed so production (which doesn't run this) ships it.
//
// Run with --check (sync:tokens -- --check, wired as `check:tokens`) to FAIL
// instead of write when the committed mirror has drifted from the source — the CI
// guard that catches a token change that forgot to regenerate jkAuth's copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/design/tokens/hub.css');
const out = resolve(here, '../public/jkos-tokens.css');
const styleCss = resolve(here, '../public/style.css');

const banner =
  '/* GENERATED — mirror of @jkos/design/tokens/hub.css. DO NOT EDIT.\n' +
  '   Regenerate: pnpm --filter @jkos/jkauth sync:tokens */\n\n';

const expected = banner + readFileSync(src, 'utf8');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch { /* missing → drift */ }
  if (current !== expected) {
    console.error(
      `✗ jkAuth design-token mirror is STALE: ${out}\n` +
      `  It no longer matches packages/design/tokens/hub.css.\n` +
      `  Regenerate + commit:  pnpm --filter @jkos/jkauth sync:tokens`);
    process.exit(1);
  }
  console.log('✓ jkAuth design-token mirror is in sync with @jkos/design');

  // ── Alias-resolution check ──────────────────────────────────────────────
  // The mirror being byte-identical only proves the *copy* is fresh — it says
  // nothing about whether style.css's hand-written aliases (--surface:
  // var(--color-card), …) still point at tokens that EXIST. Rename a --color-*
  // or --hub-* token in hub.css and jkAuth's login surface would silently render
  // with an undefined var() and no failing gate. So: parse every var(--…) used
  // in style.css and assert each resolves to a custom-property DEFINITION —
  // either locally in style.css or in the canonical token source.
  const style = readFileSync(styleCss, 'utf8');
  // A custom-property definition is `--name:`; var() usages are `var(--name)`
  // (a `)` precedes any colon) so this never mistakes a reference for a def.
  const defsIn = (css) =>
    new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const defined = new Set([...defsIn(style), ...defsIn(expected)]);
  const referenced = [...style.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]);
  const unresolved = [...new Set(referenced)].filter((n) => !defined.has(n));
  if (unresolved.length) {
    console.error(
      `✗ jkAuth style.css references CSS variables with no definition:\n` +
      unresolved.map((n) => `    --${n}`).join('\n') + '\n' +
      `  These resolve neither locally in public/style.css nor in the\n` +
      `  @jkos/design token source — likely a --color-*/--hub-* token was\n` +
      `  renamed or removed in packages/design/tokens/hub.css. Re-point the\n` +
      `  alias in style.css (lines ~22-40) or restore the token.`);
    process.exit(1);
  }
  console.log('✓ jkAuth style.css aliases all resolve to a defined token');
} else {
  writeFileSync(out, expected);
  console.log(`synced design tokens → ${out}`);
}
