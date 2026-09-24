/**
 * TEST-15 · Wire timestamps — one format across the suite (XC-1).
 *
 * Two formats coexisted, and they sort against each other INCORRECTLY as
 * strings, which is what made this a correctness bug rather than a style one:
 *
 *     SQLite datetime('now')  →  "2026-08-27 05:21:34"       (space, whole seconds)
 *     millisecond ISO-8601    →  "2026-08-27T05:21:34.353Z"  (T, milliseconds)
 *
 * `' ' < 'T'`, and `?since=<cursor>` is a string comparison — so a cursor taken
 * from one app and used against another returned the wrong window, silently. A
 * delta cursor was therefore not portable across this suite even in principle,
 * and the incremental-embedding cursor for the music vector space runs off it
 * over tens of thousands of rows, where "skipped one" is a track never embedded
 * and never noticed.
 *
 * The rule: any backend writing a `created_at`/`updated_at` must use the shared
 * `SQL_NOW` from `@jkos/weave/server/wireTime`, never a bare `datetime('now')`.
 * This scans source for the legacy form in a timestamp assignment.
 *
 * A legacy `datetime('now')` used for anything
 * that is NOT a wire timestamp — a lockout deadline, an OTP window, a "used_at"
 * marker nothing paginates on — is fine and is not flagged: the column names are
 * the scope.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';

// `created_at = datetime('now')`, `SET updated_at=datetime('now')`,
// `created_at TEXT DEFAULT (datetime('now'))` — an assignment or default of a
// WIRE timestamp column to the legacy whole-second form.
const LEGACY = /\b(created_at|updated_at)\b[^,;\n]{0,60}?datetime\s*\(\s*'now'/;

// A HISTORICAL migration body is not a defect: migration 1 created `items` with
// a whole-second default and migration 8 converted it, and rewriting migration 1
// now would be rewriting what already happened on every deployed database.
// Mark such a line `// wire-time-legacy: <why>` and it is exempt — the same
// visible-exception mechanism the surface-coverage probe uses, so the exemption
// lives at the line it excuses instead of in an allow-list in here.
// `--` inside SQL, `//` in JavaScript. ⚠️ These markers sit INSIDE template
// literals that are executed as SQL, where `//` is not a comment and would be a
// syntax error — the marker has to speak the language of the line it is on.
const LEGACY_OK = /(?:\/\/|--)\s*wire-time-legacy\b/;

// A `datetime('now', …)` WRAPPED in the canonical conversion is correct, not
// legacy: LazurOS's requeue compares `updated_at < sqlConvert(datetime('now',?))`,
// where the inner call computes a cutoff instant and the wrapper renders it in
// the wire format. Flagging it would be the probe reading the inner function and
// ignoring the one that determines the actual format.
const CANONICAL_WRAPPER = /SQL_NOW|sqlConvert\s*\(|strftime\s*\(\s*'%Y-%m-%dT%H:%M:%fZ'/;

/* ⚠️ A MISSING ROOT IS A FAILURE, NOT AN EMPTY LIST — the same hole `check:today`
   carried. `if (!existsSync(dir)) return out` turns a stale path into a silent zero,
   and five other roots then fill the file count in so the report looks healthy. The
   caller raises `missingRoots` as drift rather than reporting on code it never read. */
const missingRoots = [];
/* ⚠️ COMMENTS OUT, PROPERLY — a prefix test is not enough. This used to skip a line
   whose TRIMMED form began with `*` or `//`, which misses every continuation line of
   a `/* … *\/` block that does not start with a star — and this repo's house style
   indents them without one. So the moment a file EXPLAINED the defect this probe
   guards, the prose tripped it: the fix for the jkAuth OTP bug documents the legacy
   form it replaces, and that sentence read as a violation.
   A gate with false positives is worse than no gate — people learn to skip it. Comment
   bodies are blanked rather than removed so reported line numbers still point at the
   real line. */
function blankComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
}

function jsFilesUnder(dir, { root = false } = {}) {
  const out = [];
  if (!existsSync(dir)) {
    if (root) missingRoots.push(dir.slice(REPO_ROOT.length + 1));
    return out;
  }
  if (!statSync(dir).isDirectory()) return dir.endsWith('.js') ? [dir] : out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === 'test') continue;
    if (statSync(p).isDirectory()) out.push(...jsFilesUnder(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/* ⚠️ jkAuth WAS NOT IN THIS LIST, and it was the app that actually held both formats.
   Every one of its `created_at`/`updated_at` columns defaulted to the whole-second
   `datetime('now')` while migration 017's session timestamps were millisecond ISO —
   so the probe reported "every write uses the canonical format" about a service it
   had never opened. That is not a hypothetical: `verifyEmailOtp` compared an ISO
   `expires_at` against `datetime('now')` and, because `' ' < 'T'`, accepted every
   passcode until UTC midnight. Fixed in migration 020; the probe now looks.

   ⚠️ Each app's WHOLE backend, not its `src/`. `server.js` and `discovery.js` sit
   beside `src/` and carry the collection mounts and the activity reads — seven files
   across three apps that this probe never scanned. */
const SCAN_ROOTS = [
  'apps/beigeboard/backend',
  'apps/kouros/backend',
  'apps/lazuros/backend',
  'apps/jkauth/src',
  'apps/jkauth/server.js',
  'packages/weave/src/server',
];

export default {
  id: 'wire-time',
  title: 'Wire timestamps — one millisecond-ISO format, so a cursor is portable',

  run() {
    const out = [];
    const offenders = [];
    let scanned = 0;

    for (const root of SCAN_ROOTS) {
      for (const file of jsFilesUnder(join(REPO_ROOT, root), { root: true })) {
        scanned++;
        const src = readFileSync(file, 'utf8');
        const raw = src.split('\n');
        /* ⚠️ TWO VIEWS OF THE SAME LINE, on purpose. The violation is matched against
           the CODE (comments blanked, so prose describing the defect cannot trip it);
           the exemption is matched against the RAW line, because `wire-time-legacy`
           is a marker that lives INSIDE a comment by design. Blanking before both
           checks silently deletes every exemption in the repo — which it did, and the
           first thing it re-flagged was migration 6's historical body, correctly
           marked since the day this probe was written. */
        blankComments(src).split('\n').forEach((code, i) => {
          if (LEGACY.test(code) && !LEGACY_OK.test(raw[i]) && !CANONICAL_WRAPPER.test(code)) {
            offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${i + 1}`);
          }
        });
      }
    }

    if (missingRoots.length) {
      out.push({
        level: 'drift',
        msg: `${missingRoots.length} scan root(s) do not exist — this probe was reporting `
           + 'a clean result for code it never opened. Fix the path or drop the root.',
        where: missingRoots,
      });
    }

    if (offenders.length) {
      out.push({
        level: 'drift',
        msg: `${offenders.length} wire-timestamp write(s) still use the whole-second `
           + `datetime('now') — it sorts before millisecond ISO of the same instant, so a `
           + `?since= cursor silently returns the wrong window. Use SQL_NOW from `
           + `@jkos/weave/server/wireTime.`,
        where: offenders.slice(0, 6),
      });
    } else {
      out.push({
        level: 'ok',
        msg: `${scanned} backend source files scanned — every created_at/updated_at write uses `
           + 'the canonical millisecond-ISO format, so a delta cursor is portable across apps',
        where: ['packages/weave/src/server/wireTime.js'],
      });
    }
    return out;
  },
};
