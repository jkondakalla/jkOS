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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = join(ROOT, 'apps/jkauth/src/routes');
const POLICY = join(ROOT, 'apps/jkauth/src/policy.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

// Strip comments so a role comparison DESCRIBED in prose isn't read as one.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// `user.role === 'admin'`, `u.role !== 'guest'`, `jwtUser.role == "user"` …
const ROLE_COMPARISON = /\.role\s*[!=]==?\s*['"](guest|user|admin)['"]/;

ok(existsSync(POLICY), 'apps/jkauth/src/policy.js exists — the one place the policy lives');
const policySrc = readFileSync(POLICY, 'utf8');
for (const action of ['widgets:publish', 'widgets:delete', 'staging:enter', 'events:read:all']) {
  ok(policySrc.includes(`'${action}'`), `policy declares the '${action}' action`);
}
ok(/unknown action/.test(policySrc),
  'policy FAILS CLOSED on an unknown action — a typo must deny, not sail through');

const files = readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'));
ok(files.length >= 4, `found ${files.length} route modules to scan`);

for (const f of files) {
  const src = stripComments(readFileSync(join(ROUTES_DIR, f), 'utf8'));
  const offenders = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => ROLE_COMPARISON.test(line));

  // weave.js's roleMaySee is the one allowed exception and says why in its own
  // comment: it reads a ROW's allowed_roles for per-widget visibility, which no
  // central action table can know. It is annotated at the site; the allowance is
  // recorded here rather than being a silent hole in the regex.
  const allowed = f === 'weave.js' ? 1 : 0;
  ok(offenders.length <= allowed,
    `${f} re-types a role comparison instead of calling the policy: `
    + offenders.map(o => `L${o.n}: ${o.line}`).join(' · '));
}

// And the routes that DO gate must actually be reaching the policy module.
const weave = readFileSync(join(ROUTES_DIR, 'weave.js'), 'utf8');
ok(/require\('\.\.\/policy'\)/.test(weave), 'weave.js imports the policy module');
ok(/can\(user, 'widgets:publish'\)/.test(weave), 'widget publish is gated by the named action');
ok(/can\(user, 'widgets:delete'\)/.test(weave), 'widget delete is gated by the named action');

console.log(`\npolicy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
