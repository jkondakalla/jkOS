// transpile.mjs — @jkos/scene/math, loadable by a node gate. Every file under
// src/math/ is transpiled in-memory with the repo's own `typescript` (the house
// pattern: the REAL sources, no build step, no bundler) into `outDir`, with each
// relative import rewritten to its `.mjs`. Returns the URL of the layer's index.
//
// Used by this package's own test and by any gate that drives a module importing
// '@jkos/scene/math' — KourOS's check:pulsarmap and check:vibespace rewrite that
// specifier to the returned URL.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));

export const MATH_DIR = resolve(here, '..', 'src', 'math');

/** Every `src/math/*.ts`, as `{ file, src }`, in name order. */
export function mathSources() {
  return readdirSync(MATH_DIR).filter((f) => f.endsWith('.ts')).sort()
    .map((file) => ({ file, src: readFileSync(join(MATH_DIR, file), 'utf8') }));
}

/** Transpile the math layer into `outDir` and return the file URL of its index. */
export function transpileSceneMath(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const { file, src } of mathSources()) {
    const rewritten = src.replace(/(from\s+['"])(\.\/[\w-]+)(['"])/g, '$1$2.mjs$3');
    const { outputText } = ts.transpileModule(rewritten, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, isolatedModules: true },
      fileName: file,
    });
    writeFileSync(join(outDir, file.replace(/\.ts$/, '.mjs')), outputText);
  }
  return pathToFileURL(join(outDir, 'index.mjs')).href;
}
