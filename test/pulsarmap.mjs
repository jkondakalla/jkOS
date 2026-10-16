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
// REAL functions — the house pattern, test/lib/unit.mjs.
//
// Run:  node test/pulsarmap.mjs   (wired as `pnpm check:pulsarmap`, folded into
//                                   `pnpm test:contracts`).
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unit } from './lib/unit.mjs';
import { transpileSceneMath } from '../packages/scene/test/transpile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const { check, importTs, tmp, done } = unit('pulsarmap');

const pm = await importTs('apps/kouros/src/components/pulsarmap.ts', 'pulsarmap.mjs');
const {
  MIN_ROW_PITCH, rowPitch, revealIndex, scrollRow, liveRow, stripWindow, stripBaseline, rowPoints, toRows,
  X_WARP, bandFraction,
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
  check(pts[0] === 0 && pts[4] === 200,
    'rowPoints: bands span the full width, first at 0 and last at width');
  check(pts[2] === bandFraction(1, 3) * 200,
    'rowPoints: a band sits where bandFraction puts it — the one band axis, shared with the 3-D shader');
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

/* ── The band axis ────────────────────────────────────────────────────────────
   ⚠️ Warped, not linear (Jag 2026-10-14, "a right-leaning tail"): the lows are
   where the peaks are sharp, so they get the width. Measured, not tuned — see
   pulsarmap.ts and ALGORITHMS.md §9. */
{
  check(bandFraction(0, 128) === 0 && bandFraction(127, 128) === 1,
    'bandFraction: the lowest band is the left edge and the highest the right — nothing cropped');
  let rising = true;
  for (let b = 1; b <= 127 * 4; b++) if (!(bandFraction(b / 4, 128) > bandFraction((b - 1) / 4, 128))) rising = false;
  check(rising, 'bandFraction: strictly increasing, fractional bands included — no two bands ever swap or meet');
  check(X_WARP > 0.6 && X_WARP < 0.85 && bandFraction(63.5, 128) > 0.6,
    `bandFraction: the axis widens the lows (u^${X_WARP}) — the middle band sits right of centre, ` +
    'so the left half of the line is no longer where every peak is');
  // The measured target: band 46 holds the cumulative median of peak sharpness.
  // Linear drew it at 36 % of the width; warped it lands near the middle.
  const median = bandFraction(46, 128);
  check(median > 0.43 && median < 0.55,
    `bandFraction: the sharpness median (band 46) lands mid-line (${(median * 100).toFixed(0)} %), not at 36 %`);
  check(bandFraction(5, 1) === 0 && bandFraction(-3, 128) === 0 && bandFraction(999, 128) === 1,
    'bandFraction: a one-band row and out-of-range bands stay on the line');
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
const balance = await importTs('apps/kouros/src/components/ridges3d/balance.ts', 'balance.mjs');
const coverPalette = await importTs('apps/kouros/src/components/ridges3d/coverPalette.ts', 'coverPalette.mjs');
const vaporSignals = await importTs('apps/kouros/src/components/ridges3d/vaporSignals.ts', 'vaporSignals.mjs');
const stage = await importTs('apps/kouros/src/components/ridges3d/stage.ts', 'stage.mjs', {
  '../pulsarmap': './pulsarmap.mjs', '@jkos/scene/math': './scene/index.mjs', './balance': './balance.mjs',
});
const {
  cellOf, liveWindow, lineOf, liveValue, bandCurve, rowCurve, rowsNeeded, slotOf, segmentsOf, columnsOf,
  followPose, rowZ, rowHeight, rampOf, ORBIT, AMPLITUDE, VISIBLE_ROWS, RING, SUBDIVISIONS, COLUMN_EVERY,
  LOOK_BEHIND, MIN_PITCH, MAX_PITCH, MAX_YAW, FOG_FAR, PITCH, DETAIL, shapeMesh, columnBands, trianglesOf,
  SOFTWARE_MAX_TRIANGLES, LINE_WIDTH_PX, LIVE_WIDTH_PX, settle, liveAt, lineTime,
} = stage;
const glSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/gl.ts'), 'utf8');

/* ── the shader and the TypeScript agree ─────────────────────────────────── */
{
  const src = glSrc.replace(/\/\/.*$/gm, '');
  check(/int line = gl_InstanceID \/ u_per;/.test(src),
    'shader: line = gl_InstanceID / u_per — the expression cellOf mirrors');
  check(/int seg = gl_InstanceID % u_per;/.test(src),
    'shader: seg = gl_InstanceID % u_per — the expression cellOf mirrors');
  let mismatches = 0;
  const cells = new Set();
  for (const per of [7, segmentsOf(128), columnsOf(128)]) {
    for (let id = 0; id < per * 9; id++) {
      const { line, seg } = cellOf(id, per);
      // GLSL integer division truncates; for these non-negative ids it is floor.
      if (line !== Math.trunc(id / per) || seg !== id % per) mismatches++;
      cells.add(`${per}:${line}:${seg}`);
    }
  }
  check(mismatches === 0, 'cellOf: agrees with the shader\'s integer arithmetic on every instance');
  check(cells.size === 9 * (7 + segmentsOf(128) + columnsOf(128)), 'cellOf: no two instances draw the same piece');
  check(segmentsOf(128) === 127 * SUBDIVISIONS && columnsOf(128) === 32 && (columnsOf(128) - 1) * COLUMN_EVERY <= 127,
    'segmentsOf / columnsOf: every gap between bands is subdivided, and the grid\'s last column is a real band');

  // The ring: what a slot holds is the row the shader asks it for.
  check(/ivec2 texel = ivec2\(seg, row % u_ring\);/.test(src) && /gl\.uniform1i\(u\.u_ring, RING\);/.test(glSrc)
        && slotOf(RING + 5) === 5 && slotOf(5) === 5,
    'shader: a row\'s curve is read from slot row % u_ring, the ring is RING rows — the arithmetic slotOf mirrors');
  check(/mix\(heightAt\(u_liveRow, seg\), heightAt\(next, seg\), u_liveFrac\)/.test(src)
        && /int next = min\(u_liveRow \+ 1, u_rows - 1\);/.test(src),
    'shader: the live line is the rows either side of it, blended by its fraction — liveValue');

  // ⚠️ THE FOURTH PLACE A PER-TRACK NORMALISER COULD ENTER.
  const shader = src.slice(src.indexOf('RIDGE_VERTEX'), src.indexOf('RIDGE_FRAGMENT'));
  const heightFn = shader.slice(shader.indexOf('float heightAt'), shader.indexOf('float lineHeight'));
  check(/texelFetch\(u_curves, texel, 0\)\.r \* AMPLITUDE;/.test(heightFn) && !/\b(max|min|clamp)\(/.test(heightFn)
        && !/u_(max|min|peak|gain|scale)/i.test(shader),
    'shader: a height is the row\'s curve over the fixed span × AMPLITUDE — no max/min/gain, nothing per track');
  // The warp is the shaped mesh's: pulsarmap.ts X_WARP over every band, or 1 when the
  // low-poly columns were already placed along the warped axis (held below).
  check(/float x = -HALF_WIDTH \+ 2\.0 \* HALF_WIDTH \* pow\(u, u_warp\);/.test(shader)
        && /gl\.uniform1f\(u\.u_warp, mesh\.warp\);/.test(src)
        && /import \{[^}]*\bX_WARP\b[^}]*\} from '\.\.\/pulsarmap'/.test(
          readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/stage.ts'), 'utf8'))
        && shapeMesh(new Uint8Array(4 * 128), 4, 128, ROW_SECONDS, DETAIL.high).warp === X_WARP,
    'shader: x is the warped band axis, its exponent pulsarmap.ts X_WARP — one band axis for 2-D and 3-D');
  check(/float u = float\(seg\) \/ float\(\(u_bands - 1\) \* u_sub\);/.test(shader)
        && /int column = seg \* u_columnEvery \* u_sub;/.test(shader),
    'shader: segments and grid columns are the detail\'s — the arithmetic segmentsOf / columnsOf mirror');
  check(stage.bandX(0, 128) === -stage.HALF_WIDTH && stage.bandX(127, 128) === stage.HALF_WIDTH
        && stage.bandX(46, 128) === -stage.HALF_WIDTH + 2 * stage.HALF_WIDTH * pm.bandFraction(46, 128),
    'bandX: the 3-D band axis is bandFraction scaled to the world');
  check(rowHeight(255) === AMPLITUDE && rowHeight(0) === 0 && rowHeight(51) < rowHeight(204),
    'rowHeight: bytes over the fixed 0…255 span, the one definition the shader mirrors');
}

/* ── the curves ──────────────────────────────────────────────────────────────
   Every line is a spline through its bands' own values. What could go wrong
   silently: a curve that misses the stored byte at a band (the picture is no longer
   the analysis), a per-row rescale hidden in the spline, and — the one that matters
   for the live line — a spline that is not linear in the bytes, which would make a
   snapshot jump the instant it leaves the front. */
{
  const bands = 128, rows = 3;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bytes = Uint8Array.from({ length: rows * bands }, () => Math.floor(rnd() * 256));
  const n = segmentsOf(bands) + 1;
  const c0 = new Float32Array(n), c1 = new Float32Array(n);
  rowCurve(bytes, 0, bands, c0);
  rowCurve(bytes, 1, bands, c1);
  let through = true;
  for (let b = 0; b < bands; b++) if (Math.abs(c1[b * SUBDIVISIONS] - bytes[bands + b] / 255) > 1e-6) through = false;
  check(through, 'rowCurve: at every band the curve IS the stored byte over 255 — the spline only decides the way between');

  // The live line between rows 0 and 1, curved, equals the curve of the blended row.
  let linear = true;
  for (const f of [0, 0.25, 0.5, 0.9]) {
    const mixed = new Float32Array(n);
    const rowsF = Float32Array.from({ length: bands }, (_, b) => liveValue(bytes[b], bytes[bands + b], f));
    rowCurve(rowsF, 0, bands, mixed);
    for (let i = 0; i < n; i++) if (Math.abs(mixed[i] - liveValue(c0[i], c1[i], f)) > 1e-5) linear = false;
  }
  check(linear, 'rowCurve: linear in the bytes — the blend of two curves IS the curve of the blend, so the shader ' +
    'can blend curves and a snapshot leaves the front exactly the shape the live line had');
  const half = new Float32Array(n);
  rowCurve(Float32Array.from(bytes.subarray(bands, 2 * bands), (v) => v / 2), 0, bands, half);
  check(half.every((v, i) => Math.abs(v - c1[i] / 2) < 1e-6),
    'rowCurve: a row half as loud draws exactly half as high — nothing rescales per row');
  check(bandCurve(1, 2, 3, 4, 0) === 2 && Math.abs(bandCurve(1, 2, 3, 4, 0.5) - 2.5) < 1e-12,
    'bandCurve: starts on its own band, and a straight run of bands stays straight');
}

/* ── the live line and the snapshots ─────────────────────────────────────────
   Jag 2026-10-14: "the front-most line should be static and be a live, hi-res
   curve; the snapshots should look like they're being taken from it and pushed
   back". The live line stands at liveRow(t) — every frame, never a step — and row r
   is taken from it at the instant row r's CENTRE plays. */
{
  const TWENTY = Math.ceil(20 * 60 / ROW_SECONDS);           // a 20-minute track: 12,920 rows
  check(liveRow(0, ROW_SECONDS, 100) === 0 && liveRow(NaN, ROW_SECONDS, 100) === 0 && liveRow(-3, ROW_SECONDS, 100) === 0,
    'liveRow: starts on row 0 — and NaN (no metadata yet) or a negative time is row 0, not an empty picture');
  check(liveRow(1e6, ROW_SECONDS, 100) === 99 && liveRow(5, ROW_SECONDS, 0) === -1 && liveRow(5, 0, 100) === -1,
    'liveRow: clamps at the last row; an empty mesh or a bad row duration is −1');
  check(Math.abs(liveRow(700.5 * ROW_SECONDS, ROW_SECONDS, TWENTY) - 700) < 1e-9,
    'liveRow: is EXACTLY row r when row r\'s centre plays — a row\'s value belongs to the middle of its window');
  check(Math.abs(liveRow(64.03, ROW_SECONDS, TWENTY) - (64.03 / ROW_SECONDS - 0.5)) < 1e-9,
    'liveRow: half a row behind scrollRow, never ahead of the window it shows');

  // ⚠️ THE HAND-OFF. As row r's centre plays, r becomes the newest snapshot and sits
  // where the live line is; a frame later it is behind it. (A nanosecond past the
  // centre: AT it, t / rowSeconds can round to a hair under r, and floor picks r − 1.)
  const at = liveWindow(700.5 * ROW_SECONDS + 1e-9, ROW_SECONDS, TWENTY);
  const live = lineOf(at.lines - 1, at), newest = lineOf(at.lines - 2, at);
  check(live.live && !newest.live && newest.row === 700 && Math.abs(newest.z - live.z) < 1e-6,
    'liveWindow: at the hand-off the newest snapshot IS at the live line — it is taken from it, not appearing beside it');
  const after = liveWindow(700.5 * ROW_SECONDS + 1 / 60, ROW_SECONDS, TWENTY);
  const behind = lineOf(after.lines - 2, after);
  check(behind.row === 700 && behind.z < lineOf(after.lines - 1, after).z,
    'liveWindow: a frame later that snapshot has been pushed back, behind the live line');

  let liveLast = true, bounded = true, fogged = true, steady = true, ring = true;
  const perFrame = (1 / 60) / ROW_SECONDS;
  for (let f = 1; f < 20 * 60 * 60; f += 7) {
    const t = f / 60;
    const w = liveWindow(t, ROW_SECONDS, TWENTY);
    if (!lineOf(w.lines - 1, w).live || lineOf(w.lines - 2, w).row !== Math.floor(w.live)) liveLast = false;
    if (w.lines - 1 > VISIBLE_ROWS) bounded = false;
    // ⚠️ The history flows continuously, so a row LEAVES the window mid-stream. It must
    // already be fully fogged when it does, or the far edge blinks ~11 times a second.
    if (w.start > 0 && followPose(w.live).focusZ - rowZ(w.start - 1) < FOG_FAR) fogged = false;
    const prev = liveRow((f - 1) / 60, ROW_SECONDS, TWENTY);
    if (w.live < TWENTY - 1 && prev > 0 && Math.abs((w.live - prev) - perFrame) > 1e-9) steady = false;
    const need = rowsNeeded(w, TWENTY);
    if (need.to - need.from > RING || need.from !== w.start || need.to < Math.min(TWENTY, w.newest + 2)) ring = false;
  }
  check(liveLast, 'liveWindow: the live line is always the last line drawn, right in front of the newest snapshot');
  check(bounded, `liveWindow: at most VISIBLE_ROWS (${VISIBLE_ROWS}) snapshots, however long the track`);
  check(fogged, 'liveWindow: every snapshot that leaves the window has already faded into the fog — the far edge never blinks');
  check(steady, 'liveRow: moves the same small step every 60 fps frame over a whole 20-minute track — no step at a row boundary');
  check(ring, `rowsNeeded: every row a frame reads fits the ring (${RING}) at once — no two share a slot`);
  check(liveWindow(0, ROW_SECONDS, 0).lines === 0, 'liveWindow: an empty mesh draws nothing');

  // Closer, not shallower (Jag 2026-10-14: "too much dead space between each curve").
  check(PITCH <= 0.085 / 2 && Math.abs(PITCH * VISIBLE_ROWS - 0.085 * 44) < 1e-9,
    'PITCH: the snapshots sit at half the old spacing, and the history still reaches the same depth');
}

/* ── the default detail: the plate, live ─────────────────────────────────────
   Jag 2026-10-14/15, in turn: "too smooth — the goal is a polygonal look"; "a more
   detailed spectrogram, not more frequent lines"; then "60 lines a second", "no more
   mesh connections", "full detail", each line hiding the ones behind it, the bands
   balanced "so most activity is seen at the center", "much higher visual peaks", the
   history going "up and back", fading, coloured from the cover. What could go wrong
   silently: the `high` detail drifting from the picture it was, a balance measured per
   track, a pooled cell that averages a kick away, a window whose far edge blinks. */
{
  const bands = 128, rows = 41;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bytes = Uint8Array.from({ length: rows * bands }, () => Math.floor(rnd() * 200));

  const high = shapeMesh(bytes, rows, bands, ROW_SECONDS, DETAIL.high);
  check(high.values === bytes && high.rows === rows && high.bands === bands && high.rowSeconds === ROW_SECONDS
        && high.pitch === PITCH && high.visible === VISIBLE_ROWS && DETAIL.high.surface && !DETAIL.high.balance
        && !DETAIL.high.rise && !DETAIL.high.fade && !DETAIL.high.palette && !DETAIL.high.view
        && DETAIL.high.subdivisions === SUBDIVISIONS && DETAIL.high.columnEvery === COLUMN_EVERY,
    'shapeMesh: the detailed picture is the stored mesh itself — every band, every row, splined, lit, as before');

  const low = DETAIL.low;
  const shaped = shapeMesh(bytes, rows, bands, ROW_SECONDS, low);
  check(low.columns === 0 && shaped.bands === bands && shaped.warp === X_WARP && low.subdivisions === 1
        && low.lineSeconds === 1 / 60 && shaped.rowSeconds === 1 / 60
        && shaped.rows === Math.ceil(rows * ROW_SECONDS * 60) && !low.surface,
    'shapeMesh: every stored band, straight-edged, a line every 1/60 s, no surface joining them — and the line ' +
    'duration it carries is the line\'s, so the reveal is still currentTime / rowSeconds');
  check(low.linePx < LINE_WIDTH_PX && low.livePx < LIVE_WIDTH_PX && low.livePx > low.linePx,
    'DETAIL.low: thinner lines than the terrain (Jag: "too much visual noise"), the live line still the heaviest');
  check(/u_lineWidth, mesh\.detail\.linePx \* frame\.dpr/.test(glSrc) && /u_liveWidth, mesh\.detail\.livePx \* frame\.dpr/.test(glSrc),
    'gl.ts: the line widths are the detail\'s');

  // No surface: every line hangs a curtain in the background colour — unseen, it hides
  // what is behind it (the Unknown Pleasures plate).
  check(/if \(mesh\.detail\.surface\) \{\s*pass\(0,[^}]*\} else \{\s*pass\(4, segments, w\.lines \* segments\);/.test(glSrc)
        && /\} else if \(u_pass == 4\) \{[^}]*c = u_surface;/.test(glSrc)
        && /if \(side == 1\) p\.y = FLOOR_Y;/.test(glSrc),
    'gl.ts: with no surface every line drops a curtain to the floor in the background colour, written to depth');

  // The climb: a line rises as it recedes; the live line never moves.
  check(/lineHeight\(line, seg\) \+ u_rise \* \(u_liveZ - z\)/.test(glSrc) && /u_rise, mesh\.detail\.rise \?\? 0/.test(glSrc)
        && low.rise > 0,
    'gl.ts: the history climbs up AND back — lift ∝ distance behind the live line, zero AT it');

  // The fade: per detail, and the window ends just past it.
  const fade = stage.fadeOf(low), hf = stage.fadeOf(DETAIL.high);
  check(/v_fog = smoothstep\(u_fade\.x, u_fade\.y, u_focusZ - p\.z\);/.test(glSrc)
        && hf.near === stage.FOG_NEAR && hf.far === FOG_FAR && fade.far < FOG_FAR
        && shaped.visible * shaped.pitch >= fade.far && shaped.visible * shaped.pitch <= fade.far + 3 * shaped.pitch,
    'fadeOf: the history fades early (it climbs out of frame) and only the lines still visible are drawn');

  // ⚠️ A software rasteriser draws 3-D only within its budget; the stage holds it to that.
  const stageSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/RidgeStage.tsx'), 'utf8');
  const highTris = trianglesOf(high);
  const lowTris = trianglesOf(shaped);
  check(/trianglesOf\(m\) > SOFTWARE_MAX_TRIANGLES && isSoftwareRenderer\(name\)/.test(stageSrc)
        && highTris > SOFTWARE_MAX_TRIANGLES && lowTris > SOFTWARE_MAX_TRIANGLES && lowTris * 5 < highTris,
    `RidgeStage: a software rasteriser over ${SOFTWARE_MAX_TRIANGLES} triangles gets the 2-D strip — the terrain ` +
    `(${highTris}) and the plate (${lowTris}) both do`);
  check(trianglesOf(shapeMesh(bytes, rows, bands, ROW_SECONDS, { ...low, columns: 64, spacing: 2, fade: undefined })) <= SOFTWARE_MAX_TRIANGLES,
    'SOFTWARE_MAX_TRIANGLES: admits the 64-column cut it was measured on (29 fps on SwiftShader)');

  // The colours: every one of them the playing sleeve's (coverPalette.ts), read from the
  // same downsampled draw as the app's accent, and dropped if a later cover answered first.
  const accentSrc = readFileSync(resolve(root, 'apps/kouros/src/player/accent.ts'), 'utf8');
  check(low.palette === 'cover' && /coverPixels\(coverUrl\)/.test(stageSrc) && /paletteFromPixels\(px\)/.test(stageSrc)
        && /if \(!current\) return;/.test(stageSrc) && /const data = await coverPixels\(url\);/.test(accentSrc),
    'palette cover: the stage reads the playing cover through accent.ts coverPixels — the one way the app reads a ' +
    'sleeve — into coverPalette, and a late answer for an earlier cover is dropped');
  check(/if \(u_cover == 1\) \{/.test(glSrc) && /if \(u_pass == 5 \|\| u_pass == 4\) \{\s*k = ground;/.test(glSrc)
        && /color = vec4\(mix\(k, ground, v_fog\), 1\.0\);/.test(glSrc)
        && /gl_FragCoord\.y \/ u_viewport\.y/.test(glSrc),
    'gl.ts: with a cover, the background, the curtains and the fade are ONE screen-space gradient — a curtain is ' +
    'unseen against it and a line fades into exactly what is behind it');
  check(/p\.y - u_rise \* \(u_liveZ - p\.z\) - u_crestFrom/.test(glSrc),
    'gl.ts: a line turns toward the crest by its own height — the climb taken back out, so colour reads the music');
}

/* ── the balance: the library's own level in every band ───────────────────────
   Measured (balance.ts): every band swings about as far, but the bass RESTS ~100 bytes
   above the top. Drawn as each band's distance from its library level, weighted to the
   middle. ⚠️ Library-wide: the same numbers for every track. */
{
  const { BAND_LEVEL, BAND_SPREAD } = balance;
  const B = DETAIL.low.balance;
  check(BAND_LEVEL.length === 128 && BAND_SPREAD.length === 128
        && BAND_LEVEL[5] - BAND_LEVEL[127] > 80 && BAND_SPREAD.every((v) => v > 60 && v < 110),
    'balance.ts: the measured table — the bass rests ~100 bytes above the top, and every band swings 60–110');
  const out = new Float32Array(128);
  stage.balanceRow(BAND_LEVEL, 0, 128, B, out);
  check(out.every((v) => Math.abs(v - B.rest) < 1e-9),
    'balanceRow: a row at the library\'s own level is ONE FLAT LINE at rest — no bass plateau, no idle highs');
  const louder = Float32Array.from(BAND_LEVEL, (v) => v + 10), outL = new Float32Array(128);
  stage.balanceRow(louder, 0, 128, B, outL);
  check(outL.every((v, b) => v > out[b]),
    'balanceRow: a louder byte always draws higher, in every band');
  const mid = Array.from({ length: 128 }, (_, b) => b).sort((a, b) =>
    Math.abs(pm.bandFraction(a, 128) - 0.5) - Math.abs(pm.bandFraction(b, 128) - 0.5))[0];
  check((outL[mid] - B.rest) / (10 * B.swing / BAND_SPREAD[mid]) > 0.99
        && (outL[0] - B.rest) / (10 * B.swing / BAND_SPREAD[0]) < B.edge + 0.01,
    'balanceRow: the middle of the line keeps the whole swing and the ends only `edge` of it — the action is central');
  // No per-track anything: a row draws the same whatever track it sits in.
  const a = new Float32Array(128), b = new Float32Array(128);
  const other = Uint8Array.from({ length: 3 * 128 }, (_, i) => (i * 37) & 0xff);
  const mine = Uint8Array.from({ length: 128 }, (_, i) => (i * 11) & 0xff);
  other.set(mine, 128);
  stage.balanceRow(mine, 0, 128, B, a); stage.balanceRow(other, 1, 128, B, b);
  check(a.every((v, i) => v === b[i]) && stage.balanceRow.length >= 4,
    'balanceRow: a row is drawn from its own bytes and the library\'s constants only — never from its track');
}

/* ── pooling: the mechanism a coarser detail uses ─────────────────────────────
   Measured at 12, 24 and 64 columns and 2–4 rows (2026-10-14); the default no longer
   pools, but a detail may, and these must hold when it does. */
{
  const bands = 128, rows = 41;
  let seed = 13;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bytes = Uint8Array.from({ length: rows * bands }, () => Math.floor(rnd() * 200));
  const pooling = { ...DETAIL.low, rowsPer: 2, spacing: 2, motion: undefined, balance: undefined,
                    lineSeconds: undefined, fade: undefined };
  const COARSE = 64;
  const cols = columnBands(bands, COARSE);
  const own = cols.filter((r) => r.at === undefined);
  let covers = own[0].from === 0 && own[own.length - 1].to === bands, nearest = true, placed = true;
  for (let i = 0; i < own.length; i++) {
    if (!(own[i].to > own[i].from) || (i > 0 && own[i].from !== own[i - 1].to)) covers = false;
  }
  for (let c = 0; c < cols.length; c++) {
    const target = c / (COARSE - 1);
    if (cols[c].at !== undefined) {
      if (Math.abs(pm.bandFraction(cols[c].at, bands) - target) > 1e-9
          || !(cols[c].at >= cols[c].from && cols[c].at <= cols[c].from + 1)) placed = false;
      continue;
    }
    for (let b = cols[c].from; b < cols[c].to; b++) {
      if (Math.abs(pm.bandFraction(b, bands) - target) > 0.5 / (COARSE - 1) + 1e-12) nearest = false;
    }
  }
  check(covers, 'columnBands: every stored band pools into exactly one column, in order');
  check(nearest, 'columnBands: each band pools into the column nearest where the shared band axis draws it — ' +
    'so drawn evenly (warp 1) the columns ARE bandFraction');
  check(placed && cols.some((r) => r.at !== undefined),
    'columnBands: a column the warp leaves without a band (the far bass edge) stands at its own place on the ' +
    'axis, between the bands either side — never a copy of a neighbour, which draws a flat step');
  {
    const ramp = Uint8Array.from({ length: bands }, (_, b) => Math.min(255, b * 20));
    const v = shapeMesh(ramp, 1, bands, ROW_SECONDS, { ...pooling, rowsPer: 1, columns: COARSE }).values;
    const c = cols.findIndex((r) => r.at !== undefined);
    check(Math.abs(v[c] - cols[c].at * 20) < 1e-4 && v[c] > v[c - 1] && v[c] < v[c + 1],
      'shapeMesh: a column between bands takes the line between them — the bass edge rises, it does not step');
  }
  check(columnBands(bands, 100).every((r) => r.to > r.from),
    'columnBands: even at a silly column count every column has bands to read');

  // ⚠️ A cell is its LOUDEST byte: one kick in a block of quiet rows survives. (A mean
  // drew a flat sheet — measured on three stored tracks — and fails this.)
  const kick = new Uint8Array(2 * bands).fill(40);
  kick[bands] = 250;                              // band 0, the block's last row
  const k = shapeMesh(kick, 2, bands, ROW_SECONDS, pooling);
  check(k.values[0] === 250 && k.values[k.bands - 1] === 40,
    'shapeMesh: a cell is the loudest byte it covers — one loud row among quiet ones is not averaged away');
  const pooled = shapeMesh(bytes, rows, bands, ROW_SECONDS, pooling);
  const half = shapeMesh(Float32Array.from(bytes, (v) => v / 2), rows, bands, ROW_SECONDS, pooling);
  check(Array.from(half.values).every((v, i) => Math.abs(v - pooled.values[i] / 2) < 1e-9),
    'shapeMesh: a pooled mesh half as loud draws exactly half as high — nothing per track');
  check(columnsOf(12, 0) === 0 && DETAIL.low.columnEvery === 0, 'columnsOf: no grid on the default picture');
}

/* ── the default's window over a whole track ───────────────────────────────── */
{
  const low = DETAIL.low;
  const shaped = shapeMesh(new Uint8Array(4 * 128), 4, 128, ROW_SECONDS, low);
  const far = stage.fadeOf(low).far;
  const LINES = Math.ceil(20 * 60 * 60);                       // a 20-minute track, 60 lines a second
  let fogged = true, ring = true, steady = true;
  const perFrame = shaped.pitch * (1 / 60) / shaped.rowSeconds;
  for (let f = 1; f < 20 * 60 * 60; f += 7) {
    const t = f / 60 + 0.003;
    const w = liveWindow(t, shaped.rowSeconds, LINES, shaped.visible);
    if (w.start > 0 && followPose(w.live, shaped.pitch).focusZ - rowZ(w.start - 1, shaped.pitch) < far) fogged = false;
    const need = rowsNeeded(w, LINES);
    if (need.to - need.from > RING) ring = false;
    const a = followPose(liveRow(t - 1 / 60, shaped.rowSeconds, LINES), shaped.pitch).focusZ;
    if (w.live < LINES - 1 && a > 0 && Math.abs((followPose(w.live, shaped.pitch).focusZ - a) - perFrame) > 1e-9) steady = false;
  }
  check(fogged, 'default window: every line that leaves it has already faded out — the far edge never blinks');
  check(ring, `default window: every line a frame reads fits the ring (${RING})`);
  check(steady, 'default window: the flow moves the same step every frame of a 20-minute track');
}

/* ── the motion: in time with the music ──────────────────────────────────────
   Jag 2026-10-14: "the wave looks like it's just randomly wiggles around — how can we
   sync it". Measured: the live line rose up to ~0.28 s BEFORE a hit (it blended toward
   the next line, which holds audio not yet played), and half of every band's moves were
   reversals — noise. What must hold: a hit lands on its own row and the picture is never
   more than `lead` ahead of the music; nothing reads the future beyond that; small
   fluctuations glide; and a snapshot still leaves the front exactly as the live line was. */
{
  const m = DETAIL.low.motion;
  const bands = 4, rows = 40;
  check(m && m.snap > 0 && m.glide > 0 && m.lead > 0 && m.lead <= 0.05,
    'DETAIL.low.motion: a hit snaps, the rest glides, and the front is at most 50 ms ahead of the music');

  // A hit: quiet, then band 1 jumps at row 20.
  const raw = new Uint8Array(rows * bands).fill(100);
  for (let r = 20; r < rows; r++) raw[r * bands + 1] = 200;
  const live = { raw, settled: settle(raw, rows, bands, ROW_SECONDS, m), rows, rowSeconds: ROW_SECONDS, motion: m };
  const out = new Float32Array(bands);
  const centre = 20.5 * ROW_SECONDS;
  liveAt(live, bands, centre - m.lead - 1e-6, out);
  const before = out[1];
  liveAt(live, bands, centre, out);
  const on = out[1];
  liveAt(live, bands, centre - 0.5 * ROW_SECONDS, out);
  const early = out[1];
  check(before === 100 && early === 100 && on === 200,
    `liveAt: a hit is still flat ${Math.round(m.lead * 1000)} ms before its row's centre and at full height ON it — ` +
    'never the half-row-early swell of a blend toward the next line');

  // Nothing reads the future past one row: change row 30 onwards, and every instant before
  // row 29's centre is untouched.
  const other = raw.slice(); for (let r = 30; r < rows; r++) for (let b = 0; b < bands; b++) other[r * bands + b] = 7;
  const live2 = { ...live, raw: other, settled: settle(other, rows, bands, ROW_SECONDS, m) };
  let causal = true;
  const a = new Float32Array(bands), b2 = new Float32Array(bands);
  for (let t = 0; t < 29.5 * ROW_SECONDS; t += 0.007) {
    liveAt(live, bands, t, a); liveAt(live2, bands, t, b2);
    if (a.some((v, i) => v !== b2[i])) causal = false;
  }
  check(causal && Array.from(settle(other, rows, bands, ROW_SECONDS, m).subarray(0, 30 * bands))
                       .every((v, i) => v === live.settled[i]),
    'settle / liveAt: causal — a row reads only the rows before it, and the live line at most the next row ' +
    '(and a snap from it only `lead` early)');

  // Small fluctuations glide; a hit snaps.
  const wobble = new Uint8Array(rows * bands);
  for (let r = 0; r < rows; r++) for (let b = 0; b < bands; b++) wobble[r * bands + b] = 120 + (r % 2 ? m.snap - 3 : 0);
  const sw = settle(wobble, rows, bands, ROW_SECONDS, m);
  let swing = 0;
  for (let r = 20; r < rows; r++) swing = Math.max(swing, Math.abs(sw[r * bands] - sw[(r - 1) * bands]));
  check(swing < (m.snap - 3) / 2,
    `settle: a band flickering ${m.snap - 3} bytes every row moves under half that — it glides, not wiggles`);
  check(live.settled[20 * bands + 1] === 200 && live.settled[19 * bands + 1] === 100,
    'settle: a rise past `snap` lands at full height on its own row');

  // The hand-off, by value: every snapshot IS the live line at the instant it is taken.
  const bytes = Uint8Array.from({ length: 300 * 128 }, (_, i) => (i * 2654435761 >>> 24) & 0xff);
  const sh = shapeMesh(bytes, 300, 128, ROW_SECONDS, DETAIL.low);
  let same = true;
  const line = new Float32Array(128);
  for (let l = 0; l < sh.rows; l += 7) {
    liveAt(sh.live, 128, lineTime(l, sh.rowSeconds), line);
    const got = new Float32Array(128);
    stage.lineValues(sh, l, got);
    for (let b = 0; b < 128; b++) if (line[b] !== got[b]) same = false;
  }
  const w = liveWindow(lineTime(40, sh.rowSeconds) + 1e-9, sh.rowSeconds, sh.rows, sh.visible);
  check(same && Math.abs(lineTime(w.live, sh.rowSeconds) - lineTime(40, sh.rowSeconds)) < 1e-6,
    'shapeMesh: every snapshot is the live line at the instant it is taken — it leaves the front exactly as drawn');

  // The renderer computes the live line every frame at the time its position stands for.
  check(/liveAt\(mesh\.live, mesh\.bands, \(w\.live \+ 0\.5\) \* mesh\.rowSeconds, this\.liveLine\)/.test(glSrc)
        && /if \(u_liveOwn == 1\) return texelFetch\(u_curves, ivec2\(seg, u_ring\), 0\)\.r \* AMPLITUDE;/.test(glSrc)
        && /RING \+ 1, 0, gl\.RED/.test(glSrc),
    'gl.ts: the live line is liveAt at its own time, one texel row after the ring, over the fixed span × AMPLITUDE');
  check(shapeMesh(bytes, 300, 128, ROW_SECONDS, DETAIL.high).live === undefined,
    'DETAIL.high: no motion — the detailed terrain is the stored rows, as it always was');
}

/* ── the cover palette ───────────────────────────────────────────────────────
   Jag 2026-10-15: "use gradients made of colours pulled from the album cover for every
   aspect of this visualizer." What must hold: the hues are the COVER's (found by hue,
   never a mean — accent.ts's lesson), the ground is dark and the lines bright whatever
   the sleeve, and a monochrome sleeve stays monochrome. */
{
  const { paletteFromPixels, rgbToHsl, GROUND_LIGHT, STOP_LIGHT, CREST_LIGHT } = coverPalette;
  const image = (fill) => { const d = new Uint8ClampedArray(32 * 32 * 4); for (let i = 0; i < 32 * 32; i++) d.set([...fill(i), 255], i * 4); return d; };
  const hsl = (c) => rgbToHsl(c[0], c[1], c[2]);
  const hueOf = (c) => hsl(c)[0];
  const gap = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

  // Half red, half blue, on a near-black frame.
  const rb = paletteFromPixels(image((i) => (i % 32 < 4 ? [8, 8, 10] : (i < 512 ? [200, 30, 30] : [30, 50, 200]))));
  const hues = rb.stops.map(hueOf);
  check(rb.stops.length >= 2 && hues.some((h) => gap(h, 0) < 0.03) && hues.some((h) => gap(h, 0.64) < 0.04),
    'paletteFromPixels: the line\'s gradient holds the cover\'s own hues (red and blue) — never their mud-purple mean');
  const rgb = paletteFromPixels(image((i) => (i % 32 < 4 ? [8, 8, 10] : [[200, 30, 30], [30, 170, 40], [30, 50, 200]][Math.floor(i / 342)])));
  const three = rgb.stops.map(hueOf);
  check(rgb.stops.length === 3 && [0, 0.35, 0.64].every((t) => three.some((h) => gap(h, t) < 0.04))
        && rgb.stops.every((c) => hsl(c)[1] >= 0.44),
    'paletteFromPixels: three hues on the cover, three saturated stops — each one the cover\'s');
  check([rb, paletteFromPixels(image(() => [250, 250, 245])), paletteFromPixels(image(() => [5, 5, 5]))].every((p) =>
          p.ground.every((c) => hsl(c)[2] <= GROUND_LIGHT[1] + 1e-9)
          && p.stops.every((c) => hsl(c)[2] >= STOP_LIGHT[0] - 1e-9) && hsl(p.crest)[2] >= CREST_LIGHT - 1e-9),
    'paletteFromPixels: the ground is dark and the lines and crest bright for ANY sleeve — white, black or colourful');

  // Navy with white linework — Unknown Pleasures.
  const up = paletteFromPixels(image((i) => ((i * 7) % 11 === 0 ? [240, 240, 240] : [2, 14, 26])));
  check(up.stops.every((c) => hsl(c)[1] < 0.5) && hsl(up.crest)[1] < 0.2 && hsl(up.ground[0])[1] > 0.3
        && gap(hueOf(up.ground[0]), 0.58) < 0.05,
    'paletteFromPixels: a monochrome sleeve stays monochrome — navy ground, pale lines, white crest');
  check(JSON.stringify(paletteFromPixels(image((i) => [i % 256, (i * 3) % 256, 90])))
        === JSON.stringify(paletteFromPixels(image((i) => [i % 256, (i * 3) % 256, 90]))),
    'paletteFromPixels: a pure function of the pixels');
}

/* ── the vaporwave exploration (detail: 'vapor') ─────────────────────────────
   Jag 2026-10-15: "a way more vaporwave version … keep it tied to the music. This is an
   exploration rather than a throwaway." What must hold: it is the default's lines and
   motion under a different renderer, and NOTHING in it moves by a clock — every effect
   is a function of the live line and of time IN THE TRACK, so a pause holds the picture. */
{
  const { stepVapor, vaporState, HIT_FLOOR, TEAR_AT } = vaporSignals;
  const B = DETAIL.low.balance;
  const V = DETAIL.vapor;
  check(V.motion === DETAIL.low.motion && V.balance === DETAIL.low.balance && V.lineSeconds === DETAIL.low.lineSeconds
        && V.columns === DETAIL.low.columns && !V.palette,
    'DETAIL.vapor: the default\'s lines, balance and motion exactly — only the picture is different');

  const flat = new Float32Array(128).fill(B.rest);
  const quiet = vaporState();
  for (let t = 10; t < 12; t += 1 / 30) stepVapor(quiet, flat, t, B);
  check(quiet.bass === 0 && quiet.highs === 0 && quiet.loud === 0 && quiet.hit === 0 && quiet.tear === 0 && quiet.stripe === 0,
    'stepVapor: a line at rest is silence — no sun swell, no stars, no hits, no tears, no stripe scroll');

  const held = { ...quiet, prev: quiet.prev && quiet.prev.slice() };
  const loudLine = Float32Array.from(flat, (v, b) => v + (b < 22 ? 200 : 60));
  const a = stepVapor({ ...held }, loudLine, 12 + 1 / 30, B);
  const paused = stepVapor(stepVapor({ ...held }, loudLine, 12 + 1 / 30, B), loudLine, 12 + 1 / 30, B);
  check(a.bass > 0.8 && a.hit > 0.5 && a.beat > 0.5,
    'stepVapor: the bass and an onset arrive with the line that carries them');
  check(paused.stripe === a.stripe && paused.sway === a.sway && paused.hue === a.hue && paused.hit === a.hit,
    'stepVapor: a paused track (the same time twice) advances nothing — no clock is hiding in it');
  const back = stepVapor({ ...a, prev: a.prev && a.prev.slice() }, loudLine, 5, B);
  check(back.stripe === a.stripe && back.sway === a.sway && back.hue === a.hue,
    'stepVapor: a seek backwards accumulates nothing');

  const small = vaporState();
  stepVapor(small, flat, 20, B);
  stepVapor(small, Float32Array.from(flat, (v) => v + HIT_FLOOR * 0.9), 20 + 1 / 30, B);
  const big = vaporState();
  stepVapor(big, flat, 20, B);
  stepVapor(big, Float32Array.from(flat, (v) => v + HIT_FLOOR + 30 * TEAR_AT + 5), 20 + 1 / 30, B);
  check(small.hit === 0 && small.tear === 0 && big.hit > TEAR_AT && big.tear > 0.75,
    `stepVapor: a rise under the onset floor (${HIT_FLOOR}/band/frame, measured) is the glide, not a hit; a big one tears`);

  const stageSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/RidgeStage.tsx'), 'utf8');
  const pmSrc = readFileSync(resolve(root, 'apps/kouros/src/components/Pulsarmap.tsx'), 'utf8');
  const vaporSrc = readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/vapor.ts'), 'utf8');
  check(/vapor \? new VaporRenderer\(gl\) : new RidgeRenderer\(gl\)/.test(stageSrc)
        && /key=\{detail === 'vapor' \? 'vapor' : 'ridges'\}/.test(pmSrc)
        && /const t = \(w\.live \+ 0\.5\) \* mesh\.rowSeconds;/.test(vaporSrc) && /stepVapor\(this\.signals, cur, t, bal\)/.test(vaporSrc),
    'vapor: its own renderer, chosen at mount (a switch remounts), driven by the live line at the time it stands for');
  for (const [name, src] of [['vapor.ts', vaporSrc],
    ['vaporSignals.ts', readFileSync(resolve(root, 'apps/kouros/src/components/ridges3d/vaporSignals.ts'), 'utf8')]]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const clocks = ['setInterval', 'setTimeout', 'Date.now', 'performance.now', 'requestAnimationFrame'].filter((c) => code.includes(c));
    check(!clocks.length, `purity: ${name} holds no clock (${clocks.join(', ') || 'none'}) — the music moves it`);
  }
}

/* ── the camera ───────────────────────────────────────────────────────────── */
{
  const sc = liveRow(64.03, ROW_SECONDS, 2584);
  const pose = followPose(sc);
  check(pose.focusZ === rowZ(sc) && pose.target[2] === pose.focusZ - LOOK_BEHIND,
    'followPose: rides the live line EXACTLY, aiming behind it — the live line holds still on screen');
  check(pose.yaw === 0, 'followPose: the follow view is not orbited');
  // The flow is continuous: at 60 fps each frame moves the focus by the same small
  // step — never a jump when a row arrives.
  let steady = true;
  const perFrame = PITCH * (1 / 60) / ROW_SECONDS;
  for (let f = 1; f < 600; f++) {
    const a = followPose(liveRow((f - 1) / 60 + 1, ROW_SECONDS, 2584)).focusZ;
    const b = followPose(liveRow(f / 60 + 1, ROW_SECONDS, 2584)).focusZ;
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

done();
