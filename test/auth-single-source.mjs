// Auth single-source — one session state machine for the whole suite.
//
// ORDECK wrote the auth gate (identity check → refresh-cookie rotation → declare
// logged-out). PapyrOS copied the file; KourOS then copied PapyrOS's, its header
// admitting it mirrored the original "verbatim" — which it did, byte for byte apart
// from the comments. Three copies of a token-refresh sequence is three places for a
// session bug to be fixed in two of them, and the bug class is nasty: drop the
// middle refresh step in ONE copy and that app silently logs out every returning
// user whose 15-minute access token lapsed while the tab was shut.
//
// They now share @jkos/auth-client's useAuthProvider. Nothing in the build forces
// them to keep sharing it, so this asserts:
//
//   1. @jkos/auth-client owns the primitive and exports it through the barrel.
//   2. The bootstrap ORDER survives in the one shared copy: getMe → refreshToken →
//      getMe again → only then 'unauthenticated'. This is the step a rewrite drops.
//   3. Each app's hooks/useAuth stays a THIN re-export — it must not re-declare the
//      state machine (no useState/useEffect/createContext of its own).
//
// Run:  node test/auth-single-source.mjs   (wired as `pnpm check:auth`, folded into
//                                           `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const PRIMITIVE = 'packages/auth-client/src/useAuthProvider.ts';
const BARREL = 'packages/auth-client/src/index.ts';
const CONSUMERS = {
  ORDECK:  'apps/ordeck/src/hooks/useAuth.ts',
  PapyrOS: 'apps/papyros/src/hooks/useAuth.ts',
  KourOS:  'apps/kouros/src/hooks/useAuth.ts',
};

// ── 1. The primitive exists and is exported through the barrel ──────────────
const prim = read(PRIMITIVE);
const NEEDED = ['useAuthProvider', 'useAuth', 'authContext', 'AuthState', 'AuthContextValue'];
const missing = NEEDED.filter((n) => !new RegExp(`export\\b[^\\n]*\\b${n}\\b`).test(prim));
if (missing.length === 0) ok('useAuthProvider.ts exports useAuthProvider/useAuth/authContext + the state types');
else fail(`${PRIMITIVE} is missing exports: ${missing.join(', ')} — the one auth source is incomplete`);

if (/export \* from '\.\/useAuthProvider'/.test(read(BARREL))) {
  ok('@jkos/auth-client barrel re-exports ./useAuthProvider');
} else {
  fail(`${BARREL} does not re-export ./useAuthProvider — consumers cannot reach the shared hook`);
}

// ── 2. The bootstrap order survives (the step a rewrite silently drops) ─────
// Strip comments first so prose about the sequence can't satisfy the check.
// Anchor on the CALLS, not the bare names: the AuthState union up top names
// 'unauthenticated' long before any function body, and the import line names getMe.
const code = prim.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const iFetch = code.indexOf('getMe(');
const iRefresh = code.indexOf('refreshToken(');
const iUnauth = code.search(/setState\(\s*\{\s*status:\s*'unauthenticated'/);
if (iFetch >= 0 && iRefresh > iFetch && iUnauth > iRefresh) {
  ok("bootstrap keeps its order: getMe → refreshToken → retry → 'unauthenticated' last");
} else {
  fail(
    'the shared bootstrap no longer reads getMe → refreshToken → unauthenticated. ' +
    'If the refresh-and-retry step was dropped, every returning user with a lapsed ' +
    'access token gets logged out instead of silently renewed.',
  );
}

// ── 3. No app re-declares the state machine ─────────────────────────────────
for (const [app, path] of Object.entries(CONSUMERS)) {
  const src = read(path);
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  if (!/from\s+['"]@jkos\/auth-client['"]/.test(body)) {
    fail(`${app} (${path}) does not source its auth from @jkos/auth-client — it forked the gate again`);
    continue;
  }
  const forked = ['useState', 'useEffect', 'createContext'].filter((h) => new RegExp(`\\b${h}\\s*[(<]`).test(body));
  if (forked.length) {
    fail(`${app} (${path}) re-declares the state machine locally (${forked.join(', ')}) instead of re-exporting`);
  } else {
    ok(`${app}'s hooks/useAuth is a thin re-export (${body.trim().split('\n').length} lines of code)`);
  }
}

if (failed) {
  console.error(`\n✗ auth single-source: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ auth single-source: one session state machine, three thin re-exports');
