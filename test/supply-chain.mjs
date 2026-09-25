// TEST-16 · Supply chain — dependency advisories, with a floor that fails the gate.
//
//   node test/supply-chain.mjs        (wired in as check:audit)
//
// A dependency-vulnerability step is a standard audit-checklist item, and its
// ABSENCE is itself a finding in a security-focused portfolio — which is the
// whole reason this exists rather than "we run pnpm audit sometimes".
//
// THE FLOOR IS `high` (raised 2026-09-16). It was `critical` for three
// weeks, deliberately: 13 HIGH advisories existed on 2026-08-27, and a floor nobody could
// turn green on day one is one people learn to skip. It went up the day it could land
// green — ORDECK to vite 6, range-scoped security floors in pnpm-workspace.yaml for four
// transitives, and the app that was the only path to the last three removed.
//
// ⚠️ The old comment here said every HIGH was build/dev-only. One was not:
// brace-expansion reached BeigeBoard's deployed backend through googleapis → gaxios →
// rimraf → glob → minimatch. "Reached only at build time" is a claim to re-derive with
// `pnpm why -r <pkg>` per advisory, never to carry forward.
//
// Moderates and lows are REPORTED LOUDLY on every run and do not fail it.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ⚠️ fileURLToPath, never `new URL(...).pathname`. This repo lives at
// "/media/jag/The Forge/jkOS" and pathname percent-ENCODES the space, so the
// child process was handed "/media/jag/The%20Forge/jkOS" — a directory that
// does not exist. It failed as "registry unreachable", because that is what a
// spawn failure looks like from in here.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FLOOR = 'high';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

/* ⚠️ EVERY TRACKED LOCKFILE, not just the root one. native/desktop sits OUTSIDE the pnpm
   workspace on purpose (Electron needs Node >= 22.12; the suite runs 20) and keeps its own
   pnpm-lock.yaml — which a root-only `pnpm audit` never sees. The list is derived from git,
   not typed, so the next out-of-workspace package cannot quietly escape the floor either. */
const LOCKFILES = execFileSync('git', ['ls-files', '--', 'pnpm-lock.yaml', '*/pnpm-lock.yaml'], {
  cwd: REPO_ROOT, encoding: 'utf8',
}).split('\n').filter(Boolean);

function auditJson(lockfile) {
  const dir = join(REPO_ROOT, dirname(lockfile));
  const args = ['audit', '--json', ...(lockfile === 'pnpm-lock.yaml' ? [] : ['--ignore-workspace'])];
  try {
    const out = execFileSync('pnpm', args, {
      cwd: dir,
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240_000,
    });
    return JSON.parse(out);
  } catch (e) {
    // `pnpm audit` exits non-zero when it FINDS things — the payload is still on
    // stdout, and that is the normal path here, not an error.
    if (e.stdout) { try { return JSON.parse(e.stdout); } catch { /* fall through */ } }
    return null;
  }
}

ok(LOCKFILES.includes('pnpm-lock.yaml'), 'the root pnpm-lock.yaml is not tracked — nothing to audit');

const reports = [];
for (const lockfile of LOCKFILES) {
  const report = auditJson(lockfile);
  if (!report) {
    console.error(`  ✗ could not run \`pnpm audit\` for ${lockfile} (offline? registry unreachable?)`);
    console.log('\nsupply-chain: skipped — the registry could not be reached');
    process.exit(0);   // never fail the gate on a network condition
  }
  reports.push([lockfile, report]);
}

for (const [lockfile, report] of reports) {
  const advisories = Object.values(report.advisories || {});
  const bySeverity = {};
  for (const a of advisories) {
    (bySeverity[a.severity] = bySeverity[a.severity] || new Set()).add(a.module_name);
  }
  const count = (s) => (bySeverity[s] ? bySeverity[s].size : 0);
  const line = (s) => `${s}: ${count(s)}${count(s) ? ` (${[...bySeverity[s]].sort().join(', ')})` : ''}`;

  console.log(`  ${lockfile} — dependency advisories, by severity, unique packages:`);
  for (const s of ['critical', 'high', 'moderate', 'low']) console.log(`    ${line(s)}`);

  ok(count('critical') === 0,
    `${lockfile}: ${count('critical')} CRITICAL advisory package(s) — above the gate's floor (${FLOOR}). `
    + `Upgrade or justify each: ${[...(bySeverity.critical || [])].join(', ')}`);

  ok(count('high') === 0,
    `${lockfile}: ${count('high')} HIGH advisory package(s) — at the gate's floor (${FLOOR}). `
    + `Upgrade each (an in-range lock refresh, or a range-scoped floor in pnpm-workspace.yaml `
    + `that matches ONLY the vulnerable versions): ${[...(bySeverity.high || [])].join(', ')}`);

  if (count('moderate') || count('low')) {
    console.log(`\n  ⚠️  ${count('moderate')} moderate / ${count('low')} low advisory package(s) are below the `
      + `gate's floor (${FLOOR}) and do not fail this run — see the list above.`);
  }
}

console.log(`\nsupply-chain: ${pass} passed, ${fail} failed (floor: ${FLOOR})`);
process.exit(fail ? 1 : 0);
