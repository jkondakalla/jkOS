// Cards-kit purity gate (ARCH-4) — keeps @jkos/cards app-agnostic so the SAME
// components render correctly in BeigeBoard's tabs AND ORDECK's widgets.
//
// The kit regressed three ways (BUG-4), each invisible until it mounted outside
// BeigeBoard:
//   1. A hardcoded `source: 'bb'` stamped BeigeBoard's identity on every kit-created
//      event — an ORDECK-created item would be mis-attributed.
//   2. Host-only CSS classes (bb-*, task-row, btn-action, day-chip) styled the kit
//      only where BeigeBoard's app.css was loaded → ORDECK mounted it unstyled.
//   3. `${color}66` hex-alpha concat produced invalid CSS (silently dropped) whenever
//      `color` was a CSS var rather than a bare hex → glow/shadow just vanished.
//
// This text-scans the kit (and its sibling @jkos/ui, which shares the alpha hazard)
// and fails on any of the three patterns. App-level code (apps/beigeboard) owns its
// own render context and is out of scope — the boundary this enforces is the KIT.
//
// Run:  node test/cards-purity.mjs   (wired as `pnpm check:cards`, folded into
//                                     `pnpm test:contracts`).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// Recursively collect .ts/.tsx under a dir.
function sources(dir) {
  const out = [];
  for (const ent of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// Strip // line and /* block */ comments so doc examples ('beigeboard', bb-*)
// don't trip the scan — we only judge live code.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const KIT = sources('packages/cards/src');
const KIT_AND_UI = [...KIT, ...sources('packages/ui/src')];

// 1 · No app-id literals in the kit (source/app addressed by injected props/AppId).
const APP_ID = /\b(?:source|app|appId)\s*:\s*['"](?:bb|beigeboard)['"]/;
const BARE_APP_ID = /['"](?:beigeboard)['"]/; // 'bb' is too generic to ban bare
for (const f of KIT) {
  const code = stripComments(readFileSync(resolve(root, f), 'utf8'));
  if (APP_ID.test(code)) fail(`${f}: hardcoded app-id (source/app: 'bb'|'beigeboard') — inject it via a prop`);
  if (BARE_APP_ID.test(code)) fail(`${f}: 'beigeboard' literal in the kit — the kit must stay app-agnostic`);
}
ok(`no app-id literals in ${KIT.length} kit files`);

// 2 · No host-only CSS classes in the kit (styling must ship with the kit, via
//     hub.css .jk-cards-* primitives — not a host app.css).
const HOST_CLASS = /className\s*=\s*["'`][^"'`]*\b(?:bb-[\w-]+|task-row|btn-action|day-chip|event-chip)\b/;
for (const f of KIT) {
  const code = stripComments(readFileSync(resolve(root, f), 'utf8'));
  if (HOST_CLASS.test(code)) fail(`${f}: host-only CSS class (bb-*/task-row/btn-action/day-chip) — use a kit-owned .jk-cards-* class`);
}
ok('no host-only CSS classes in the kit');

// 3 · No hex-alpha concat on interpolated colours (breaks for CSS vars). The one
//     blessed path is withAlpha() from @jkos/design.
const ALPHA_CONCAT = /\$\{[^}]+\}[0-9a-fA-F]{2}(?![0-9a-fA-F])/;
for (const f of KIT_AND_UI) {
  const code = stripComments(readFileSync(resolve(root, f), 'utf8'));
  for (const line of code.split('\n')) {
    if (ALPHA_CONCAT.test(line) && /background|shadow|border|color|fill|stroke|drop-shadow|`/.test(line)) {
      // Only flag lines that look like CSS colour usage inside a template literal.
      if (/`[^`]*\$\{[^}]+\}[0-9a-fA-F]{2}/.test(line)) {
        fail(`${f}: hex-alpha concat \`\${x}NN\` — invalid for CSS vars, use withAlpha(x, fraction)`);
      }
    }
  }
}
ok(`no hex-alpha concat across ${KIT_AND_UI.length} kit+ui files`);

// 4 · withAlpha is a real exported helper (the sanctioned replacement exists).
const designBarrel = readFileSync(resolve(root, 'packages/design/index.ts'), 'utf8');
if (!/export\s*\{\s*withAlpha\s*\}/.test(designBarrel)) {
  fail('packages/design/index.ts no longer exports withAlpha — the alpha ban has no escape hatch');
} else {
  ok('withAlpha is exported from @jkos/design');
}

if (failed) {
  console.error(`\n✗ cards-purity: ${failed} violation(s)`);
  process.exit(1);
}
console.log('\n✓ cards-purity: kit is app-agnostic');
