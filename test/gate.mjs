// The gate — `pnpm test:contracts`. Its membership is DERIVED, never typed:
//
//   1. every workspace package's `test` and `test:*` scripts (pnpm-workspace.yaml's globs),
//   2. `roundtrip`, the cross-app write round-trip,
//   3. every root `test:*` and `check:*` script, in package.json order,
//   4. `prove` last.
//
// It used to be one hand-typed `&&` chain of 55 commands in package.json, and a list typed by
// hand is a list someone forgets to extend: @jkos/auth-middleware's JWKS tests (key rotation,
// expiry, the static-key path) had a `test` script that no gate ran (found 2026-09-25). Now a
// package gets into the gate by having a `test` script, and a root gate by being named
// `check:*`. Stops at the first red step, like the `&&` chain did.
//
//   node test/gate.mjs          run it (what `pnpm test:contracts` does)
//   node test/gate.mjs --list   print the steps, run nothing
//
// test/docs.mjs imports gateSteps() to find every file the gate runs, so the catalog check and
// the gate cannot disagree about what "the gate" is.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** pnpm-workspace.yaml's `packages:` globs → the repo-relative dirs that hold a package.json. */
export function workspaceDirs() {
  const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const block = yaml.match(/^packages:\s*\n((?:\s+-.*\n?)+)/m)?.[1] ?? '';
  const globs = [...block.matchAll(/-\s*["']?([^"'#\s]+)/g)].map((m) => m[1]);
  const expand = (parts, base = '') => {
    if (!parts.length) return [base];
    const [head, ...rest] = parts;
    if (head !== '*') return expand(rest, base ? `${base}/${head}` : head);
    const abs = join(ROOT, base);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((e) => expand(rest, `${base}/${e.name}`));
  };
  return globs.flatMap((g) => expand(g.split('/')))
    .filter((d) => existsSync(join(ROOT, d, 'package.json')))
    .sort();
}

/** Every step, in run order: { label, args (for pnpm), dir, script } — `dir`/`script` say
 *  which package.json script the step runs, so a reader can follow it to its files. */
export function gateSteps() {
  const steps = [];
  for (const dir of workspaceDirs()) {
    const { name, scripts = {} } = readJson(join(dir, 'package.json'));
    for (const key of Object.keys(scripts)) {
      if (!/^test(:.+)?$/.test(key)) continue;
      steps.push({ label: `${name} ${key}`, args: ['--filter', name, key], dir, script: scripts[key] });
    }
  }
  const { scripts } = readJson('package.json');
  const root = (key) => ({ label: key, args: [key], dir: '.', script: scripts[key] });
  steps.push(root('roundtrip'));
  for (const key of Object.keys(scripts)) {
    if (key !== 'test:contracts' && /^(test|check):/.test(key)) steps.push(root(key));
  }
  steps.push(root('prove'));
  return steps;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const steps = gateSteps();
  if (process.argv.includes('--list')) {
    for (const [i, s] of steps.entries()) console.log(`${String(i + 1).padStart(2)}. ${s.label}`);
    process.exit(0);
  }
  const started = Date.now();
  for (const [i, s] of steps.entries()) {
    console.log(`\n── gate ${i + 1}/${steps.length} · ${s.label}`);
    const r = spawnSync('pnpm', s.args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\n✗ gate: step ${i + 1}/${steps.length} failed — ${s.label}` +
        (r.error ? ` (${r.error.message})` : ` (exit ${r.status ?? r.signal})`));
      process.exit(1);
    }
  }
  console.log(`\n✓ gate: ${steps.length} steps green in ${Math.round((Date.now() - started) / 1000)} s`);
}
