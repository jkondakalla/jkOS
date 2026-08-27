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
 * sylibos is excluded (off-limits). A legacy `datetime('now')` used for anything
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

function jsFilesUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === 'test') continue;
    if (statSync(p).isDirectory()) out.push(...jsFilesUnder(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const SCAN_ROOTS = [
  'apps/beigeboard/backend/src',
  'apps/kouros/backend/src',
  'apps/papyros/backend/src',
  'apps/lazuros/backend',
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
      for (const file of jsFilesUnder(join(REPO_ROOT, root))) {
        scanned++;
        const src = readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
          if (LEGACY.test(line) && !LEGACY_OK.test(line) && !CANONICAL_WRAPPER.test(line)) {
            offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${i + 1}`);
          }
        });
      }
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
