// TEST-13 · Authorization policy — no route may re-type a role comparison.
//
//   node test/policy.mjs        (wired into `pnpm test:contracts` as check:policy)
//
// The C5 finding was not the role model — three roles is the right granularity.
// It was that authorization existed ONLY as inline string comparisons
// (`if (user.role !== 'admin')`) scattered across route handlers: nine sites, no
// single place to read the policy, and nothing that could test it. The remedy is
// `apps/jkauth/src/policy.js` — one table of actions to roles — and this gate is
// what keeps the remedy true. Without it, the tenth route just re-types the
// comparison and the central table quietly becomes a description of the past.
//
// It scans SOURCE, not behaviour, because the failure it guards is a route that
// was never written to ask. A behavioural test can only cover routes someone
// remembered to cover; a scan covers the ones they didn't.
//
// ⚠️ IT USED TO SCAN `src/routes/` ONLY — and jkAuth's SECOND authorization policy is
// not in a route. `roleClaims()` in src/db.js decides, from inline `role !== 'guest'`
// and `role === 'admin'` comparisons, the `aud` and `scope` claims that every token in
// the SUITE carries. That is a wider authorization decision than any route guard here
// makes, and the gate proving "the policy lives in one place" was not looking at it.
// The scan now covers the whole service; the known second policy is listed below by
// name, with what it would take to fold it in, so it is a recorded exception rather
// than an invisible one.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = join(ROOT, 'apps/jkauth/src/routes');
const SRC_DIR = join(ROOT, 'apps/jkauth/src');
const POLICY = join(ROOT, 'apps/jkauth/src/policy.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

// Strip comments so a role comparison DESCRIBED in prose isn't read as one.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* `user.role === 'admin'`, `u.role !== 'guest'`, `jwtUser.role == "user"` — AND the
   bare `role === 'admin'` inside a function that took the role as a parameter.
   ⚠️ THE LEADING `\.` WAS LOAD-BEARING IN THE WRONG DIRECTION. Requiring a dot meant
   this pattern matched NOTHING in the entire service: jkAuth's real comparisons are
   `roleClaims(role)`'s bare `role !== 'guest'` and weave.js's bare `role === 'admin'`.
   So the gate that proves "no route re-types a role comparison" was passing because it
   could not see one — its single recorded exception (weave.js, allowed 1) had never
   fired either, which is what a permanently-zero detector looks like from outside. */
const ROLE_COMPARISON = /(?:^|[^\w.])(?:\w+\.)?role\s*[!=]==?\s*['"](guest|user|admin)['"]/;

/* A SQL predicate is not an authorization decision. `WHERE role != 'guest'` counts
   rows; excluded by the shape of the line rather than by being listed as an exception,
   because calling it one would blur what an exception means here. */
const SQL_LINE = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/;

ok(existsSync(POLICY), 'apps/jkauth/src/policy.js exists — the one place the policy lives');
const policySrc = readFileSync(POLICY, 'utf8');
for (const action of ['widgets:publish', 'widgets:delete', 'staging:enter', 'events:read:all']) {
  ok(policySrc.includes(`'${action}'`), `policy declares the '${action}' action`);
}
ok(/unknown action/.test(policySrc),
  'policy FAILS CLOSED on an unknown action — a typo must deny, not sail through');

/* Every .js under src/, not just src/routes/ — see the header. Recorded exceptions,
   each annotated at its own site and each with a reason a central action table cannot
   absorb as it stands:

   · routes/weave.js  `roleMaySee` reads a widget ROW's allowed_roles for per-widget
                      visibility. Per-row visibility is data, not a named action.
   · db.js            `roleClaims` derives the token's aud + scope from app_registry
                      rows. It IS a policy and belongs beside the other one; folding it
                      in means policy.js taking a dependency on db.js and owning a
                      registry-derived cache, which is a change to the token-minting
                      path and not one to make in passing. Pinned here so it cannot
                      grow a fourth comparison unnoticed.
   · views.js         a role BADGE — presentation, no access decision behind it.

   The number is EXACT, measured against the source, never rounded up: a file allowed
   three fails at four. A generous allowance is the same inert gate in slower motion. */
const EXCEPTIONS = { 'routes/weave.js': 1, 'db.js': 3, 'views.js': 1 };

function jsUnder(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return jsUnder(join(dir, e.name), `${prefix}${e.name}/`);
    return e.name.endsWith('.js') ? [`${prefix}${e.name}`] : [];
  });
}
const files = jsUnder(SRC_DIR);
ok(files.length >= 15, `found ${files.length} jkAuth source files to scan (whole service, not just routes/)`);

for (const f of files) {
  const src = stripComments(readFileSync(join(SRC_DIR, f), 'utf8'));
  const offenders = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => ROLE_COMPARISON.test(line) && !SQL_LINE.test(line));

  /* An exception is a NUMBER, not a blanket pass: a file allowed three comparisons
     fails at four. That is what stops a recorded exception becoming a quiet licence
     for the next one. */
  const allowed = EXCEPTIONS[f] ?? 0;
  ok(offenders.length <= allowed,
    `${f} re-types a role comparison instead of calling the policy `
    + `(${offenders.length} found, ${allowed} recorded): `
    + offenders.map(o => `L${o.n}: ${o.line}`).join(' · '));
}

// And the routes that DO gate must actually be reaching the policy module.
const weave = readFileSync(join(ROUTES_DIR, 'weave.js'), 'utf8');
/* The second policy is REAL and must stay findable: if roleClaims ever stops deciding
   scope, this assertion is the prompt to revisit the exception above rather than leave
   a stale allowance behind. */
const dbSrc = stripComments(readFileSync(join(SRC_DIR, 'db.js'), 'utf8'));
ok(/function roleClaims\b/.test(dbSrc) && /scope\.push/.test(dbSrc),
  'db.js still holds the token-claims policy the exception above is recorded for');
ok(/require\('\.\.\/policy'\)/.test(weave), 'weave.js imports the policy module');
ok(/can\(user, 'widgets:publish'\)/.test(weave), 'widget publish is gated by the named action');
ok(/can\(user, 'widgets:delete'\)/.test(weave), 'widget delete is gated by the named action');

console.log(`\npolicy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
