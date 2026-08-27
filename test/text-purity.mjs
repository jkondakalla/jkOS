// Text purity — keeps every tracked source file readable by the TEXT TOOLS the
// rest of the gate is built out of.
//
// Nearly every conformance check in this suite is a text scan: check:drag,
// check:cards, check:tokens, check:design, check:async-view, check:overlay and the
// prober's probes all `readFileSync` a source file and assert over its characters.
// That whole layer rests on an unstated assumption — that the files are text.
//
// A single NUL byte breaks it. Git marks the file binary ("Binary files … differ",
// so a reviewer can never see the diff) and `grep -r` SKIPS it silently — no error,
// no warning, just absence. A source file with a raw control byte is therefore
// invisible to the gate that is supposed to police it, and a real violation inside
// it would pass forever.
//
// This is not hypothetical: apps/papyros/src/views/library/format.ts shipped a raw
// 0x00 inside the STANDALONE_KEY sentinel (`'<NUL>standalone'`). The intent was
// sound — a series-name that can never collide — but written as a literal byte
// rather than the `\u0000` ESCAPE, which has the identical runtime value while
// keeping the file text. That file was binary to git and grep for its whole life.
//
// So this asserts:
//
//   1. No tracked text-extension file contains a NUL or any other C0 control byte
//      (tab / LF / CR / FF excepted) or a DEL — the bytes that trip the binary
//      heuristics in git, grep, diff and the readers above.
//   2. The papyros sentinel specifically still spells itself with an escape, so the
//      original regression can't quietly return.
//
// apps/sylibos/ is EXCLUDED: it is off-limits to every sweep (see the reset's hard
// constraints) and carries a known pre-existing offender in src/lib/sliceLecture.ts.
// Excluding it is the same posture the prober and cards-purity take. Re-scope this
// list the day sylibos re-enters scope.
//
// Run:  node test/text-purity.mjs   (wired as `pnpm check:text`, folded into
//                                    `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// Extensions we assert are text. Deliberately explicit — a new binary asset type
// should not silently opt itself into the scan.
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|md|py|yml|yaml|sh|conf|sql|example)$/i;
const SKIP = [/^apps\/sylibos\//];

/** Tab (0x09), LF (0x0a), FF (0x0c), CR (0x0d) are the only controls text may hold. */
const isAllowedControl = (c) => c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
const isControl = (c) => (c < 0x20 && !isAllowedControl(c)) || c === 0x7f;

const tracked = execSync('git ls-files -z', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter(Boolean)
  .filter((f) => TEXT_EXT.test(f))
  .filter((f) => !SKIP.some((re) => re.test(f)));

// ── 1. No control bytes in any tracked text file ────────────────────────────
let scanned = 0;
for (const rel of tracked) {
  let buf;
  try { buf = readFileSync(resolve(root, rel)); } catch { continue; }  // deleted-but-tracked
  scanned++;
  const hits = [];
  for (let i = 0; i < buf.length; i++) if (isControl(buf[i])) hits.push(i);
  if (hits.length === 0) continue;

  const at = hits[0];
  const line = buf.subarray(0, at).toString('utf8').split('\n').length;
  const byte = `0x${buf[at].toString(16).padStart(2, '0')}`;
  fail(
    `${rel} holds ${hits.length} control byte(s) — first ${byte} at line ${line}. ` +
    `git and grep treat this file as BINARY, so every text-scan gate silently skips it. ` +
    `Write the character as an escape (e.g. \\u0000) instead of a raw byte.`,
  );
}
if (!failed) ok(`no control bytes in ${scanned} tracked text files (sylibos excluded)`);

// ── 2. The papyros sentinel stays an escape, not a raw byte ─────────────────
const SENTINEL = 'apps/papyros/src/views/library/format.ts';
const sentinelSrc = readFileSync(resolve(root, SENTINEL), 'utf8');
if (!/STANDALONE_KEY\s*=/.test(sentinelSrc)) {
  ok(`${SENTINEL} no longer defines STANDALONE_KEY — sentinel pin retired`);
} else if (/STANDALONE_KEY\s*=\s*'\\u0000standalone'/.test(sentinelSrc)) {
  ok("STANDALONE_KEY spells its NUL sentinel as the '\\u0000' escape, not a raw byte");
} else {
  fail(
    `${SENTINEL}'s STANDALONE_KEY is no longer the '\\u0000standalone' escape — if it went ` +
    `back to a literal NUL the file is binary again (same runtime value, invisible to the gate)`,
  );
}

if (failed) {
  console.error(`\n✗ text purity: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ text purity: every tracked source file is text — the scan-based gates can see it all');
