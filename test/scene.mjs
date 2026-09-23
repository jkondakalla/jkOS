// Scene conformance — keeps the suite on ONE 3-D engine.
//
// KourOS grew two WebGL views (the 3-D pulsarmap and the vibe space), and each one had
// to learn the same lessons the hard way: a lost context is a normal event on a phone
// and must be rebuilt, not crash; deleting programs does not release a context and
// browsers cap live ones (Chromium ~16, iOS Safari fewer), so a view that never gives
// its context back eventually kills the one on screen; and giving it back IMMEDIATELY
// on unmount breaks React StrictMode's remount of the same canvas — in development
// only, where nobody suspects the release. Those lessons now live once, in
// @jkos/scene (`useScene` + ../gl/context.ts). Nothing in the build forces the next 3-D
// view to use them, so this asserts:
//
//   1. @jkos/scene exports the hooks a view is built from (useScene, useOrbitControls)
//      and the rig they drive.
//   2. Every known 3-D view renders through `useScene` — none forks its own lifecycle.
//   3. No `getContext('webgl…')` anywhere in apps/ or packages/ outside
//      packages/scene/src — the one place a context is made — and no hand-rolled
//      context release or loss listener either.
//   4. No app re-declares the math (springStep, perspective, lookAt, orbitEye, invert):
//      a second spring is how "the same gesture feels different in two views" starts.
//
// Run:  node test/scene.mjs        (wired as `pnpm check:scene`, folded into
//                                  `pnpm test:contracts`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const PACKAGE = 'packages/scene/src';
const VIEWS = {
  'KourOS 3-D pulsarmap': 'apps/kouros/src/components/ridges3d/RidgeStage.tsx',
  'KourOS vibe space': 'apps/kouros/src/components/vibespace/VibeSpace.tsx',
};

/** Comments out, so a sentence ABOUT getContext is not a call to it. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every source file under apps/ and packages/, skipping what is built or installed. */
function sources() {
  const out = [];
  const SKIP = new Set(['node_modules', 'dist', 'build', '.vite', '.turbo', 'coverage']);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|mjs|cjs|html)$/.test(name)) out.push(relative(root, full).split('\\').join('/'));
    }
  };
  for (const top of ['apps', 'packages']) walk(resolve(root, top));
  return out;
}

// ── 1. The primitive exports what a view is built from ──────────────────────
{
  const react = read(`${PACKAGE}/react/index.ts`) + read(`${PACKAGE}/react/useScene.ts`)
    + read(`${PACKAGE}/react/useOrbitControls.ts`);
  const math = read(`${PACKAGE}/math/index.ts`) + read(`${PACKAGE}/math/rig.ts`);
  const missing = [
    ['useScene', react], ['useOrbitControls', react], ['createRig', math], ['stepRig', math], ['rigView', math],
  ].filter(([n, src]) => !new RegExp(`export\\s+(function|const)\\s+${n}\\b`).test(src)).map(([n]) => n);
  if (missing.length === 0) ok('@jkos/scene exports useScene, useOrbitControls and the rig (createRig / stepRig / rigView)');
  else fail(`@jkos/scene is missing exports: ${missing.join(', ')} — the one 3-D engine is incomplete`);
  const pkg = JSON.parse(read('packages/scene/package.json'));
  const layers = ['./math', './gl', './react'].filter((k) => !pkg.exports?.[k]);
  if (layers.length === 0) ok('@jkos/scene exports its three layers: /math, /gl, /react');
  else fail(`@jkos/scene's package.json does not export ${layers.join(', ')}`);
}

// ── 2. Every known 3-D view renders through useScene ────────────────────────
for (const [label, path] of Object.entries(VIEWS)) {
  const src = read(path);
  if (/import\s*\{[^}]*\buseScene\b[^}]*\}\s*from\s*['"]@jkos\/scene\/react['"]/.test(src)) {
    ok(`${label} renders through useScene (@jkos/scene/react)`);
  } else {
    fail(`${label} (${path}) does not import useScene from @jkos/scene/react — it forked its own lifecycle`);
  }
}

// ── 3 & 4. The sweep ────────────────────────────────────────────────────────
const files = sources();
const outside = files.filter((f) => !f.startsWith(`${PACKAGE}/`));
const contexts = [], releases = [], forks = [], unlisted = [];
for (const f of outside) {
  const src = strip(readFileSync(resolve(root, f), 'utf8'));
  if (/getContext\(\s*['"`](webgl2?|experimental-webgl)['"`]/.test(src)) contexts.push(f);
  if (/\bWEBGL_lose_context\b|\bloseContext\(|['"`]webglcontext(lost|restored)['"`]/.test(src)) releases.push(f);
  if (f.startsWith('apps/')
      && /(function\s+|(const|let)\s+)(springStep|perspective|lookAt|orbitEye|invert)\b\s*[=(<]/.test(src)) forks.push(f);
  // A React component that holds a WebGL context but is not a known view: the next
  // 3-D view. It must render through useScene — and be listed in VIEWS above.
  if (/\.tsx$/.test(f) && /\bWebGL2?RenderingContext\b/.test(src) && !Object.values(VIEWS).includes(f)) unlisted.push(f);
}
if (contexts.length === 0) ok(`no getContext('webgl…') outside ${PACKAGE} (${outside.length} files swept)`);
else fail(`getContext('webgl…') outside @jkos/scene — make the view a useScene consumer: ${contexts.join(', ')}`);
if (releases.length === 0) ok('no hand-rolled context release or loss listener outside @jkos/scene');
else fail(`WEBGL_lose_context / webglcontextlost outside @jkos/scene — useScene owns both: ${releases.join(', ')}`);
if (forks.length === 0) ok('no app re-declares springStep / perspective / lookAt / orbitEye / invert');
else fail(`the 3-D math is forked in: ${forks.join(', ')} — import it from @jkos/scene/math`);
if (unlisted.length === 0) ok('every component holding a WebGL context is a known view (listed above, on useScene)');
else fail(`a WebGL component this gate does not know: ${unlisted.join(', ')} — render it through useScene and add it to VIEWS`);

// The sweep must actually see the package, or "nothing outside" proves nothing.
const inside = files.filter((f) => f.startsWith(`${PACKAGE}/`)
  && /getContext\(\s*['"`]webgl2['"`]/.test(strip(readFileSync(resolve(root, f), 'utf8'))));
if (inside.length >= 1) ok(`the sweep sees the package's own getContext (${inside.join(', ')}) — it is looking in the right place`);
else fail('the sweep found no getContext even inside @jkos/scene — the file walk is broken, so every check above is vacuous');

if (failed) {
  console.error(`\n✗ scene conformance: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ scene conformance: one 3-D engine, every view on useScene, no forks');
