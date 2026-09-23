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

/* ── settle and the rig ───────────────────────────────────────────────────── */
{
  const { settle, createRig, stepRig, cutRig, rigView, orbitView, orbitDrag, coast, fitDistance, toScreen, DEG } = math;
  // settle SNAPS: a resting value is exactly its goal, not 1e-4 short — a resting
  // picture must not depend on how it got there.
  let s = { x: 0, v: 0 };
  for (let i = 0; i < 240; i++) s = settle(s, 0.7, 9, 1 / 60);
  check(s.x === 0.7 && s.v === 0, 'settle: once arrived, the spring is EXACTLY on its goal');
  const cut = settle({ x: 0, v: 3 }, 0.7, 9, 1 / 60, { reduced: true });
  check(cut.x === 0.7 && cut.v === 0, 'settle: under reduced motion it cuts — one step, no glide');

  const pose = { target: [0, 0, 0], yaw: 0.3, pitch: 20 * DEG, distance: 3 };
  const rig = createRig(pose, { omega: { target: 8, yaw: 8, pitch: 8, distance: 8 } });
  check(!stepRig(rig, 1 / 60, false), 'createRig: a new rig rests on its pose — nothing to animate');

  rig.targetGoal = [1, 0, -2];
  rig.distanceGoal = 5;
  let frames = 0;
  while (stepRig(rig, 1 / 60, false) && frames < 600) frames++;
  check(frames > 5 && frames < 180 && rig.target[0].x === 1 && rig.target[2].x === -2 && rig.distance.x === 5,
    `stepRig: target and distance glide to their goals and land ON them (${frames} frames)`);

  // Yaw aimed across the ±π seam takes the short way round.
  const r2 = createRig({ ...pose, yaw: 3.0 });
  r2.yawGoal = -3.0;
  let maxStray = 0;
  while (stepRig(r2, 1 / 60, false)) {
    const d = Math.abs(math.angleDelta(r2.yaw.x, 3.0)) + Math.abs(math.angleDelta(r2.yaw.x, -3.0));
    maxStray = Math.max(maxStray, d);
  }
  check(Math.abs(math.angleDelta(r2.yaw.x, -3.0)) < 1e-12 && maxStray < 2 * Math.PI - 6 + 1e-6,
    'stepRig: yaw 3.0 → −3.0 crosses the seam (0.28 rad), never unwinds the long way (5.72)');

  // A free yaw coasts on its velocity, slows under friction, and rests.
  const r3 = createRig(pose, { freeYaw: true, friction: 3 });
  r3.yaw = { x: 0, v: 2 };
  let coasting = 0;
  while (stepRig(r3, 1 / 60, false) && coasting < 1200) coasting++;
  check(r3.yaw.x > 0.5 && r3.yaw.x < 0.7 && r3.yaw.v === 0 && coasting < 1200,
    `stepRig: a flicked free yaw coasts ${r3.yaw.x.toFixed(3)} rad (≈ v/friction) and rests`);
  const r4 = createRig(pose, { freeYaw: true });
  r4.yaw = { x: 0, v: 2 };
  check(!stepRig(r4, 1 / 60, true) && r4.yaw.x === 0, 'stepRig: under reduced motion a flick does not coast');
  check(coast(1, 3.2, 1) < 0.05 && coast(1, 3.2, 0) === 1, 'coast: decays with friction, no snap');

  // A held rig leaves yaw and pitch exactly where the hand put them.
  const r5 = createRig(pose);
  r5.held = true;
  r5.yaw = { x: 1.1, v: 0 };
  r5.pitch = { x: 0.9, v: 0 };
  const heldMoving = stepRig(r5, 1 / 60, false);
  check(!heldMoving && r5.yaw.x === 1.1 && r5.pitch.x === 0.9, 'stepRig: HELD, yaw and pitch are the hand\'s — no spring home');
  r5.held = false;
  check(stepRig(r5, 1 / 60, false), 'stepRig: let go, they spring home');
  cutRig(r5);
  check(r5.yaw.x === pose.yaw && r5.pitch.x === pose.pitch, 'cutRig: snaps straight onto the goals');

  const view = rigView(createRig(pose), 1.5, { fov: 40 * DEG, near: 0.05, far: 30 });
  const direct = orbitView([0, 0, 0], pose.yaw, pose.pitch, pose.distance, 1.5, { fov: 40 * DEG, near: 0.05, far: 30 });
  check(view.viewProj.every((v, i) => v === direct.viewProj[i]), 'rigView: a resting rig IS orbitView of its pose, bit for bit');
  const centre = toScreen(view.viewProj, [0, 0, 0], 300, 200);
  check(centre && Math.abs(centre.x - 150) < 1e-3 && Math.abs(centre.y - 100) < 1e-3, 'rigView: the target is the centre of the frame');

  const limits = { yawPerPx: 0.5 * DEG, pitchPerPx: 0.4 * DEG, minPitch: 8 * DEG, maxPitch: 70 * DEG, maxYaw: 75 * DEG };
  let inside = true;
  for (const dx of [-5000, -1, 0, 1, 5000]) for (const dy of [-5000, -1, 0, 1, 5000]) {
    const o = orbitDrag({ yaw: 0, pitch: 30 * DEG }, dx, dy, limits);
    if (o.pitch < limits.minPitch || o.pitch > limits.maxPitch || Math.abs(o.yaw) > limits.maxYaw) inside = false;
  }
  check(inside, 'orbitDrag: never leaves its pitch and yaw bounds, for any drag');
  const free = orbitDrag({ yaw: 0, pitch: 30 * DEG }, -1000, 0, { ...limits, maxYaw: undefined });
  check(free.yaw > 2 * Math.PI, 'orbitDrag: with no maxYaw a scene may turn all the way round');
  check(orbitDrag({ yaw: 0, pitch: 30 * DEG }, 10, 0, limits).yaw < 0, 'orbitDrag: a drag RIGHT turns the scene right (yaw falls)');

  // fitDistance frames a sphere in the NARROWER field — a portrait phone's width.
  const fov = 50 * DEG, aspect = 390 / 520, radius = 1.2;
  const d = fitDistance(aspect, radius, fov);
  let framed = true;
  for (let yaw = 0; yaw < 2 * Math.PI; yaw += Math.PI / 12) {
    const vp = orbitView([0, 0, 0], yaw, 0, d, aspect, { fov, near: 0.05, far: 40 }).viewProj;
    for (let t = 0; t < 360; t += 15) {
      const a = t * DEG;
      const p = toScreen(vp, [Math.cos(a) * radius * 0.999, Math.sin(a) * radius * 0.999, 0], 390, 520);
      if (!p || p.x < 0 || p.x > 390 || p.y < 0 || p.y > 520) framed = false;
    }
  }
  check(framed, `fitDistance: a sphere of radius ${radius} stays in a 390×520 portrait frame (distance ${d.toFixed(2)})`);
}

/* ── gestures ─────────────────────────────────────────────────────────────── */
{
  const { lockAxis, velocityOf, classifyTap } = math;
  check(lockAxis(3, 4) === null && lockAxis(9, 2) === 'x' && lockAxis(2, -9) === 'y',
    'lockAxis: nothing before 8 px, then the axis the drag is mostly on');
  const still = [{ t: 0, v: 0.52 }, { t: 40, v: 0.52 }, { t: 80, v: 0.52 }];
  const flick = [{ t: 0, v: 0.3 }, { t: 30, v: 0.36 }, { t: 60, v: 0.42 }];
  check(Math.abs(velocityOf(still)) < 1e-9 && Math.abs(velocityOf(flick) - 2) < 1e-6,
    'velocityOf: a least-squares slope per second from the caller\'s timestamps');
  const a = classifyTap(null, { t: 0, x: 10, y: 10 });
  const b = classifyTap(a.last, { t: 250, x: 18, y: 14 });
  const c = classifyTap(b.last, { t: 400, x: 18, y: 14 });
  const late = classifyTap(a.last, { t: 301, x: 10, y: 10 });
  const far = classifyTap(a.last, { t: 100, x: 40, y: 10 });
  check(!a.double && b.double && !c.double, 'classifyTap: a second tap within 300 ms and 12 px is a double, and consumes the pair');
  check(!late.double && !far.double, 'classifyTap: too late or too far is two single taps');
}

/* ── picking and labels ───────────────────────────────────────────────────── */
{
  const { pickNearest, rayBox, thinLabels } = math;
  const screen = new Float32Array([100, 100, 110, 100, 300, 300, NaN, NaN]);
  const weights = new Float32Array([0.9, 0.3, 1, 1]);
  check(pickNearest(screen, weights, 108, 101) === 0, 'pickNearest: a faint point (0.3) cannot be picked even when nearer');
  check(pickNearest(screen, weights, 200, 200) === -1, 'pickNearest: nothing within 22 px is nothing');
  check(pickNearest(screen, weights, 0, 0, 1e6) !== 3, 'pickNearest: a point behind the camera (NaN) is never picked');
  const hit = rayBox([0, 0, 5], [0, 0, -1]);
  check(hit && Math.abs(hit[0] - 4) < 1e-9 && Math.abs(hit[1] - 6) < 1e-9, 'rayBox: enters at 4, leaves at 6');
  check(rayBox([0, 3, 5], [0, 0, -1]) === null, 'rayBox: a ray passing above the cube misses');
  const inside = rayBox([0, 0, 0], [1, 0, 0], 2);
  check(inside && inside[0] === 0 && Math.abs(inside[1] - 2) < 1e-9, 'rayBox: from inside a half-2 box it enters at 0');
  const boxes = Array.from({ length: 20 }, (_, i) => ({ id: i, x: (i % 5) * 100, y: Math.floor(i / 5) * 40, width: 80, height: 20, alpha: 1 - i / 40 }));
  boxes.push({ id: 99, x: 5, y: 2, width: 80, height: 20, alpha: 0.2 });
  const kept = thinLabels(boxes);
  check(kept.length === 8 && !kept.includes(99), 'thinLabels: at most 8, and an overlapping fainter label yields');
}

/* ── a matrix as a texture ────────────────────────────────────────────────── */
{
  const { textureLayout, texelOf, packTexture, MATRIX_TEXEL_GLSL } = math;
  for (const rows of [10, 600, 2500]) {
    const cols = 128;
    const layout = textureLayout(rows, cols, 2048);
    check(layout.width <= 2048 && layout.height <= 2048,
      `textureLayout: ${rows} rows fit a 2048 texture (${layout.width}×${layout.height})`);
    const bytes = new Uint8Array(rows * cols);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) % 251;   // no two neighbours alike
    const tex = packTexture(bytes, layout);
    let bad = 0;
    const seen = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [x, y] = texelOf(r, c, layout);
        const key = y * layout.width + x;
        if (seen.has(key) || x >= layout.width || y >= layout.height || tex[key] !== bytes[r * cols + c]) bad++;
        seen.add(key);
      }
    }
    check(bad === 0,
      `textureLayout: every one of ${rows}×${cols} cells round-trips through its own texel` +
      (rows > 2048 ? ' — including across the WRAP into a second column' : ''));
  }
  let threw = false;
  try { packTexture(new Uint8Array(5), textureLayout(3, 4)); } catch { threw = true; }
  check(threw, 'packTexture: a length that does not match the declared shape throws');
  let tooBig = false;
  try { textureLayout(2048 * 17, 128, 2048); } catch { tooBig = true; }
  check(tooBig, 'textureLayout: a matrix that cannot fit even wrapped throws, rather than drawing part of it');
  // ⚠️ The GLSL is texelOf, expression for expression — a shader that pastes it in
  // cannot drift from the TypeScript the round-trip above proves.
  check(/int column = row \/ rowsPerColumn;/.test(MATRIX_TEXEL_GLSL) &&
        /return ivec2\(col \+ column \* cols, row - column \* rowsPerColumn\);/.test(MATRIX_TEXEL_GLSL),
    'MATRIX_TEXEL_GLSL: the same column / offset arithmetic as texelOf');
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
  const { srgbToOklch, oklchToSrgb } = math;
  let worst = 0;
  for (const rgb of [[1, 0.69, 0], [0.31, 0.8, 0.77], [0.45, 0.47, 0.5], [0.05, 0.05, 0.9], [1, 1, 1]]) {
    const back = oklchToSrgb(...srgbToOklch(rgb));
    worst = Math.max(worst, ...back.map((v, i) => Math.abs(v - rgb[i])));
  }
  check(worst < 1e-6, `OKLCH: sRGB → OKLCH → sRGB round-trips (worst ${worst.toExponential(1)})`);
  const out = oklchToSrgb(0.7, 0.4, 2.5);
  const [, C, h] = srgbToOklch(out);
  check(out.every((v) => v >= 0 && v <= 1) && C < 0.4 && Math.abs(math.angleDelta(h, 2.5)) < 0.02,
    'oklchToSrgb: an out-of-gamut colour gives up CHROMA, keeping its hue, rather than clipping a channel');
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
