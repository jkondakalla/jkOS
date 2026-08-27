// TEST-17 · Secret scan — no live credential in a tracked file.
//
//   node test/secrets.mjs        (wired in as check:secrets)
//
// A secret scan is a standard audit-checklist item and its absence is itself a
// finding in a security-focused portfolio. This one is deliberately narrow: it
// looks for shapes that are almost never anything BUT a credential — a PEM
// private key block, a provider-prefixed API key, a bearer/authorization literal
// — rather than trying to entropy-score the tree, because a scanner that cries
// wolf gets an allow-list bolted on within a week and then finds nothing.
//
// Scope is TRACKED files only (`git ls-files`), because the thing that matters
// is what would be published. `.gitignore`d material — `.env`, `*.pem`,
// `music/.venv` — is out of scope by construction, which is also the design:
// the defence is that those never become tracked, and this asserts it.
//
// ⚠️ It does NOT scan git HISTORY. Whether anything sensitive was ever committed
// is a separate investigation whose remedy (a history rewrite) is destructive,
// coordinates with GitHub, and is Jag's call — see Documentation/BACKLOG.md.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, never `new URL(...).pathname` — this repo's path contains a
// space and pathname would percent-encode it.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const hits = [];

// High-signal shapes only. Each is a thing that is a credential or nothing.
const PATTERNS = [
  { name: 'PEM private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id',     re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token',          re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token',           re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key',        re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Resend API key',        re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI/Anthropic key',  re: /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{24,}\b/ },
  { name: 'private key in JSON',   re: /"private_key"\s*:\s*"-----BEGIN/ },
];

// A line that is manifestly an EXAMPLE or a TEST fixture is not a leak. Kept
// tight and explicit: the point is to exempt documented placeholders, not to
// give every hit a way out.
const PLACEHOLDER = /(?:<[^>]*>|\bxxx+\b|\byour[-_]|\bexample\b|\bplaceholder\b|\bdummy\b|\bfake\b|\bREPLACE\b|\bTODO\b)/i;

// Files whose whole job is to describe credential SHAPES — this scanner, the
// docs that explain the formats, and the env templates.
const DESCRIBES_SECRETS = [
  /^test\/secrets\.mjs$/,
  /(^|\/)\.env\.example$/,
  /^Documentation\//,
];

const files = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\n').filter(Boolean);

let scanned = 0;
for (const rel of files) {
  if (rel.startsWith('apps/sylibos/')) continue;          // off-limits, separate track
  if (DESCRIBES_SECRETS.some((re) => re.test(rel))) continue;
  const abs = join(REPO_ROOT, rel);
  let st;
  try { st = statSync(abs); } catch { continue; }
  if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;

  let src;
  try { src = readFileSync(abs, 'utf8'); } catch { continue; }
  if (src.indexOf(String.fromCharCode(0)) !== -1) continue;                   // binary; check:text owns that
  scanned++;

  src.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line) && !PLACEHOLDER.test(line)) {
        hits.push(`${rel}:${i + 1}  ${p.name}`);
      }
    }
  });
}

if (hits.length) {
  fail++;
  console.error(`  ✗ ${hits.length} possible live credential(s) in TRACKED files:`);
  for (const h of hits.slice(0, 20)) console.error(`      ${h}`);
  if (hits.length > 20) console.error(`      … +${hits.length - 20} more`);
  console.error('\n    If one is a false positive, make it obviously a placeholder rather than');
  console.error('    widening the scanner — a pattern with an exception list finds nothing.');
} else {
  pass++;
  console.log(`  ✓ ${scanned} tracked files scanned — no credential-shaped literal`);
}

// The other half of the defence: the ignore rules that keep real secrets out of
// the tree in the first place. Asserted, because the scan above is only
// meaningful while these hold.
const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
for (const rule of ['.env', '*.pem', '*.key']) {
  const held = gitignore.split('\n').some((l) => l.trim() === rule);
  if (held) { pass++; } else { fail++; console.error(`  ✗ .gitignore no longer excludes ${rule}`); }
}

console.log(`\nsecrets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
