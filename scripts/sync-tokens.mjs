// Mirror the canonical design-factory tokens into the two consumers that cannot import them.
//
// The Vite apps `import '@jkos/design/tokens.css'`. Two surfaces have no bundler: jkAuth is
// server-rendered Express (the browser fetches CSS from express.static('public'), and
// style.css @imports the mirror), and jkos-deploy is a Python/FastAPI console outside the
// pnpm workspace (index.html <link>s the mirror, served by main.py's /jkos-tokens.css route).
// Each gets a committed copy of packages/design/tokens/hub.css, because production never runs
// this script. It was two near-identical scripts, one per consumer, until 2026-09-25.
//
//   pnpm sync:tokens              regenerate both mirrors
//   pnpm sync:tokens -- --check   FAIL instead of write (wired into `pnpm check:tokens`)
//
// --check asserts two things per mirror. The copy is byte-identical to the source; and every
// var(--…) its consumer references resolves to a custom-property DEFINITION, locally or in
// the source. A fresh copy says nothing about the consumer's hand-written aliases (jkAuth's
// `--surface: var(--color-card)`, the console's direct `var(--hub-*)`): rename a token in
// hub.css and that page would silently render with an undefined var() and no failing gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'packages/design/tokens/hub.css';
const MIRRORS = [
  { name: 'jkAuth', out: 'apps/jkauth/public/jkos-tokens.css', consumer: 'apps/jkauth/public/style.css' },
  { name: 'jkos-deploy', out: 'jkos-deploy/static/jkos-tokens.css', consumer: 'jkos-deploy/static/index.html' },
];

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const expected =
  '/* GENERATED — mirror of @jkos/design/tokens/hub.css. DO NOT EDIT.\n' +
  '   Regenerate: pnpm sync:tokens */\n\n' + read(SOURCE);

// A custom-property definition is `--name:`; a var() usage is `var(--name)` (a `)` precedes
// any colon), so a reference is never mistaken for a definition.
const defsIn = (css) => new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
const sourceDefs = defsIn(expected);

if (!process.argv.includes('--check')) {
  for (const { out } of MIRRORS) {
    writeFileSync(resolve(root, out), expected);
    console.log(`✓ wrote ${out}`);
  }
  process.exit(0);
}

let failed = 0;
for (const { name, out, consumer } of MIRRORS) {
  let current = '';
  try { current = read(out); } catch { /* missing → drift */ }
  if (current !== expected) {
    failed++;
    console.error(`✗ ${name} design-token mirror is STALE: ${out}\n` +
      `  It no longer matches ${SOURCE}.\n  Regenerate + commit:  pnpm sync:tokens`);
  } else {
    console.log(`✓ ${name} design-token mirror is in sync with @jkos/design`);
  }

  const text = read(consumer);
  const defined = new Set([...defsIn(text), ...sourceDefs]);
  const unresolved = [...new Set([...text.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]))]
    .filter((n) => !defined.has(n));
  if (unresolved.length) {
    failed++;
    console.error(`✗ ${consumer} references CSS variables with no definition:\n` +
      unresolved.map((n) => `    --${n}`).join('\n') + '\n' +
      `  They resolve neither locally nor in ${SOURCE}: a token was likely renamed or removed\n` +
      `  there. Re-point the reference in ${consumer}, or restore the token.`);
  } else {
    console.log(`✓ every var() in ${consumer} resolves to a defined token`);
  }
}
process.exit(failed ? 1 : 0);
