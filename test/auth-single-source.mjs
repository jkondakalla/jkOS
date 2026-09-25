// Auth single-source — one session state machine for the whole suite.
//
// ORDECK wrote the auth gate (identity check → refresh-cookie rotation → declare
// logged-out). Two apps copied the file, one header
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
//   3. No app source file re-declares the state machine: every app imports the gate
//      straight from @jkos/auth-client, and none defines useAuth/useAuthProvider, makes
//      an auth context, or drives getMe/refreshToken itself.
//   4. Logout is one function that always redirects, and no app hand-rolls its own.
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
// Until 2026-09-25 each app kept a hooks/useAuth re-export and this check read those two
// files — so a fork written in ANY other file passed. The re-exports are gone (apps import
// from @jkos/auth-client), and the scan is every tracked source file under apps/*/src.
const { execFileSync } = await import('node:child_process');
const appSources = execFileSync('git', ['ls-files', '-z', '--', 'apps/*/src/*.ts', 'apps/*/src/*.tsx'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (appSources.length < 50) fail(`the app-source scan found ${appSources.length} files — the scan is blind, not clean`);
const FORKS = [
  [/\bfunction\s+useAuth(Provider)?\b|\b(const|let)\s+useAuth(Provider)?\s*=/, 'defines its own useAuth/useAuthProvider'],
  [/\bcreateContext\s*<[^>]*Auth/, 'creates its own auth context'],
  [/\b(getMe|refreshToken)\s*\(/, 'drives the bootstrap primitives (getMe/refreshToken) itself'],
];
let forks = 0;
for (const path of appSources) {
  const body = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const [re, what] of FORKS) {
    if (re.test(body)) { forks++; fail(`${path} ${what} — the gate lives in @jkos/auth-client; import it`); }
  }
}
const guards = appSources.filter((p) => /\/AuthGuard\.tsx$/.test(p));
for (const g of guards) {
  if (!/import\s*\{[^}]*\buseAuthProvider\b[^}]*\}\s*from\s*['"]@jkos\/auth-client['"]/.test(read(g))) {
    forks++; fail(`${g} does not take useAuthProvider from @jkos/auth-client`);
  }
}
if (!forks) ok(`no app re-declares the auth gate (${appSources.length} app source files scanned; ${guards.length} AuthGuards import it from @jkos/auth-client)`);

// ── 4. Logout is one function, and it always leaves ─────────────────────────
// It was three: @jkos/auth-client's logout(), which nothing called and which awaited the
// POST bare (a network failure rejected before the redirect, so "Log out" did nothing),
// and two hand-rolled copies. BeigeBoard's is gone; the SettingsDrawer in @jkos/ui keeps
// its own because @jkos/ui cannot depend on @jkos/auth-client (it is the one exemption).
{
  const client = read('packages/auth-client/src/client.ts');
  const fn = (/export async function logout\(\)[^{]*\{([\s\S]*?)\n\}/.exec(client) || [])[1] || '';
  const guarded = /try\s*\{[^}]*fetch\([^)]*\/auth\/logout[\s\S]*?\}\s*catch\b/.test(fn);
  const after = fn.slice(fn.lastIndexOf('catch'));
  if (guarded && /window\.location\.href\s*=/.test(after)) {
    ok('auth-client logout() redirects whether or not the POST succeeds');
  } else {
    fail('auth-client logout() must wrap its POST in try/catch and redirect AFTER it — a failed request must not strand the user signed in');
  }
  // git grep exits 1 on no match — that is an empty list here, not an error.
  const grep = (...args) => { try { return execFileSync('git', ['grep', ...args], { cwd: root, encoding: 'utf8' }); } catch (e) { if (e.status === 1) return ''; throw e; } };
  const all = grep('-l', '/auth/logout', '--', ':(glob)apps/*/src/**', ':(glob)packages/*/src/**').split('\n').filter(Boolean);
  if (!all.includes('packages/auth-client/src/client.ts')) fail('the logout scan cannot see auth-client itself — the scan is blind, not clean');
  // Frontends only: jkAuth is the server that SERVES the route, and the prober lists it.
  const hits = all.filter((p) => !p.startsWith('apps/jkauth/') && !p.startsWith('packages/suite-prober/'))
    .filter((p) => p !== 'packages/auth-client/src/client.ts' && p !== 'packages/ui/src/SettingsDrawer.tsx');
  if (hits.length) fail(`hand-rolled POST /auth/logout outside @jkos/auth-client: ${hits.join(', ')} — call logout()`);
  else ok('no app hand-rolls POST /auth/logout (auth-client logout(), plus the ui drawer that cannot import it)');
}

if (failed) {
  console.error(`\n✗ auth single-source: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ auth single-source: one session state machine, imported by every app that gates on it');
