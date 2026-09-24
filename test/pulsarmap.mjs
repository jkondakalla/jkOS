// pulsarmap.mjs — the pure math under the pulsarmap renderer (ALGORITHMS.md §9).
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
import { transpileSceneMath } from '../packages/scene/test/transpile.mjs';

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
  MIN_ROW_PITCH, rowPitch, revealIndex, rowsRevealed, scrollRow, stripWindow, stripBaseline, rowPoints, toRows,
} = pm;

/* The mesh music/mesh.py actually builds at the baseline configuration. The row
   duration is DERIVED (4 frames of 512 samples at 22.05 kHz), not the 0.1 s
   target — and the gap between them is what this file exists to keep honest.
   (It was 86 frames, 1.9969 s, until Jag asked for a visualizer on 2026-09-23.) */
const ROW_SECONDS = (4 * 512) / 22050;
const TARGET = 0.1;

/* ── revealIndex ──────────────────────────────────────────────────────────── */
check(revealIndex(0, ROW_SECONDS, 100) === 0,
  'revealIndex: row 0 is present from t=0, not a row in');
check(revealIndex(0.0928, ROW_SECONDS, 100) === 0,
  'revealIndex: still row 0 just before the boundary');
check(revealIndex(0.0929, ROW_SECONDS, 100) === 1,
  'revealIndex: row 1 has arrived just after 0.09288 s');
check(revealIndex(60, ROW_SECONDS, 1000) === Math.floor(60 / ROW_SECONDS),
  'revealIndex: floor(currentTime / rowSeconds), plainly');

// ⚠️ THE DRIFT ASSERTION, and the reason `row_seconds` ships in the mesh at all.
// A renderer that used the 0.1 s TARGET instead of the derived duration falls a
// whole row behind every ~1.3 s of music — by the end of a four-minute track it is
// 184 rows (17 s) behind the song it claims to picture.
{
  check(revealIndex(1.25, ROW_SECONDS, 100000) === 13 && revealIndex(1.25, TARGET, 100000) === 12,
    'revealIndex: 1.25 s in, the derived duration is on row 13 and the 0.1 s target on 12 — ' +
    'a whole row out already');
  check(revealIndex(240, ROW_SECONDS, 100000) - revealIndex(240, TARGET, 100000) === 183,
    'revealIndex: four minutes in, the target is 183 rows (17 s) behind — which is why the mesh ' +
    'SHIPS row_seconds instead of the renderer assuming 0.1');
  let behind = 0;
  for (let t = 0; t < 1200; t += 0.05) {
    if (revealIndex(t, ROW_SECONDS, 100000) < revealIndex(t, TARGET, 100000)) behind++;
  }
  check(behind === 0,
    'revealIndex: the derived duration is never BEHIND the target — the error is ' +
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

/* ── scrollRow — the one number both renderers are positioned by ─────────── */
{
  // ⚠️ floor(scroll) IS revealIndex, at every instant: the continuous flow and the
  // discrete reveal can never disagree about which row is the newest.
  let agree = true, monotone = true, prev = -Infinity;
  for (let t = -1; t < 3000 * ROW_SECONDS; t += 0.0137) {
    const sc = scrollRow(t, ROW_SECONDS, 2584);
    if (Math.floor(sc) !== revealIndex(t, ROW_SECONDS, 2584)) agree = false;
    if (sc < prev) monotone = false;
    prev = sc;
  }
  check(agree, 'scrollRow: floor(scroll) === revealIndex at every instant of a whole track and past its end');
  check(monotone, 'scrollRow: never runs backwards while time runs forwards');
  check(scrollRow(5 * ROW_SECONDS, ROW_SECONDS, 100) === 5 && Math.abs(scrollRow(5.5 * ROW_SECONDS, ROW_SECONDS, 100) - 5.5) < 1e-9,
    'scrollRow: CONTINUOUS — exactly r at row r\'s instant, and halfway between rows halfway through one');
  check(scrollRow(1e6, ROW_SECONDS, 100) === 99, 'scrollRow: stops at the last row at the end of the track');
  check(scrollRow(NaN, ROW_SECONDS, 100) === 0 && scrollRow(-3, ROW_SECONDS, 100) === 0,
    'scrollRow: NaN (no metadata yet) and a negative time are row 0');
  check(scrollRow(3, ROW_SECONDS, 0) === -1 && scrollRow(3, 0, 100) === -1,
    'scrollRow: an empty mesh or a non-positive row duration is −1, nothing to show');
  // Paused: currentTime does not move, so the scroll does not move — nothing has to
  // know it is paused. A `paused` flag here would be a second source of truth.
  check(scrollRow(12.34, ROW_SECONDS, 1000) === scrollRow(12.34, ROW_SECONDS, 1000),
    'scrollRow: a pure function of the time — a paused frame is the same frame');
}

/* ── the 2-D strip: a window, redrawn each frame ─────────────────────────── */
check(rowPitch(4) === MIN_ROW_PITCH && rowPitch(20) === 20 && rowPitch(NaN) === MIN_ROW_PITCH,
  `rowPitch: clamps up to ${MIN_ROW_PITCH} px — below it M2 measured the stack collapsing ` +
  'into a uniform hatch, which reads as "the transform is broken"');
{
  const pitch = 9, anchor = 110;
  check(stripBaseline(40, 40, pitch, anchor) === anchor,
    'stripBaseline: the row arriving now sits exactly at the anchor');
  check(stripBaseline(40, 41, pitch, anchor) === anchor - pitch,
    'stripBaseline: one row of music later it has risen exactly one pitch');
  check(Math.abs(stripBaseline(40, 40.5, pitch, anchor) - (anchor - pitch / 2)) < 1e-9,
    'stripBaseline: and it rises CONTINUOUSLY in between — the strip flows, it does not step');
  let window = true, newest = true, bounded = true;
  for (let sc = 0; sc < 3000; sc += 0.37) {
    const w = stripWindow(sc, pitch, anchor);
    if (w.to !== Math.floor(sc) + 1) newest = false;
    // Every row it leaves out is wholly above the top edge; every row it keeps reaches into view.
    if (w.from > 0 && stripBaseline(w.from - 1, sc, pitch, anchor) + pitch > 0) window = false;
    if (stripBaseline(w.from, sc, pitch, anchor) + pitch <= -pitch) window = false;
    if (w.to - w.from > Math.ceil((anchor + pitch) / pitch) + 2) bounded = false;
  }
  check(newest, 'stripWindow: always ends with the newest revealed row');
  check(window, 'stripWindow: drops only rows wholly above the top edge, keeps every row still in view');
  check(bounded, 'stripWindow: a bounded window (~anchor/pitch rows) however long the track — no full-track canvas');
  const early = stripWindow(0.4, pitch, anchor);
  check(early.from === 0 && early.to === 1, 'stripWindow: at the very start only row 0 is drawn');
  check(stripWindow(-1, pitch, anchor).to === 0, 'stripWindow: an empty mesh (scroll −1) draws nothing');
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
// stage.ts imports @jkos/scene/math; that layer is transpiled beside it.
const scene = await import(transpileSceneMath(join(tmp, 'scene')));
const stage = await importTs('apps/kouros/src/components/ridges3d/stage.ts', 'stage.mjs', {
  '../pulsarmap': './pulsarmap.mjs', '@jkos/scene/math': './scene/index.mjs',
});
const {
  cellOf, visibleWindow, followPose, rowZ, rowHeight, rampOf, ORBIT, AMPLITUDE, VISIBLE_ROWS,
  LOOK_BEHIND, MIN_PITCH, MAX_PITCH, MAX_YAW, FOG_FAR, PITCH,
} = stage;
const glSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/gl.ts'), 'utf8');

/* The mesh's texture layout (rows × bands wrapped past the texture limit) is
   @jkos/scene's `textureLayout` / `texelOf` / `packTexture`, round-tripped for 10, 600
   and 2,500 rows of 128 bands by packages/scene/test/scene.test.mjs. */
{
  // At ~10.8 rows a second the wrap is the ORDINARY case now: a four-minute track is
  // 2,584 rows, two columns under WebGL2's guaranteed 2,048; RidgeRenderer asks for up
  // to 4,096, which holds one column up to ~6 minutes and 3.4 hours in all.
  const four = scene.textureLayout(2584, 128, 2048);
  check(four.columns === 2 && four.width === 256,
    'textureLayout: a four-minute track (2,584 rows of 128) wraps into two columns at the guaranteed 2,048');
  const long = scene.textureLayout(Math.ceil(70 * 60 / ROW_SECONDS), 128, 4096);
  check(long.width <= 4096, `textureLayout: a 70-minute track fits a 4,096 texture (${long.columns} columns)`);
}

/* ── the shader and the TypeScript agree ─────────────────────────────────── */
{
  const src = glSrc.replace(/\/\/.*$/gm, '');
  check(/int row = u_rowStart \+ gl_InstanceID \/ u_segments;/.test(src),
    'shader: row = u_rowStart + gl_InstanceID / u_segments — the expression cellOf mirrors');
  check(/int band = gl_InstanceID % u_segments;/.test(src),
    'shader: band = gl_InstanceID % u_segments — the expression cellOf mirrors');
  check(/\$\{MATRIX_TEXEL_GLSL\}/.test(src) &&
        /ivec2 texel = matrixTexel\(row, band, u_bands, u_rowsPerColumn\);/.test(src),
    'shader: heightAt reads the texel @jkos/scene\'s texelOf computes (its GLSL, pasted in), wrap included');
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
  check(/texelFetch\(u_mesh, texel, 0\)\.r \* AMPLITUDE;/.test(heightFn) && !/\b(max|min|clamp)\(/.test(heightFn)
        && !/u_(max|min|peak|gain|scale)/i.test(shader),
    'shader: a height is the byte over the fixed span × AMPLITUDE — no max/min/gain, nothing per track');
  check(rowHeight(255) === AMPLITUDE && rowHeight(0) === 0 && rowHeight(51) < rowHeight(204),
    'rowHeight: bytes over the fixed 0…255 span, the one definition the shader mirrors');
}

/* ── the reveal window ────────────────────────────────────────────────────── */
{
  check(visibleWindow(0, ROW_SECONDS, 100).end === 1 && visibleWindow(0, ROW_SECONDS, 100).start === 0,
    'visibleWindow: row 0 is drawn from t = 0');
  const TWENTY = Math.ceil(20 * 60 / ROW_SECONDS);           // a 20-minute track: 12,920 rows
  const mid = visibleWindow(120, ROW_SECONDS, TWENTY);
  const newest = revealIndex(120, ROW_SECONDS, TWENTY);
  check(mid.end === newest + 1 && mid.end - mid.start === VISIBLE_ROWS,
    'visibleWindow: always contains the newest row, and at most VISIBLE_ROWS of them');
  const late = visibleWindow(1e6, ROW_SECONDS, TWENTY);
  check(late.end === TWENTY && late.start === TWENTY - VISIBLE_ROWS,
    'visibleWindow: clamps at the end of the track — no rows past the mesh');
  check(visibleWindow(NaN, ROW_SECONDS, TWENTY).end === 1,
    'visibleWindow: an element with no metadata yet (NaN) is t = 0, not an empty picture');
  let everyRow = true, fogged = true;
  for (let t = 0; t < 20 * 60; t += 0.0371) {
    const w = visibleWindow(t, ROW_SECONDS, TWENTY);
    if (!(w.start <= revealIndex(t, ROW_SECONDS, TWENTY) && revealIndex(t, ROW_SECONDS, TWENTY) < w.end)) everyRow = false;
    // ⚠️ The stack flows continuously now, so a row LEAVES the window mid-frame-stream.
    // It must already be fully fogged into the surface when it does, or the far edge
    // blinks ~11 times a second.
    const focus = followPose(scrollRow(t, ROW_SECONDS, TWENTY)).focusZ;
    if (w.start > 0 && focus - rowZ(w.start - 1) < FOG_FAR) fogged = false;
  }
  check(everyRow, 'visibleWindow: over a whole 20-minute track, the newest row is inside the window at every frame');
  check(fogged, 'visibleWindow: every row that leaves the window has already faded into the fog — the far edge never blinks');
}

/* ── the camera ───────────────────────────────────────────────────────────── */
{
  const sc = scrollRow(64.03, ROW_SECONDS, 2584);
  const pose = followPose(sc);
  check(pose.focusZ === rowZ(sc) && pose.target[2] === pose.focusZ - LOOK_BEHIND,
    'followPose: rides the continuous playhead EXACTLY, aiming behind it — no spring to lag the music');
  const arrive = followPose(scrollRow(700 * ROW_SECONDS, ROW_SECONDS, 2584));
  check(Math.abs(arrive.focusZ - rowZ(700)) < 1e-9, 'followPose: at the instant a row arrives, the camera is on it');
  check(pose.yaw === 0, 'followPose: the follow view is not orbited');
  // The flow is continuous: at 60 fps each frame moves the focus by the same small
  // step — never a jump when a row arrives.
  let steady = true;
  const perFrame = PITCH * (1 / 60) / ROW_SECONDS;
  for (let f = 1; f < 600; f++) {
    const a = followPose(scrollRow((f - 1) / 60, ROW_SECONDS, 2584)).focusZ;
    const b = followPose(scrollRow(f / 60, ROW_SECONDS, 2584)).focusZ;
    if (Math.abs((b - a) - perFrame) > 1e-9) steady = false;
  }
  check(steady, `followPose: flows ${perFrame.toFixed(4)} world units every 60 fps frame, steadily — no step on a row boundary`);
  check(rowZ(5) > rowZ(4), 'rowZ: the newer row is nearer the camera, as new rows arrive in front in 2-D');

  let pitchOk = true, yawOk = true;
  for (const dx of [-5000, -300, -1, 0, 1, 300, 5000]) {
    for (const dy of [-5000, -300, -1, 0, 1, 300, 5000]) {
      const o = scene.orbitDrag({ yaw: 0, pitch: 20 * Math.PI / 180 }, dx, dy, ORBIT);
      if (!(o.pitch >= MIN_PITCH && o.pitch <= MAX_PITCH)) pitchOk = false;
      if (!(Math.abs(o.yaw) <= MAX_YAW)) yawOk = false;
    }
  }
  check(pitchOk, 'ORBIT: pitch never leaves [8°, 70°] for any drag — never under the floor');
  check(yawOk, 'ORBIT: yaw is bounded, so the stack never turns edge-on');
  check(rampOf(0, 2584) === 0 && rampOf(2583, 2584) === 1 && rampOf(0, 1) === 1,
    'rampOf: the ramp encodes POSITION IN THE TRACK, as in 2-D');
}

/* The spring, the matrices and the orbit eye are @jkos/scene's now, and are held by
   its own test (packages/scene/test/scene.test.mjs) — every view shares them. */

/* ── purity, for the new pure modules too ──────────────────────────────────── */
for (const rel of ['apps/kouros/src/components/ridges3d/stage.ts']) {
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
