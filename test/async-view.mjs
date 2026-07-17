// AsyncView conformance (ToDo.md §3 Wave 20, item 20.3) — keeps the loading/
// error/empty triad on ONE component.
//
// Three PapyrOS views hand-rolled the same triad three different ways: Library.tsx
// (a 3-way ternary), BookDetail.tsx (two independent `&&` guards), OfflineSettings.tsx
// (an empty-only ternary through its own bespoke `.offline-empty` class). Nothing in
// the build stops a future view from hand-rolling a fourth variant, so this asserts:
//
//   1. @jkos/ui/src/AsyncView.tsx exists, exports `AsyncView` + `AsyncViewProps`
//      with the loading/error/empty/children shape the three real call sites need.
//   2. @jkos/ui/src/index.ts re-exports both — the barrel is the only sanctioned
//      import path.
//   3. AsyncView.tsx stays decoupled: no import from @jkos/auth-client or
//      @jkos/weave (the same structural-typing contract AppShell/SettingsDrawer
//      already hold @jkos/ui to).
//   4. hub.css ships `.jk-async-note` / `.jk-async-error`, token-hygiene clean (no
//      hardcoded hex — every colour a var()).
//   5. All three migrated PapyrOS files import AsyncView from '@jkos/ui' and
//      actually render a `<AsyncView` — not a re-implementation.
//   6. The old hand-rolled triads are GONE — the exact ternary/guard shapes that
//      used to dispatch loading/error/empty can't quietly regrow next to the new
//      component.
//
// Run:  node test/async-view.mjs   (wired as `pnpm check:async-view`, folded into
//                                   `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ── 1. AsyncView.tsx exists with the derived props shape ─────────────────── */
const ASYNC_VIEW = 'packages/ui/src/AsyncView.tsx';
let asyncSrc;
try {
  asyncSrc = read(ASYNC_VIEW);
} catch {
  fail(`${ASYNC_VIEW} does not exist`);
}
if (asyncSrc) {
  if (/export\s+function\s+AsyncView\b/.test(asyncSrc)) {
    ok(`${ASYNC_VIEW} exports AsyncView`);
  } else {
    fail(`${ASYNC_VIEW} no longer exports a function AsyncView`);
  }
  const propsBlock = asyncSrc.match(/interface\s+AsyncViewProps\s*\{([\s\S]*?)\n\}/);
  if (!propsBlock) {
    fail(`${ASYNC_VIEW} is missing the AsyncViewProps interface`);
  } else {
    const props = propsBlock[1];
    for (const name of ['loading', 'error', 'empty', 'children']) {
      const re = new RegExp(`\\b${name}\\??:`);
      if (re.test(props)) ok(`AsyncViewProps declares \`${name}\``);
      else fail(`AsyncViewProps is missing \`${name}\` — the triad this item derives its shape from`);
    }
  }

  // ── 3. decoupling — @jkos/ui must never import app-coupled packages ────────
  const stripped = stripComments(asyncSrc);
  const COUPLED = ['@jkos/auth-client', '@jkos/weave'];
  const leaked = COUPLED.filter((pkg) => stripped.includes(pkg));
  if (leaked.length) {
    fail(`${ASYNC_VIEW} imports coupled package(s) ${leaked.join(', ')} — @jkos/ui must stay decoupled`);
  } else {
    ok(`${ASYNC_VIEW} stays decoupled from @jkos/auth-client / @jkos/weave`);
  }
}

/* ── 2. index.ts re-exports the component + its type ───────────────────────── */
const barrel = read('packages/ui/src/index.ts');
if (/export\s*\{\s*AsyncView\s*\}\s*from\s*'\.\/AsyncView'/.test(barrel)) {
  ok('index.ts exports AsyncView from ./AsyncView');
} else {
  fail("index.ts does not export { AsyncView } from './AsyncView'");
}
if (/export\s+type\s*\{\s*AsyncViewProps\s*\}\s*from\s*'\.\/AsyncView'/.test(barrel)) {
  ok('index.ts exports the AsyncViewProps type from ./AsyncView');
} else {
  fail("index.ts does not export type { AsyncViewProps } from './AsyncView'");
}

/* ── 4. hub.css token hygiene for the new classes ───────────────────────────── */
const hub = read('packages/design/tokens/hub.css');
const hubNoComments = hub.replace(/\/\*[\s\S]*?\*\//g, '');
const noteBlock = hubNoComments.match(/\.jk-async-note\s*\{([^}]*)\}/);
const errorBlock = hubNoComments.match(/\.jk-async-error\s*\{([^}]*)\}/);
if (!noteBlock) {
  fail('hub.css is missing the .jk-async-note rule');
} else if (/#[0-9a-fA-F]{3,8}\b/.test(noteBlock[1])) {
  fail('.jk-async-note has a hardcoded hex colour — use a --hub-*/--color-* token');
} else {
  ok('hub.css ships .jk-async-note, hex-free');
}
if (!errorBlock) {
  fail('hub.css is missing the .jk-async-error rule');
} else if (/#[0-9a-fA-F]{3,8}\b/.test(errorBlock[1])) {
  fail('.jk-async-error has a hardcoded hex colour — use a --hub-*/--color-* token');
} else if (!/var\(--hub-red/.test(errorBlock[1])) {
  fail('.jk-async-error does not derive its tint from --hub-red — check hub.css');
} else {
  ok('hub.css ships .jk-async-error, tinted from --hub-red, hex-free');
}

/* ── 5 & 6. the three PapyrOS call sites actually migrated ──────────────────── */
const CALL_SITES = {
  'apps/papyros/src/views/Library.tsx': {
    // The old 3-way ternary head that used to dispatch loading/error/empty.
    retired: [/\{\s*loading\s*\?\s*\(/],
  },
  'apps/papyros/src/views/BookDetail.tsx': {
    retired: [/\{error\s*&&\s*<p className="muted">/, /\{!error\s*&&\s*!book\s*&&/],
  },
  'apps/papyros/src/offline/OfflineSettings.tsx': {
    retired: [/books\.length === 0 \? \(/],
  },
};
for (const [file, { retired }] of Object.entries(CALL_SITES)) {
  const src = read(file);
  const code = stripComments(src);
  const importMatch = code.match(/import\s*\{([^}]*)\}\s*from\s*'@jkos\/ui'/);
  if (importMatch && /\bAsyncView\b/.test(importMatch[1])) {
    ok(`${file} imports AsyncView from '@jkos/ui'`);
  } else {
    fail(`${file} does not import AsyncView from '@jkos/ui'`);
  }
  if (/<AsyncView\b/.test(code)) {
    ok(`${file} renders <AsyncView`);
  } else {
    fail(`${file} imports AsyncView but never renders it`);
  }
  for (const re of retired) {
    if (re.test(code)) {
      fail(`${file} still has the retired hand-rolled pattern ${re} — should now route through <AsyncView>`);
    } else {
      ok(`${file} has no trace of the retired pattern ${re}`);
    }
  }
}

// The dead .offline-empty rule must not quietly come back (OfflineSettings no
// longer references its own bespoke empty-state class — it uses AsyncView's).
const offlineCss = read('apps/papyros/src/offline/offline.css');
if (/\.offline-empty\b/.test(offlineCss)) {
  fail('offline.css still defines .offline-empty — dead now that OfflineSettings uses <AsyncView>');
} else {
  ok('offline.css dropped the superseded .offline-empty rule');
}

if (failed) {
  console.error(`\n${failed} AsyncView conformance check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ AsyncView conformance: one component owns the loading/error/empty triad');
