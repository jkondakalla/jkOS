#!/usr/bin/env node
// scripts/run-tests.mjs — the @jkos/player "test" entry point. Enumerates and runs
// EVERY *.mjs file directly under test/ as its own child process (each is a
// self-contained house-pattern test with its own ✓/✗ output and exit code) instead
// of hardcoding a single filename — test/core.test.mjs (this item) and
// test/backend.*.mjs (a parallel item) both must run automatically, without anyone
// having to come back and edit this file when a new one is added.
//
// Run: node scripts/run-tests.mjs   (wired as `pnpm --filter @jkos/player test`,
//                                     chained into the root `pnpm test:contracts`)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const testDir = resolve(here, '..', 'test');

const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.mjs'))
  .sort();

if (files.length === 0) {
  console.error(`✗ @jkos/player test: no test/*.mjs files found in ${testDir}`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  console.log(`\n── ${file} ──`);
  const res = spawnSync(process.execPath, [join(testDir, file)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
}

console.log(`\n${'='.repeat(40)}`);
if (failed) {
  console.error(`✗ @jkos/player test: ${failed}/${files.length} file(s) failed`);
  process.exit(1);
}
console.log(`✓ @jkos/player test: all ${files.length} file(s) passed`);
