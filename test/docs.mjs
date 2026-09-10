#!/usr/bin/env node
/**
 * TEST-19 · The docs inventory covers the gate.
 *
 * ⚠️ THIS EXISTS BECAUSE THE TEST INVENTORY HAD BEEN WRONG FOR MONTHS AND
 * NOTHING COULD SEE IT. `TESTING.md` is the answer to "what does this suite
 * test", and a 2026-09-08 review found it silently missing FIVE suites —
 * `security.mjs` (55 assertions) and `account.mjs` (39), the two that Stage C
 * added and that hold the session-lifecycle and account-recovery work;
 * `discover.smoke.mjs` (26), the only coverage of the music vector seam; and
 * weave's `libraryScanner.mjs` (53) and `resumeCursor.mjs`. 170+ assertions ran
 * on every green gate and appeared in no document.
 *
 * That is the same defect class the 2026-08-31 audit found in three probes: a
 * report that is confidently clean about the things it happens to enumerate,
 * which from outside is indistinguishable from a report that is clean about the
 * suite. A doc cannot be trusted as a map while nothing holds it to the terrain.
 *
 * WHAT IS CHECKED, AND WHAT DELIBERATELY IS NOT:
 *
 *   ✅ Every test file the gate actually RUNS is named in TESTING.md.
 *   ✅ Every `check:*` script in the root package.json is named in PRIMITIVES.md.
 *   ❌ Assertion COUNTS are not pinned, on purpose.
 *
 * ⚠️ Pinning counts would paint the gate red on every added assertion — the
 * "red gate nobody can turn green is one people learn to skip" failure the
 * supply-chain floor is already reasoned about. Counts drift benignly and are
 * corrected when someone looks. A whole suite going unmentioned is the defect
 * that hides, so that is the one held.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const pkg = p => JSON.parse(read(p));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}${extra ? `  ${extra}` : ''}`); }
};

// ── Which test files does the gate actually run? ─────────────────────────────
// Follow root `test:contracts` → each `pnpm --filter <pkg> <script>` → that
// package's own script → the `node <file>` invocations inside it. Derived, never
// re-typed: a list maintained by hand here would rot exactly like the doc did.
const root = pkg('package.json');
const WORKSPACES = ['apps/jkauth', 'apps/beigeboard/backend', 'apps/lazuros/backend',
  'apps/papyros/backend', 'apps/kouros/backend', 'packages/weave', 'packages/player',
  'packages/files', 'packages/routine-spec'];

const byName = new Map();
for (const dir of WORKSPACES) {
  try { byName.set(pkg(join(dir, 'package.json')).name, dir); } catch { /* absent */ }
}

/** `node test/x.mjs && node test/y.mjs` → ['test/x.mjs','test/y.mjs'] */
const nodeFiles = script => [...String(script ?? '').matchAll(/node\s+([\w./-]+\.(?:mjs|js|py))/g)].map(m => m[1]);

const runFiles = new Set();          // repo-relative paths of every test file the gate runs
const chain = root.scripts['test:contracts'];

for (const m of chain.matchAll(/pnpm --filter (\S+) ([\w:]+)/g)) {
  const [, name, script] = m;
  const dir = byName.get(name);
  if (!dir) { ok(`workspace ${name} is known to this check`, false, '— add it to WORKSPACES'); continue; }
  const sub = pkg(join(dir, 'package.json')).scripts?.[script];
  ok(`${name} defines the '${script}' script the gate calls`, !!sub);
  for (const f of nodeFiles(sub)) runFiles.add(`${dir}/${f}`);
}
// Root-level `node …` links in the chain itself (roundtrip, test:cards, check:*).
for (const f of nodeFiles(chain)) runFiles.add(f);
for (const key of Object.keys(root.scripts)) {
  if (key.startsWith('check:') || key === 'test:cards' || key === 'prove' || key === 'roundtrip') {
    for (const f of nodeFiles(root.scripts[key])) runFiles.add(f);
  }
}

// ── 1 · TESTING.md names every suite the gate runs ───────────────────────────
const testing = read('Documentation/TESTING.md');

// Only the per-app SUITES belong in TESTING.md's inventory tables; the `check:*`
// scripts are catalogued by name there and by command in PRIMITIVES.md, so they
// are held by check 2 instead of being demanded twice in two shapes.
const suites = [...runFiles].filter(f => /\/test\//.test(f) && !f.startsWith('test/'));

for (const f of suites.sort()) {
  const base = basename(f);
  ok(`TESTING.md names ${base} (${f})`, testing.includes(base),
    '— a suite that runs on every green gate and appears in no document');
}

// ── 2 · PRIMITIVES.md names every check:* command ────────────────────────────
const primitives = read('Documentation/PRIMITIVES.md');
const checks = Object.keys(root.scripts).filter(k => k.startsWith('check:'));
// ⚠️ The §2.2 ROW is what is required, not a mention anywhere in the file.
// A first pass asserted `primitives.includes(c)` and a planted deletion of
// `check:columns`'s row sailed past it — the name still appeared in §1's
// one-line roster, so the check reported clean while the table that says what
// the gate ASSERTS had lost its entry. "Mentioned somewhere" is not a catalog.
for (const c of checks.sort()) {
  ok(`PRIMITIVES.md §2.2 has a row for ${c}`, primitives.includes(`\`pnpm ${c}\` |`),
    '— a gate the suite runs that its own command catalog does not describe');
}

// ⚠️ The COUNT is asserted, not just the membership. PRIMITIVES.md said
// "Fifteen individual conformance gates" while the suite ran 23 — a sentence
// that was true when written and became false eight gates later, with every one
// of those eight still findable elsewhere in the file. Membership alone cannot
// catch a stale summary; this can.
ok(`PRIMITIVES.md's gate count matches the ${checks.length} check:* scripts`,
  new RegExp(`\\b${checks.length}\\b[^.\\n]{0,60}conformance gates`, 'i').test(primitives)
  || primitives.includes(`${checks.length} individual conformance gates`),
  `— expected the catalog to say ${checks.length}`);

// ── 2b · Generated docs match their generator ────────────────────────────────
// ROUTINE_PROMPT.md is EMITTED by print-prompt.mjs from the routine vocabulary —
// that is the whole point of it (it cannot promise something the validator
// refuses). A hand edit, or a vocabulary change without a regen, desynchronises
// it silently: the prompt keeps looking authoritative while telling an author
// about fields the engine no longer accepts.
{
  const { execFileSync } = await import('node:child_process');
  let generated = null;
  try {
    generated = execFileSync(process.execPath,
      [join(ROOT, 'apps/beigeboard/backend/scripts/print-prompt.mjs')],
      { encoding: 'utf8', cwd: ROOT });
  } catch (e) {
    ok('ROUTINE_PROMPT.md generator runs', false, `— ${e.message.split('\n')[0]}`);
  }
  if (generated !== null) {
    ok('ROUTINE_PROMPT.md matches `print-prompt.mjs` output',
      generated === read('Documentation/ROUTINE_PROMPT.md'),
      '— regenerate it; do not hand-edit generated output');
  }
}

// ── 3 · README.md's index lists every doc ────────────────────────────────────
// The same defect as TESTING.md's missing suites, one level up: the index that
// tells a cold reader which file to open was missing KOUROS_ANDROID.md,
// LAZUROS_STARTUP.md and ROUTINE_PROMPT.md. A doc nothing points at is a doc
// nobody opens.
const readme = read('Documentation/README.md');
const { readdirSync } = await import('node:fs');
for (const f of readdirSync(join(ROOT, 'Documentation')).filter(f => f.endsWith('.md') && f !== 'README.md').sort()) {
  ok(`README.md's index links ${f}`, readme.includes(`(${f})`),
    '— a reference doc the index does not point at');
}

// ── 4 · README.md's trap count matches TRAPS.md ──────────────────────────────
// ⚠️ WHY THIS COUNT IS PINNED WHEN ASSERTION COUNTS ARE NOT. The line is
// whether the number moves as a SIDE EFFECT of ordinary work or as a
// documentation act in its own right. Adding an assertion happens constantly
// while fixing something else, so pinning it would redden the gate for reasons
// nobody wants to think about. Adding a trap — or a `check:*` gate — IS the
// documentation act; being told to update the headline in the same commit is
// the point, not friction.
const trapCount = (read('Documentation/TRAPS.md').match(/^- \*\*/gm) ?? []).length;
ok(`README.md's trap count matches TRAPS.md's ${trapCount} entries`,
  new RegExp(`\\b${trapCount} durable traps\\b`).test(readme),
  `— README says something other than ${trapCount}`);

// ── 3 · Every doc-cited repo path exists ─────────────────────────────────────
// The cheap half of a doc review, and the half a human reviewer reliably skips.
// Paths under `music/` that the pulsarmap backlog PLANS are exempted by name;
// everything else must resolve.
const PLANNED = new Set(['music/mesh.py', 'music/meshes.db', 'music/meshd.py']);
// Paths a doc cites precisely BECAUSE they do not exist (a recorded defect).
// Paths a doc cites precisely BECAUSE they are absent, or that the OPERATOR
// creates rather than the repo. `apps/lazuros/deployment.json` is the second
// kind and LAZUROS_STARTUP.md's whole point about it is that Docker silently
// makes a DIRECTORY when it is missing — the citation is the warning.
const CITED_AS_ABSENT = new Set([
  'apps/lazuros/backend/src',                  // check:today named a root that never existed
  'apps/lazuros/docker-compose.staging.yml',   // the doc says, correctly, that there is none
  'apps/lazuros/deployment.json',              // operator-created, gitignored; see LAZUROS_STARTUP.md
]);
// ⚠️ Alternation order is load-bearing: `js` before `json` truncates every
// `package.json` to a `package.js` that does not exist, and `ts` before `tsx`
// does the same to every component. Longest extension first. My first pass had
// it the obvious way round and invented 12 broken references that were fine.
// ⚠️ The `\.\.\/` alternative is not cosmetic. Docs link peers as `../apps/x.js`
// (relative to Documentation/), and a lookbehind that merely rejects a preceding
// `/` skips every one of them — which is exactly how ALGORITHMS.md went on
// pointing at two files D9 had deleted while this check reported clean.
const PATH_RE = /(?<![\w/.])((?:\.\.\/)?(?:apps|packages|infra|jkos-deploy)\/[A-Za-z0-9_./-]+\.(?:mjs|tsx|json|js|ts|css|py|conf|yml|md))(?![A-Za-z0-9])/g;
const { existsSync } = await import('node:fs');
const docs = ['ALGORITHMS', 'ARCHITECTURE', 'BACKLOG', 'DESIGN', 'OPERATIONS', 'PRIMITIVES',
  'README', 'RESET', 'ROUTINES', 'TESTING', 'TODO', 'TRAPS', 'WEAVE', 'LAZUROS_STARTUP',
  'KOUROS_ANDROID'];
let broken = 0;
for (const d of docs) {
  let text; try { text = read(`Documentation/${d}.md`); } catch { continue; }
  for (const m of text.matchAll(PATH_RE)) {
    // A `../` link is written from Documentation/, so it resolves to the repo root.
    const p = m[1].replace(/^\.\.\//, '');
    if (PLANNED.has(p) || CITED_AS_ABSENT.has(p)) continue;
    if (!existsSync(join(ROOT, p))) { broken++; console.error(`  ✗ ${d}.md cites a path that does not exist: ${m[1]}`); }
  }
}
ok('every repo path the docs cite resolves', broken === 0, `— ${broken} broken reference(s)`);

console.log(`\ndocs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
