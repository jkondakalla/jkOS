// pulsarmap.mjs — the pure math under the pulsarmap renderer (ALGORITHMS.md §9,
// TODO.md §2 block 8).
//
// ⚠️ WHY THIS GATE EXISTS. Every failure mode in `pulsarmap.ts` is SILENT. A
// reveal driven off a rounded row duration drifts 3 ms per row and is a whole row
// out by minute ten — which looks like a stylistic choice, not a bug. A pan that
// clamps wrong shows blank space below the newest row, and the picture appears to
// have stopped. A seek backwards that appends instead of repainting draws the
// second half of the song over the first. None of these throw, none log, and the
// only symptom is a picture that is subtly not about the song that is playing.
//
// The module is authored in TypeScript with no runtime imports, so this
// transpiles it in-memory with the repo's own `typescript` dep and drives the
// REAL functions — the house pattern, copied from test/cards-logic.mjs.
//
// Run:  node test/pulsarmap.mjs   (wired as `pnpm check:pulsarmap`, folded into
//                                   `pnpm test:contracts`).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'jkos-pulsarmap-'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function importTs(relPath, outName, rewrite = {}) {
  let src = readFileSync(resolve(root, relPath), 'utf8');
  for (const [from, to] of Object.entries(rewrite)) {
    src = src.split(`'${from}'`).join(`'${to}'`);
  }
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    fileName: relPath,
  });
  const outFile = join(tmp, outName);
  writeFileSync(outFile, outputText);
  return import(pathToFileURL(outFile).href);
}

const pm = await importTs('apps/kouros/src/components/pulsarmap.ts', 'pulsarmap.mjs');
const {
  MIN_ROW_PITCH, rowPitch, revealIndex, rowsRevealed, planReveal, emptyReveal,
  canvasHeight, rowBaseline, panOffset, rowPoints, toRows,
} = pm;

/* The mesh music/mesh.py actually builds at the baseline configuration. The row
   duration is DERIVED (86 frames of 512 samples at 22.05 kHz), not the 2.0 s
   target — and the gap between them is what this file exists to keep honest. */
const ROW_SECONDS = 1.9969160997732427;

/* ── revealIndex ──────────────────────────────────────────────────────────── */
check(revealIndex(0, ROW_SECONDS, 100) === 0,
  'revealIndex: row 0 is present from t=0, not 2 s in');
check(revealIndex(1.99, ROW_SECONDS, 100) === 0,
  'revealIndex: still row 0 just before the boundary');
check(revealIndex(2.0, ROW_SECONDS, 100) === 1,
  'revealIndex: row 1 has arrived just after 1.9969 s');
check(revealIndex(60, ROW_SECONDS, 100) === Math.floor(60 / ROW_SECONDS),
  'revealIndex: floor(currentTime / rowSeconds), plainly');

// ⚠️ THE DRIFT ASSERTION, and the reason `row_seconds` ships in the mesh at all.
// A renderer that used the 2.0 s TARGET instead of the derived duration agrees
// with this one for nine minutes and is a whole row out after ten.
{
  // The two disagree for a window after every row boundary, and the window is
  // proportional to elapsed time: 2 ms at row 1, and 1.85 SECONDS by row 600 —
  // most of a whole row, on a 20-minute track.
  check(revealIndex(1.998, ROW_SECONDS, 10000) === 1 && revealIndex(1.998, 2.0, 10000) === 0,
    'revealIndex: at 1.998 s the derived duration has already turned row 1 over and the ' +
    '2.0 s target has not — a 2 ms disagreement, one row in');
  check(revealIndex(1199, ROW_SECONDS, 10000) === 600 && revealIndex(1199, 2.0, 10000) === 599,
    'revealIndex: by 20 minutes the same disagreement is 1.85 s wide — nearly a whole row, ' +
    'which is why the mesh SHIPS row_seconds instead of the renderer assuming 2.0');
  // And the drift is one-directional, so it accumulates rather than averaging out.
  let ahead = 0;
  for (let t = 0; t < 1200; t += 0.25) {
    if (revealIndex(t, ROW_SECONDS, 10000) < revealIndex(t, 2.0, 10000)) ahead++;
  }
  check(ahead === 0,
    'revealIndex: the derived duration is never BEHIND the 2.0 s target — the error is ' +
    'one-directional and accumulates, which is what makes it invisible');
}

check(revealIndex(9999, ROW_SECONDS, 10) === 9,
  'revealIndex: clamps to the last row rather than running off the mesh');
check(revealIndex(-5, ROW_SECONDS, 100) === 0,
  'revealIndex: a negative time is row 0, not a negative index');
check(revealIndex(NaN, ROW_SECONDS, 100) === 0,
  'revealIndex: NaN is row 0 — an <audio> element reports it before metadata loads, ' +
  'which is a normal frame and not a fault');
check(revealIndex(10, ROW_SECONDS, 0) === -1,
  'revealIndex: a mesh with no rows reveals nothing');
check(revealIndex(10, 0, 100) === -1 && revealIndex(10, -1, 100) === -1,
  'revealIndex: a non-positive row duration reveals nothing rather than dividing by zero');
check(rowsRevealed(0, ROW_SECONDS, 100) === 1 && rowsRevealed(10, ROW_SECONDS, 0) === 0,
  'rowsRevealed: revealIndex + 1, and 0 for an empty mesh');

/* ── planReveal ───────────────────────────────────────────────────────────── */
const frame = (over) => ({ trackId: 7, currentTime: 0, rowSeconds: ROW_SECONDS, rows: 100, ...over });

{
  const plan = planReveal(emptyReveal(), frame({ currentTime: 0 }));
  check(plan.action === 'reset' && plan.clear === true && plan.from === 0 && plan.to === 1,
    'planReveal: a first frame is a reset — there is no canvas to append to');
}
{
  const state = { trackId: 7, painted: 4 };
  const plan = planReveal(state, frame({ currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'append' && plan.from === 4 && plan.to === 5 && plan.clear === false,
    'planReveal: time moving forward APPENDS the new rows only');
  check(plan.next.painted === 5, 'planReveal: …and carries the new count forward');
}
{
  // ⚠️ THE PAUSE CASE, and it is not special-cased. A paused element's
  // currentTime does not move, so the target does not move. A `paused` flag here
  // would be a second source of truth about whether time is passing.
  const state = { trackId: 7, painted: 5 };
  const plan = planReveal(state, frame({ currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'idle' && plan.from === plan.to && plan.clear === false,
    'planReveal: a paused frame draws nothing, without anything having to know it is paused');
  check(plan.next === state, 'planReveal: …and does not churn the state object');
}
{
  const state = { trackId: 7, painted: 40 };
  const plan = planReveal(state, frame({ currentTime: 5 * ROW_SECONDS }));
  check(plan.action === 'repaint' && plan.clear === true && plan.from === 0 && plan.to === 6,
    'planReveal: a seek BACKWARDS clears and repaints from row 0 — a canvas cannot un-draw');
}
{
  const state = { trackId: 7, painted: 40 };
  const plan = planReveal(state, frame({ trackId: 8, currentTime: 0 }));
  check(plan.action === 'reset' && plan.clear === true && plan.to === 1,
    'planReveal: a different track RESETS — the previous mesh is no longer the picture');
}
{
  // A track change to the same position must not be mistaken for a pause: the
  // rows are different rows even when the count is identical.
  const state = { trackId: 7, painted: 5 };
  const plan = planReveal(state, frame({ trackId: 8, currentTime: 4 * ROW_SECONDS + 0.1 }));
  check(plan.action === 'reset',
    'planReveal: a track change at the same offset is a reset, never an idle');
}
{
  // The append path must be exact: replaying a whole track one frame at a time
  // must paint every row exactly once and never repaint.
  let state = emptyReveal();
  let painted = 0, repaints = 0;
  for (let t = 0; t <= 100 * ROW_SECONDS; t += 0.05) {
    const plan = planReveal(state, frame({ currentTime: t }));
    if (plan.clear) repaints++;
    painted += plan.to - plan.from;
    state = plan.next;
  }
  check(repaints === 1 && painted === 100,
    `planReveal: a whole track paints each of its 100 rows exactly once after one initial ` +
    `clear (got ${painted} rows, ${repaints} clears) — this is the append-only property ` +
    `the whole renderer's cost model rests on`);
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */
check(rowPitch(4) === MIN_ROW_PITCH && rowPitch(20) === 20 && rowPitch(NaN) === MIN_ROW_PITCH,
  `rowPitch: clamps up to ${MIN_ROW_PITCH} px — below it M2 measured the stack collapsing ` +
  'into a uniform hatch, which reads as "the transform is broken"');
check(canvasHeight(0, 12, 40) === 80 && canvasHeight(1, 12, 40) === 80,
  'canvasHeight: one row still needs its own excursion room above and below');
check(canvasHeight(600, 9, 40) === 40 + 599 * 9 + 40,
  'canvasHeight: a 20-minute track is 5,471 px tall, which is why it pans rather than fits');
check(rowBaseline(0, 12, 40) === 40 && rowBaseline(3, 12, 40) === 76,
  'rowBaseline: row 0 sits one amplitude down, each later row one pitch further');

{
  // Early in a track the stack is shorter than the viewport: the offset must not
  // go negative and drag the picture off the top.
  check(panOffset(1, 600, 9, 40, 400, 320) === 0,
    'panOffset: clamps at 0 early on rather than pulling the picture off the top');
  // Mid-track the newest row sits exactly at the anchor.
  const mid = panOffset(200, 600, 9, 40, 400, 320);
  check(mid === rowBaseline(199, 9, 40) - 320,
    'panOffset: mid-track the newest row sits exactly at the anchor');
  // At the end it must not scroll past the canvas — blank space below the newest
  // row is the frame in which the picture appears to have stopped.
  const end = panOffset(600, 600, 9, 40, 400, 320);
  check(end === canvasHeight(600, 9, 40) - 400,
    'panOffset: clamps at the canvas end rather than scrolling into blank space');
  check(end >= mid, 'panOffset: is monotonic as the reveal advances');
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */
{
  const bytes = new Uint8Array(3 * 4).map((_, i) => i * 10);
  const rows = toRows(bytes, 3, 4);
  check(rows.length === 3 && rows[1][0] === 40,
    'toRows: row-major, so row 1 starts at byte 4');
  let threw = false;
  try { toRows(new Uint8Array(5), 3, 4); } catch { threw = true; }
  check(threw,
    'toRows: a length that does not match the declared shape THROWS — reshaping a short ' +
    'buffer against a remembered row count is a picture with a wrapped time axis');
}
{
  const pts = rowPoints(new Uint8Array([0, 255, 0]), 100, 200, 40);
  check(pts.length === 6, 'rowPoints: two numbers per band');
  check(pts[0] === 0 && pts[2] === 100 && pts[4] === 200,
    'rowPoints: bands span the full width, first at 0 and last at width');
  check(pts[1] === 100 && pts[3] === 60,
    'rowPoints: 0 sits on the baseline and 255 is a full amplitude above it');

  // ⚠️ THE THIRD PLACE A PER-TRACK NORMALISER COULD ENTER — after the builder and
  // the quantiser, and the only one that leaves the stored bytes correct. A quiet
  // row and a loud row must draw at different heights against the SAME span.
  const quiet = rowPoints(new Uint8Array([60, 60]), 100, 200, 40);
  const loud = rowPoints(new Uint8Array([200, 200]), 100, 200, 40);
  check(quiet[1] > loud[1],
    'rowPoints: a quiet row draws lower than a loud one — nothing here rescales per row, ' +
    'which is the one edit that would make the whole picture meaningless');
  check(rowPoints(new Uint8Array([]), 100, 200, 40).length === 0,
    'rowPoints: an empty row is an empty polyline, not a crash');
}

/* ── The purity contract ──────────────────────────────────────────────────────
   The module is transpiled and imported in isolation above, so a runtime import
   would already have failed. This asserts the OTHER half: that nothing in it
   reaches for a clock. `setInterval` desynchronises on buffering, on seek, and on
   a playback-rate change, and packages/player has a rate module — so this is not
   a hypothetical. */
{
  const src = readFileSync(resolve(root, 'apps/kouros/src/components/pulsarmap.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['setInterval', 'setTimeout', 'Date.now', 'performance.now',
                        'requestAnimationFrame']) {
    check(!src.includes(banned),
      `purity: pulsarmap.ts holds no ${banned} — the reveal is driven by currentTime, ` +
      'per animation frame, by its caller');
  }
  check(!/^import\s/m.test(src) || /^import type\s/m.test(src),
    'purity: no runtime imports, so this gate can transpile the one file in isolation');
}

/* ══ The 3-D pulsarmap (components/ridges3d) ═══════════════════════════════════
   The same mesh, stood up in space. What can go silently wrong there: a texture
   layout that wraps a long track into the wrong texels (a plausible picture of the
   wrong rows), a shader whose (row, band) arithmetic drifts from the TypeScript the
   tests read, a camera that follows a row other than the newest, a spring that
   overshoots, an orbit that dives under the floor — and a per-track normaliser
   slipped into the one place no store-side test can see. */
const motion = await importTs('apps/kouros/src/components/webgl/motion.ts', 'motion.mjs');
const stage = await importTs('apps/kouros/src/components/ridges3d/stage.ts', 'stage.mjs', {
  '../pulsarmap': './pulsarmap.mjs', '../webgl/motion': './motion.mjs',
});
const {
  textureLayout, texelOf, packTexture, cellOf, visibleWindow, followPose, orbitFromDrag, shouldCut,
  rowZ, rowHeight, rampOf, PITCH, AMPLITUDE, VISIBLE_ROWS, LOOK_BEHIND, MIN_PITCH, MAX_PITCH, MAX_YAW,
  CUT_ROWS,
} = stage;
const glSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/gl.ts'), 'utf8');

/* ── the texture layout ───────────────────────────────────────────────────── */
for (const rows of [10, 600, 2500]) {
  const bands = 128;
  const layout = textureLayout(rows, bands, 2048);
  check(layout.width <= 2048 && layout.height <= 2048,
    `textureLayout: ${rows} rows fit a 2048 texture (${layout.width}×${layout.height})`);
  const bytes = new Uint8Array(rows * bands);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) % 251;   // no two neighbours alike
  const tex = packTexture(bytes, layout);
  let bad = 0;
  const seen = new Set();
  for (let r = 0; r < rows; r++) {
    for (let b = 0; b < bands; b++) {
      const [x, y] = texelOf(r, b, layout);
      const key = y * layout.width + x;
      if (seen.has(key) || x >= layout.width || y >= layout.height || tex[key] !== bytes[r * bands + b]) bad++;
      seen.add(key);
    }
  }
  check(bad === 0,
    `textureLayout: every one of ${rows}×${bands} cells round-trips through its own texel` +
    (rows > 2048 ? ' — including across the WRAP into a second column' : ''));
}
{
  let threw = false;
  try { packTexture(new Uint8Array(5), textureLayout(3, 4)); } catch { threw = true; }
  check(threw, 'packTexture: a length that does not match the declared shape throws, as toRows does');
}

/* ── the shader and the TypeScript agree ─────────────────────────────────── */
{
  const src = glSrc.replace(/\/\/.*$/gm, '');
  check(/int row = u_rowStart \+ gl_InstanceID \/ u_segments;/.test(src),
    'shader: row = u_rowStart + gl_InstanceID / u_segments — the expression cellOf mirrors');
  check(/int band = gl_InstanceID % u_segments;/.test(src),
    'shader: band = gl_InstanceID % u_segments — the expression cellOf mirrors');
  check(/int column = row \/ u_rowsPerColumn;/.test(src) &&
        /ivec2\(band \+ column \* u_bands, row - column \* u_rowsPerColumn\)/.test(src),
    'shader: heightAt reads the texel texelOf computes, wrap included');
  const segments = 7, rowStart = 13;
  let mismatches = 0;
  for (let id = 0; id < segments * 9; id++) {
    const { row, band } = cellOf(id, rowStart, segments);
    // GLSL integer division truncates; for these non-negative ids it is floor.
    if (row !== rowStart + Math.trunc(id / segments) || band !== id % segments) mismatches++;
  }
  check(mismatches === 0, 'cellOf: agrees with the shader\'s integer arithmetic on every instance');
  const cells = new Set();
  for (let id = 0; id < segments * 9; id++) {
    const { row, band } = cellOf(id, rowStart, segments);
    cells.add(`${row}:${band}`);
  }
  check(cells.size === segments * 9, 'cellOf: no two instances draw the same segment');

  // ⚠️ THE FOURTH PLACE A PER-TRACK NORMALISER COULD ENTER.
  const shader = src.slice(src.indexOf('RIDGE_VERTEX'), src.indexOf('RIDGE_FRAGMENT'));
  const heightFn = shader.slice(shader.indexOf('float heightAt'), shader.indexOf('vec3 cell('));
  check(/texelFetch\(u_mesh, texel, 0\)\.r \* AMPLITUDE;/.test(heightFn) && !/(max|min|clamp)\(/.test(heightFn)
        && !/u_(max|min|peak|gain|scale)/i.test(shader),
    'shader: a height is the byte over the fixed span × AMPLITUDE — no max/min/gain, nothing per track');
  check(rowHeight(255) === AMPLITUDE && rowHeight(0) === 0 && rowHeight(51) < rowHeight(204),
    'rowHeight: bytes over the fixed 0…255 span, the one definition the shader mirrors');
}

/* ── the reveal window ────────────────────────────────────────────────────── */
{
  check(visibleWindow(0, ROW_SECONDS, 100).end === 1 && visibleWindow(0, ROW_SECONDS, 100).start === 0,
    'visibleWindow: row 0 is drawn from t = 0');
  const mid = visibleWindow(120, ROW_SECONDS, 600);
  const newest = revealIndex(120, ROW_SECONDS, 600);
  check(mid.end === newest + 1 && mid.end - mid.start === VISIBLE_ROWS,
    'visibleWindow: always contains the newest row, and at most VISIBLE_ROWS of them');
  const late = visibleWindow(1e6, ROW_SECONDS, 600);
  check(late.end === 600 && late.start === 600 - VISIBLE_ROWS,
    'visibleWindow: clamps at the end of the track — no rows past the mesh');
  check(visibleWindow(NaN, ROW_SECONDS, 600).end === 1,
    'visibleWindow: an element with no metadata yet (NaN) is t = 0, not an empty picture');
  let everyRow = true;
  for (let t = 0; t < 600 * ROW_SECONDS; t += 0.37) {
    const w = visibleWindow(t, ROW_SECONDS, 600);
    if (!(w.start <= revealIndex(t, ROW_SECONDS, 600) && revealIndex(t, ROW_SECONDS, 600) < w.end)) everyRow = false;
  }
  check(everyRow, 'visibleWindow: over a whole 20-minute track, the newest row is inside the window at every frame');
}

/* ── the camera ───────────────────────────────────────────────────────────── */
{
  const w = visibleWindow(64, ROW_SECONDS, 600);
  const pose = followPose(w);
  check(pose.focusZ === rowZ(w.end - 1) && pose.target[2] === pose.focusZ - LOOK_BEHIND,
    'followPose: follows EXACTLY the newest revealed row, aiming behind it');
  check(pose.yaw === 0, 'followPose: the follow view is not orbited');
  check(shouldCut(rowZ(10), rowZ(11)) === false && shouldCut(rowZ(10), rowZ(10 + CUT_ROWS + 1)) === true,
    'shouldCut: one row of playback glides; a seek cuts');
  check(rowZ(5) > rowZ(4), 'rowZ: the newer row is nearer the camera, as new rows arrive in front in 2-D');

  let pitchOk = true, yawOk = true;
  for (const dx of [-5000, -300, -1, 0, 1, 300, 5000]) {
    for (const dy of [-5000, -300, -1, 0, 1, 300, 5000]) {
      const o = orbitFromDrag({ yaw: 0, pitch: 20 * Math.PI / 180 }, dx, dy);
      if (!(o.pitch >= MIN_PITCH && o.pitch <= MAX_PITCH)) pitchOk = false;
      if (!(Math.abs(o.yaw) <= MAX_YAW)) yawOk = false;
    }
  }
  check(pitchOk, 'orbitFromDrag: pitch never leaves [8°, 70°] for any drag — never under the floor');
  check(yawOk, 'orbitFromDrag: yaw is bounded, so the stack never turns edge-on');
  check(rampOf(0, 600) === 0 && rampOf(599, 600) === 1 && rampOf(0, 1) === 1,
    'rampOf: the ramp encodes POSITION IN THE TRACK, as in 2-D');
}

/* ── the spring ───────────────────────────────────────────────────────────── */
{
  const { springStep, springSettled } = motion;
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
}

/* ── the matrices ─────────────────────────────────────────────────────────── */
{
  const { perspective, lookAt, multiply, invert, toScreen, orbitEye, identity } = motion;
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
}

/* ── purity, for the new pure modules too ──────────────────────────────────── */
for (const rel of ['apps/kouros/src/components/ridges3d/stage.ts', 'apps/kouros/src/components/webgl/motion.ts']) {
  const src = readFileSync(resolve(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const clocks = ['setInterval', 'setTimeout', 'Date.now', 'performance.now', 'requestAnimationFrame']
    .filter((b) => src.includes(b));
  check(!clocks.length, `purity: ${rel.split('/').pop()} holds no clock (${clocks.join(', ') || 'none'})`);
  check(!/\b(document|window)\./.test(src), `purity: ${rel.split('/').pop()} touches no DOM`);
}

if (failed) {
  console.error(`\n✗ pulsarmap: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ pulsarmap: all assertions passed');
