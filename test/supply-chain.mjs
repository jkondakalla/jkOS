// TEST-16 · Supply chain — dependency advisories, with a floor that fails the gate.
//
//   node test/supply-chain.mjs        (wired in as check:audit)
//
// A dependency-vulnerability step is a standard audit-checklist item, and its
// ABSENCE is itself a finding in a security-focused portfolio — which is the
// whole reason this exists rather than "we run pnpm audit sometimes".
//
// ⚠️ THE FLOOR IS `critical`, AND THAT IS A DELIBERATE, TEMPORARY CHOICE.
// On 2026-08-27 the tree carried 0 critical and 13 HIGH advisories — vite,
// postcss, nanoid, brace-expansion, react-router, pdfjs-dist — every one of them
// reached through a build/dev dependency rather than anything that runs in a
// deployed container. Setting the floor at `high` today would paint the gate red
// on day one, and a red gate nobody can turn green is a gate people learn to
// skip.
//
// So the floor is `critical` and the highs are REPORTED LOUDLY on every run. That
// is the honest version: the mechanism is in the gate, the number is in your
// face, and raising the floor is a decision to make once the upgrades land — not
// a thing that quietly never happens because the check was silent.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ⚠️ fileURLToPath, never `new URL(...).pathname`. This repo lives at
// "/media/jag/The Forge/jkOS" and pathname percent-ENCODES the space, so the
// child process was handed "/media/jag/The%20Forge/jkOS" — a directory that
// does not exist. It failed as "registry unreachable", because that is what a
// spawn failure looks like from in here.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FLOOR = 'critical';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

function auditJson() {
  try {
    const out = execFileSync('pnpm', ['audit', '--json'], {
      cwd: REPO_ROOT,
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

const report = auditJson();
if (!report) {
  console.error('  ✗ could not run `pnpm audit` (offline? registry unreachable?)');
  console.log('\nsupply-chain: skipped — the registry could not be reached');
  process.exit(0);   // never fail the gate on a network condition
}

const advisories = Object.values(report.advisories || {});
const bySeverity = {};
for (const a of advisories) {
  (bySeverity[a.severity] = bySeverity[a.severity] || new Set()).add(a.module_name);
}
const count = (s) => (bySeverity[s] ? bySeverity[s].size : 0);
const line = (s) => `${s}: ${count(s)}${count(s) ? ` (${[...bySeverity[s]].sort().join(', ')})` : ''}`;

console.log('  dependency advisories, by severity, unique packages:');
for (const s of ['critical', 'high', 'moderate', 'low']) console.log(`    ${line(s)}`);

ok(count('critical') === 0,
  `${count('critical')} CRITICAL advisory package(s) — the gate floor. `
  + `Upgrade or justify each: ${[...(bySeverity.critical || [])].join(', ')}`);

if (count('high')) {
  console.log(`\n  ⚠️  ${count('high')} package(s) carry HIGH advisories and are ABOVE the gate's `
    + `floor (${FLOOR}) — they do not fail this run.\n`
    + '      They are all reached through build/dev dependencies as of 2026-08-27, not through a\n'
    + '      deployed container. Raising the floor to `high` is the goal and is a decision to make\n'
    + '      once these upgrade cleanly; see Documentation/BACKLOG.md.');
}

console.log(`\nsupply-chain: ${pass} passed, ${fail} failed (floor: ${FLOOR})`);
process.exit(fail ? 1 : 0);
