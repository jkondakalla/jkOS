// The transpile-pure-logic harness — what every TypeScript unit test in the gate shares.
//
// The suite has no TS test runner on Node 20, so a unit test transpiles the REAL .ts module in
// memory with the repo's own `typescript` (transpileModule strips the types; it never
// type-checks and never resolves an import), writes the JS to a temp dir, and imports it. No
// new dependency, and never a re-implementation of the logic under test.
//
// Fifteen tests carried their own copy of this preamble until 2026-09-25. The copies had
// drifted apart in two ways: the compile target (ES2020 in most, ES2022 in one) and how an
// import rewrite was spelt. Now the target is the one the apps build with (tsconfig.base.json,
// ES2022), so a test runs the module the way production does.
//
//   import { unit } from '../test/lib/unit.mjs';
//   const { check, deepEq, importTs, done } = unit('player/core', { root: new URL('..', import.meta.url) });
//   const queue = await importTs('src/core/queue.ts', 'queue.mjs');
//   check(queue.next(...) === 2, 'next() advances');
//   done();                                   // exits 1 if anything failed
//
// `root` is what relative paths resolve against: the repo root by default, or a package dir.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** TS source → ESM, with the compile options every unit test uses. */
export function transpile(src, fileName) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    fileName,
  }).outputText;
}

export function unit(name, { root = REPO_ROOT } = {}) {
  const base = root instanceof URL ? fileURLToPath(root) : root;
  const tmp = mkdtempSync(join(tmpdir(), `jkos-${name.replace(/[^\w]+/g, '-')}-`));
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

  let failed = 0;
  const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
  const ok = (msg) => console.log(`✓ ${msg}`);
  const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* Transpile `relPath` into the temp dir as `outName`, and return its path.
   *
   * `rewrite` maps an import specifier, exactly as the source writes it, to a module ALREADY
   * emitted into the same temp dir ('./rune.mjs'), so a module that is pure logic but not
   * import-free can still be tested for real. It is deliberately a per-call map rather than a
   * resolver: every rewritten edge is written down at the call site, which keeps this from
   * quietly becoming a second module resolver that could disagree with the bundler. */
  function emitTs(relPath, outName, rewrite = {}) {
    const path = isAbsolute(relPath) ? relPath : resolve(base, relPath);
    let src = readFileSync(path, 'utf8');
    for (const [from, to] of Object.entries(rewrite)) src = src.split(`'${from}'`).join(`'${to}'`);
    const out = join(tmp, outName);
    writeFileSync(out, transpile(src, relPath));
    return out;
  }
  const importTs = async (relPath, outName, rewrite) =>
    import(pathToFileURL(emitTs(relPath, outName, rewrite)).href);

  function done() {
    if (failed) {
      console.error(`\n✗ ${name}: ${failed} assertion(s) failed`);
      process.exit(1);
    }
    console.log(`\n✓ ${name}: all assertions passed`);
  }

  return { tmp, check, ok, fail, deepEq, emitTs, importTs, done, failures: () => failed };
}
