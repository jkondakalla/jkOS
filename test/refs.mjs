// ext_ref conformance — the cross-app addressing namespace, and the rule that the
// REF is the authority (D7 · BB-5 + BB-3).
//
// WHY THIS EXISTS
//
// ⚠️ BB-5. One `ext_ref` column carried FOUR incompatible schemes and nothing said
// so — the audit only found three:
//
//     beigeboard:41            a row owned by a suite app
//     itunes:1234567           an external catalog id (a bare literal in one route
//                              file, declared nowhere)
//     routine:24:2026-08-18    BeigeBoard's engine occurrence identity
//     routinedoc:squat-cycle   BeigeBoard's routine DOCUMENT identity
//
// The finding is stated from the reader's side, which is the right side: *"an AI
// author reading the dataset docs cannot tell these apart."* Each app now DECLARES
// the schemes it writes (`EXT_REFS` in its discovery doc) and the declaration is
// projected into the dataset's `ext_ref` field doc. This proves the allocation
// holds: globally disjoint, never colliding with an app id, and no source literal
// writing a prefix nobody declared.
//
// ⚠️ BB-3. `routines.js` has asserted "THE REF IS THE AUTHORITY, not parent_id" in
// prose since it was written, while FIVE of its six occurrence readers keyed on
// `parent_id` anyway. Drag one session out from under its routine — into a goal,
// which is the whole reason the rule exists — and the row kept its ext_ref but left
// every reader's view: never withdrawn, never re-rendered, missing from the tally,
// and re-INSERTed on every reconcile forever, an insert the unique index refuses and
// INSERT OR IGNORE swallows in silence. A prose rule that five call sites contradict
// is not a rule. This is the rule.
//
// Run:  node test/refs.mjs        (wired as `pnpm check:refs`, folded into
//                                  `pnpm test:contracts`)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

/* Required BY PATH, not by package name: the repo root is not a workspace package,
   so `@jkos/*` does not resolve here. Same arrangement the suite-prober uses. */
const { APP_IDS } = require(resolve(root, 'packages/suite-manifest/apps.js'));
const { checkExtRefDoc, RESERVED_SCHEMES } = await import(resolve(root, 'packages/weave/src/shared/extref.js'));

/* The apps that declare ext_ref schemes. */
const DECL_MODULES = [
  ['beigeboard', 'apps/beigeboard/backend/discovery.js'],
  ['papyros',    'apps/papyros/backend/discovery.js'],
  ['kouros',     'apps/kouros/backend/discovery.js'],
  ['lazuros',    'apps/lazuros/backend/docs.js'],
];

// ── 1. every declaration is well-formed, and names its own app ──────────────
const declared = new Map();   // scheme id → { app, class, shape }
for (const [app, rel] of DECL_MODULES) {
  let mod;
  try { mod = require(resolve(root, rel)); } catch (e) { fail(`${rel} does not load: ${e.message}`); continue; }
  const doc = mod.EXT_REFS;
  if (!doc) continue;                    // an app that writes no scheme of its own
  const err = checkExtRefDoc(doc);
  if (err) { fail(`${app}'s EXT_REFS: ${err}`); continue; }
  if (doc.app !== app) fail(`${rel} declares app '${doc.app}' but lives in ${app}`);
  for (const sch of doc.schemes) declared.set(sch.id, { app, ...sch });
}
ok(`${declared.size} ext_ref scheme(s) declared across ${DECL_MODULES.length} apps: ${[...declared.keys()].sort().join(', ')}`);

// ── 2. the allocation is disjoint ───────────────────────────────────────────
{
  /* One column holds every scheme, so scheme ids must be globally unique AND must
     never collide with an app id — an `itunes` app would silently reinterpret every
     PapyrOS metadata ref as "a row owned by the itunes app". */
  const clash = [...declared.keys()].filter((id) => APP_IDS.includes(id) || id in RESERVED_SCHEMES);
  if (clash.length) {
    fail(`scheme(s) collide with a jkOS app id or a suite-reserved scheme: ${clash.join(', ')} — an app id ALWAYS wins, so every ref with that prefix would be re-read as "a row owned by that app"`);
  } else {
    ok(`no declared scheme collides with an app id or a reserved scheme (${APP_IDS.length} app ids, ${Object.keys(RESERVED_SCHEMES).length} reserved)`);
  }
  /* Global uniqueness is enforced by construction above (one Map), so the check
     that matters is that no two apps CLAIMED the same id — which the Map would have
     silently resolved in favour of whichever loaded last. */
  const counts = new Map();
  for (const [app, rel] of DECL_MODULES) {
    let doc;
    try { doc = require(resolve(root, rel)).EXT_REFS; } catch { continue; }
    for (const sch of doc?.schemes || []) counts.set(sch.id, [...(counts.get(sch.id) || []), app]);
  }
  const dupes = [...counts].filter(([, apps]) => apps.length > 1);
  if (dupes.length) {
    fail(`scheme(s) claimed by more than one app: ${dupes.map(([id, apps]) => `${id} (${apps.join(', ')})`).join('; ')}`);
  } else {
    ok('every scheme is claimed by exactly one app');
  }
}

/* ── the source scan ────────────────────────────────────────────────────────── */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo']);
function sources(dir, exts) {
  const out = [];
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return out;
  for (const ent of readdirSync(abs)) {
    if (SKIP_DIRS.has(ent)) continue;
    const p = join(dir, ent);
    if (statSync(resolve(root, p)).isDirectory()) out.push(...sources(p, exts));
    else if (exts.some((e) => ent.endsWith(e))) out.push(p);
  }
  return out;
}
const SCAN = ['apps', 'packages'];
const files = SCAN.flatMap((d) => sources(d, ['.js', '.mjs', '.ts', '.tsx']));

// ── 3. no source writes or matches an undeclared prefix ────────────────────
{
  /* ⚠️ ANCHORED to the column, not merely on a line that mentions it. The first
     version of this check matched any `'word:'` literal on any line containing
     `ext_ref`, which flagged six test-assertion message prefixes (`'activity: …'`,
     `'cascade: …'`) as undeclared schemes. A gate with six false positives on its
     first run is a gate people learn to skip.

     Both write forms and read forms count: a reader matching a prefix nobody
     declares is the same defect seen from the other end. */
  const ANCHORS = [
    /ext_ref\s*[:=]\s*[`'"]([a-z][a-z0-9_]{0,31}):/g,                 // ext_ref: 'routine:…'
    /ext_ref\s+LIKE\s+[`'"]([a-z][a-z0-9_]{0,31}):/gi,                // …ext_ref LIKE 'routine:%'
    /ext_ref[^\n]{0,60}?startsWith\(\s*[`'"]([a-z][a-z0-9_]{0,31}):/g, // ref.startsWith('routine:')
    /ext_ref_prefix=([a-z][a-z0-9_]{0,31}):/g,                        // the declared filter, in a URL
  ];
  const offenders = [];
  const seen = new Set();
  for (const rel of files) {
    if (rel.endsWith('test/refs.mjs')) continue;
    const src = readFileSync(resolve(root, rel), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/\bext_ref\b/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;        // prose about the namespace
      for (const re of ANCHORS) {
        for (const m of line.matchAll(re)) {
          const scheme = m[1];
          if (APP_IDS.includes(scheme) || declared.has(scheme) || scheme in RESERVED_SCHEMES) { seen.add(scheme); continue; }
          offenders.push(`${rel}:${i + 1}  '${scheme}:' is not a declared scheme nor an app id`);
        }
      }
    });
  }
  if (offenders.length) {
    fail(`${offenders.length} ext_ref prefix(es) written or matched but never declared:`);
    for (const o of offenders.slice(0, 20)) console.error(`      ${o}`);
    console.error("    Declare it in that app's EXT_REFS (discovery.js) — class 'external' for a");
    console.error("    third-party catalog, 'internal' for an app-private engine identity. An");
    console.error('    undeclared prefix is invisible to every reader of the dataset docs.');
  } else {
    ok(`every ext_ref prefix in source is declared or is an app id (${[...seen].sort().join(', ')})`);
  }

  /* The reverse drift: a scheme declared but written nowhere is a promise the app
     has stopped keeping, and a reader would compose against it. */
  const stale = [];
  for (const [id, sch] of declared) {
    const appFiles = files.filter((f) => f.startsWith(`apps/${sch.app}/`));
    const written = appFiles.some((f) => new RegExp(`['"\`]${id}:`).test(readFileSync(resolve(root, f), 'utf8')));
    if (!written) stale.push(`${id} (declared by ${sch.app})`);
  }
  if (stale.length) fail(`scheme(s) declared but never written: ${stale.join(', ')} — a declared scheme nothing produces is a promise the app has stopped keeping`);
  else ok('every declared scheme is actually written somewhere in its own app');
}

// ── 4. BB-3: no occurrence reader keys on parent_id ─────────────────────────
{
  /* The shape the defect took, five times: a WHERE that filters routine occurrences
     by `parent_id` instead of by the ref. Matched across the whole statement, since
     the two clauses sit on different lines in every one of them. */
  const offenders = [];
  for (const rel of files) {
    if (rel.endsWith('test/refs.mjs')) continue;
    const src = readFileSync(resolve(root, rel), 'utf8');
    // Collapse whitespace so a multi-line SQL template reads as one string.
    const flat = src.replace(/\s+/g, ' ');
    const re = /parent_id\s*=\s*\?[^`'"]{0,120}?ext_ref\s+LIKE|ext_ref\s+LIKE[^`'"]{0,120}?parent_id\s*=\s*\?/g;
    for (const m of flat.matchAll(re)) {
      offenders.push(`${rel}  …${m[0].slice(0, 90)}…`);
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} occurrence reader(s) key on parent_id instead of the ref (BB-3):`);
    for (const o of offenders) console.error(`      ${o}`);
    console.error('    Use OCCURRENCE_OF + occurrenceRefPattern(routineId) from src/routines.js.');
    console.error('    A session dragged out of its routine subtree keeps its ext_ref and loses');
    console.error('    its parent — which is exactly the case the ref exists to survive.');
  } else {
    ok('no occurrence reader keys on parent_id — the ref is the authority (BB-3)');
  }
}

// ── 5. the declaration reaches the dataset docs ─────────────────────────────
{
  /* The finding was about what a READER can see, so the declaration existing is
     only half of it: it has to reach the document a peer actually fetches. */
  const missing = [];
  for (const [app, rel] of DECL_MODULES) {
    let mod;
    try { mod = require(resolve(root, rel)); } catch { continue; }
    if (!mod.EXT_REFS?.schemes?.length) continue;
    const docs = JSON.stringify(mod.DATASETS ?? mod.DATASETS_DOC ?? {});
    const anyShape = mod.EXT_REFS.schemes.some((sch) => docs.includes(sch.shape));
    if (!anyShape) missing.push(`${app} (${rel})`);
  }
  if (missing.length) {
    fail(`declared schemes never reach the served DatasetDoc for: ${missing.join(', ')} — `
      + 'project them with extRefFieldDoc(EXT_REFS) onto the ext_ref field, or the reader '
      + 'this finding is about still cannot tell the schemes apart');
  } else {
    ok('every declared scheme set is projected into its app’s served dataset doc');
  }
}

if (failed) {
  console.error(`\n✗ ext_ref conformance: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ ext_ref conformance: one declared namespace, and the ref is the authority');
