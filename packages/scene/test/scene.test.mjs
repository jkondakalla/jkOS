// scene.test.mjs — @jkos/scene's pure layer, driven for real.
//
// ⚠️ WHY THIS GATE EXISTS. Everything under src/math/ is what a 3-D view is made of
// before a single pixel is drawn, and every one of its failure modes still draws a
// picture: a spring that is stepped instead of solved lands somewhere different on a
// 30 fps phone and a 144 fps laptop; a lookAt with a flipped axis mirrors the scene;
// a `toScreen` that forgets the camera's back half projects what is behind you onto
// the glass in front. None of these throw. KourOS's two views were built on this
// code, and every future view inherits it — so it is asserted here, once, rather than
// re-proved inside each view's gate.
//
// The layer is transpiled in-memory with the repo's own `typescript`
// (./transpile.mjs) and the REAL functions are driven — the house pattern.
//
// Run:  node packages/scene/test/scene.test.mjs   (wired as `pnpm --filter @jkos/scene
//        test`, chained into the root `pnpm test:contracts`).
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mathSources, transpileSceneMath } from './transpile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-scene-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const math = await import(transpileSceneMath(tmp));

/* ── the spring ───────────────────────────────────────────────────────────── */
{
  const { springStep, springSettled } = math;
  let s = { x: 0, v: 0 };
  let overshoot = false;
  let settledBy = null;
  for (let t = 0; t < 2; t += 1 / 60) {
    s = springStep(s, 1, 10, 1 / 60);
    if (s.x > 1 + 1e-9) overshoot = true;
    if (settledBy == null && springSettled(s, 1, 1e-3)) settledBy = t;
  }
  check(!overshoot, 'springStep: critically damped from rest — never overshoots');
  check(settledBy != null && settledBy < 1, `springStep: settled within 1e-3 by 1 s (at ${settledBy?.toFixed(2)} s)`);
  // ⚠️ Solved, not stepped: the path is the same at any frame rate.
  let a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
  for (let i = 0; i < 30; i++) a = springStep(a, 1, 10, 1 / 30);
  for (let i = 0; i < 144; i++) b = springStep(b, 1, 10, 1 / 144);
  check(Math.abs(a.x - b.x) < 1e-9, 'springStep: 30 fps and 144 fps land in the same place after one second');
  const still = springStep({ x: 0.3, v: 2 }, 1, 10, 0);
  check(still.x === 0.3 && still.v === 2, 'springStep: dt = 0 (the first frame after rest) moves nothing');
}

/* ── angles ───────────────────────────────────────────────────────────────── */
{
  const { angleDelta } = math;
  check(Math.abs(angleDelta(0.1, 2 * Math.PI) - (-0.1)) < 1e-12,
    'angleDelta: 0.1 → 2π is −0.1, not a whole turn back');
  check(Math.abs(angleDelta(-3, 3) - (6 - 2 * Math.PI)) < 1e-12 && angleDelta(0, Math.PI) === Math.PI,
    'angleDelta: across ±π it takes the short way, and π itself is (−π, π]');
}

/* ── the matrices ─────────────────────────────────────────────────────────── */
{
  const { perspective, lookAt, multiply, invert, toScreen, orbitEye, identity, screenRay } = math;
  const eye = orbitEye([0, 0, 0], 0, 0, 3);
  check(Math.abs(eye[2] - 3) < 1e-12 && Math.abs(eye[0]) < 1e-12, 'orbitEye: yaw 0 looks along −z from +z');
  const vp = multiply(perspective(Math.PI / 3, 1, 0.1, 100), lookAt(eye, [0, 0, 0], [0, 1, 0]));
  const centre = toScreen(vp, [0, 0, 0], 200, 100);
  check(centre && Math.abs(centre.x - 100) < 1e-4 && Math.abs(centre.y - 50) < 1e-4,
    'lookAt + perspective: the target lands at the centre of the viewport');
  const up = toScreen(vp, [0, 0.5, 0], 200, 100);
  check(up && up.y < 50, 'toScreen: +y is UP the screen (smaller CSS y)');
  const inv = invert(vp);
  const round = inv && multiply(vp, inv);
  const I = identity();
  check(!!round && round.every((v, i) => Math.abs(v - I[i]) < 1e-4), 'invert: M · M⁻¹ = I');
  check(toScreen(vp, [0, 0, 10], 200, 100) === null, 'toScreen: a point behind the camera is null, not a mirror image');
  check(invert(new Float32Array(16)) === null, 'invert: a singular matrix is null, not NaNs');
  const ray = screenRay(inv, 100, 50, 200, 100);
  check(Math.abs(ray.dir[2] + 1) < 1e-4 && Math.abs(ray.dir[0]) < 1e-4,
    'screenRay: the centre pixel\'s ray runs from the eye straight at the target');
}

/* ── colour ───────────────────────────────────────────────────────────────── */
{
  const { parseColor } = math;
  const near = (a, b) => a && b.every((v, i) => Math.abs(a[i] - v) < 1e-6);
  check(near(parseColor('rgb(255, 128, 0)'), [1, 128 / 255, 0]), 'parseColor: rgb()');
  check(near(parseColor('color(srgb 0.5 1.2 -0.1)'), [0.5, 1, 0]),
    'parseColor: color(srgb …) — what Chromium reports for a color-mix — clamped into gamut');
  check(near(parseColor('#ff8000'), [1, 128 / 255, 0]) && parseColor('papayawhip') === null,
    'parseColor: #rrggbb, and a name it cannot read is null (the caller\'s fallback), not black');
}

/* ── purity and layering ──────────────────────────────────────────────────── */
{
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const { file, src } of mathSources()) {
    const code = strip(src);
    const clocks = ['setInterval', 'setTimeout', 'Date.now', 'performance.now', 'requestAnimationFrame']
      .filter((b) => code.includes(b));
    check(!clocks.length, `purity: math/${file} holds no clock (${clocks.join(', ') || 'none'}) — time is the caller's dt`);
    check(!/\b(document|window|navigator|getComputedStyle)\b/.test(code),
      `purity: math/${file} touches no DOM, so a Web Worker can load it`);
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
    check(imports.every((i) => /^\.\/[\w-]+$/.test(i)),
      `layering: math/${file} imports only its own layer (${imports.join(', ') || 'nothing'})`);
  }
  for (const layer of ['gl']) {
    for (const file of readdirSync(join(pkg, 'src', layer)).filter((f) => /\.tsx?$/.test(f))) {
      const code = strip(readFileSync(join(pkg, 'src', layer, file), 'utf8'));
      check(!/from\s+['"](react|@jkos\/ui)['"]/.test(code) && !/from\s+['"]\.\.\/react/.test(code),
        `layering: ${layer}/${file} imports no React — a view without React can use it`);
    }
  }
}

if (failed) {
  console.error(`\n✗ @jkos/scene: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ @jkos/scene: all assertions passed');
