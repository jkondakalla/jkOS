// stage.ts — the PURE geometry and camera under the 3-D pulsarmap (ALGORITHMS.md §9).
// No DOM, no GL, no clock: test/pulsarmap.mjs transpiles it (with pulsarmap.ts and
// @jkos/scene/math, which it imports) and drives the real functions. The generic half
// — the mesh as a wrapped texture, the orbit rig, the spring — is @jkos/scene's; what
// is here is what makes it THIS picture.
//
// The picture is the 2-D pulsarmap's, stood up in space and JOINED: a LIVE line at the
// front, fixed on screen, that moves every frame; behind it a snapshot of that line
// every ~93 ms row, pushed back into depth; and a surface joining each line to the
// next, so the history is a terrain rather than a stack of separate curves (Jag,
// 2026-10-14). Frequency across, energy as height, time receding. The heights are
// still the stored bytes — the live line is the rows around now, blended, and the
// curve between bands a spline through the bands' own values; nothing is computed
// from the audio here.
//
// ⚠️ **THE WORLD'S AXES, ONCE:** x is band (low → high, left → right, as in 2-D);
// y is `byte / 255 × AMPLITUDE`; z is `row × PITCH`, so row 0 is FURTHEST from the
// camera and the newest row is NEAREST — the same reading as 2-D, where new rows
// arrive in front.
//
// ⚠️ **NO NORMALISATION, ANYWHERE.** Heights are bytes over the fixed 0…255 span,
// because the store's value range is SHARED. A contrast stretch in the shader would
// be the fourth place the per-track mistake could enter (after the builder, the
// quantiser and the 2-D renderer) and the only one invisible to every store-side
// test. `rowHeight` below is the one definition, and the shader mirrors it.
//
// ⚠️ **THE SHADER DERIVES (line, segment) FROM `gl_InstanceID`, AND `cellOf` /
// `lineOf` ARE THE SAME ARITHMETIC IN TYPESCRIPT.** The gate reads the shader source
// for the expressions and checks these against every instance. An off-by-one there
// draws a plausible picture of the wrong rows. (The texel a row lands in is the
// package's `texelOf` / `matrixTexel`, held by its own test.)

import { bandFraction, liveRow } from '../pulsarmap';
import { clamp, DEG, type OrbitDragLimits, type Vec3 } from '@jkos/scene/math';

/** World units. The line spans x ∈ [−HALF_WIDTH, HALF_WIDTH]. */
export const HALF_WIDTH = 1;
/** Height of a full-scale (255) cell. Larger than PITCH on purpose, as in 2-D: lines
 *  must overlap or there is nothing for the curtains to hide. */
export const AMPLITUDE = 0.34;
/** Depth between consecutive snapshots. ⚠️ Halved 2026-10-14 (was 0.085; Jag: "too
 *  much dead space between each curve") and VISIBLE_ROWS doubled with it, so the
 *  history still reaches the same depth — ~8 s of music — and the camera's framing,
 *  solved in world units below, did not move. */
export const PITCH = 0.0425;
/** Snapshot rows drawn behind the live line. The fog reaches the surface colour
 *  before the window's far edge, so the cut is never seen. */
export const VISIBLE_ROWS = 88;
export const FLOOR_Y = -0.02;

/* The follow framing, SOLVED rather than eyeballed for the 390 × 168 CSS-px strip
   Now Playing gives it: the newest row spans ~89% of the width and sits at ~94% of
   the height, and the row 80% of the window back sits at ~12% — the stack fills
   the frame. Solved for a line at the library's MEDIAN height (byte 170 across the
   stored meshes), not at zero: a ridge stands on its own bytes, so framing the
   floor put every real picture a third of the way up an empty strip. The first
   hand-picked numbers also ran the nearest rows off both edges. */
export const FOLLOW_PITCH = 30 * DEG;
export const FOLLOW_DISTANCE = 2.2;
export const FOV = 38 * DEG;
/** How far behind the newest row the camera aims, so the newest row sits low in
 *  the frame and the stack recedes up it — the 2-D view's anchor, in depth. */
export const LOOK_BEHIND = 0.9;
export const TARGET_Y = 0.2;
export const MIN_PITCH = 8 * DEG;
export const MAX_PITCH = 70 * DEG;
export const MAX_YAW = 75 * DEG;
export const YAW_PER_PX = 0.45 * DEG;
export const PITCH_PER_PX = 0.35 * DEG;
/** Fog, as distance behind the newest row, in world units. */
export const FOG_NEAR = 0.6 * VISIBLE_ROWS * PITCH;
export const FOG_FAR = 0.95 * VISIBLE_ROWS * PITCH;
/** Line width in CSS px. `gl.lineWidth` is 1 device pixel almost everywhere, which
 *  at DPR 3 is invisible — so lines are screen-space quads. */
export const LINE_WIDTH_PX = 1.25;
/** The live line is drawn heavier: it is the one the eye should follow. */
export const LIVE_WIDTH_PX = 2.25;
/** Segments per band gap. Every line — live and snapshot alike, so a snapshot keeps
 *  the exact shape it left the front with — is a Catmull-Rom curve through the
 *  bands' own values (`bandCurve`), drawn at this many segments between two bands. */
export const SUBDIVISIONS = 4;
/** The surface's grid runs back in time along every COLUMN_EVERY-th band — what
 *  makes it read as a mesh rather than shading. */
export const COLUMN_EVERY = 4;
/** Rad/s — how an orbit springs home on release. */
export const RETURN_OMEGA = 7;

export const rowZ = (row: number): number => row * PITCH;
export const rowHeight = (byte: number): number => (byte / 255) * AMPLITUDE;
/** Where band `band` sits across the line — pulsarmap.ts `bandFraction` (the warped
 *  axis, shared with 2-D), scaled to the world. The shader mirrors it. */
export function bandX(band: number, bands: number): number {
  return bands > 1 ? -HALF_WIDTH + 2 * HALF_WIDTH * bandFraction(band, bands) : 0;
}

/* ── the curves on the GPU ───────────────────────────────────────────────────── */
// The shader never sees the raw mesh. Each row's CURVE — the spline through its bands,
// `segmentsOf(bands) + 1` values — is computed once, when the row enters the window,
// into a RING texture of `RING` rows: the slot is `row % RING`, the vertex reads ONE
// texel. (Splining in the shader cost four reads per vertex, twice per frame for every
// line, and took the software-rendered floor from 11.9 fps to 1.9.) The ring is sized
// by the window, not the track, so a 70-minute track costs what a 3-minute one does.
// What a slot holds is a pure function of its row, so a seek or a new track needs no
// special case — a slot holding the wrong row is simply refilled.

/** Rows the ring holds: the whole window, the row after the live line, and spare. */
export const RING = 128;
/** The ring slot row `row` lives in. The shader's `row % u_ring`. */
export const slotOf = (row: number): number => row % RING;

/** The rows a frame reads: every snapshot in the window, and the row after the live
 *  line (its blend reads it). Empty when nothing is drawn. */
export function rowsNeeded(w: LiveWindow, rows: number): { from: number; to: number } {
  if (w.lines < 1) return { from: 0, to: 0 };
  return { from: w.start, to: Math.min(rows, w.newest + 2) };
}

/** One row's curve: `segmentsOf(bands) + 1` values across the line, written at `out`
 *  from `offset`. Bytes over the fixed 0…255 span (× AMPLITUDE in the shader, as
 *  always), joined by `bandCurve`; at every band the curve IS the byte. ⚠️ Linear in
 *  the bytes — no per-row or per-track scaling can hide here. */
export function rowCurve(bytes: ArrayLike<number>, row: number, bands: number,
                         out: Float32Array, offset = 0): void {
  const base = row * bands;
  const at = (b: number) => bytes[base + Math.min(bands - 1, Math.max(0, b))] / 255;
  const n = segmentsOf(bands) + 1;
  for (let seg = 0; seg < n; seg++) {
    const band = Math.floor(seg / SUBDIVISIONS);
    const s = (seg - band * SUBDIVISIONS) / SUBDIVISIONS;
    out[offset + seg] = bandCurve(at(band - 1), at(band), at(band + 1), at(band + 2), s);
  }
}

/** Segments across one line: `SUBDIVISIONS` per gap between two bands. */
export const segmentsOf = (bands: number): number => Math.max(0, bands - 1) * SUBDIVISIONS;
/** Grid columns: every `COLUMN_EVERY`-th band, the first band included. */
export const columnsOf = (bands: number): number => (bands > 0 ? Math.floor((bands - 1) / COLUMN_EVERY) + 1 : 0);

/** One instance per (line, segment) — or (line, column) for the grid. The shader
 *  computes
 *    line = gl_InstanceID / u_per
 *    seg  = gl_InstanceID % u_per
 *  and this is that, for the gate. */
export function cellOf(instance: number, per: number): { line: number; seg: number } {
  return { line: Math.floor(instance / per), seg: instance % per };
}

/* ── the live window ─────────────────────────────────────────────────────────── */
/** What one frame draws: snapshot rows `start` … `newest`, then the live line — so
 *  `lines` is the snapshot count plus one, and the live line is ALWAYS the last. */
export interface LiveWindow {
  /** First snapshot row drawn, inclusive. */
  start: number;
  /** The newest snapshot row — the last one the live line has passed. −1: none. */
  newest: number;
  /** Where the live line stands, in rows (pulsarmap.ts `liveRow`). −1: no mesh. */
  live: number;
  /** Lines drawn, the live one included. 0 draws nothing. */
  lines: number;
}

export function liveWindow(currentTime: number, rowSeconds: number, rows: number,
                           visible = VISIBLE_ROWS): LiveWindow {
  const live = liveRow(currentTime, rowSeconds, rows);
  if (live < 0) return { start: 0, newest: -1, live: -1, lines: 0 };
  const newest = Math.floor(live);
  const start = Math.max(0, newest - visible + 1);
  return { start, newest, live, lines: newest - start + 2 };
}

/** Line `line` of a window: a snapshot row, or — the last line — the live one. The
 *  shader's `lineZ` and `lineHeight` make the same choice. */
export function lineOf(line: number, w: LiveWindow): { live: boolean; row: number; z: number } {
  if (line === w.lines - 1) return { live: true, row: w.live, z: rowZ(w.live) };
  const row = w.start + line;
  return { live: false, row, z: rowZ(row) };
}

/** The live line's value in one band: the rows either side of `live`, blended by its
 *  fraction. At a whole `live` it IS that row — the instant the row leaves the front,
 *  the snapshot and the live line are the same curve. The shader's `lineHeight`. */
export function liveValue(here: number, next: number, frac: number): number {
  return here + (next - here) * frac;
}

/** The curve BETWEEN bands b and b+1, at s ∈ [0, 1): Catmull-Rom through the four
 *  bands around it. It passes through every band's own value (s = 0 is p1 exactly) —
 *  the stored bytes are where the line goes; the spline only decides how it gets
 *  between them. The shader's `curveAt`. */
export function bandCurve(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

/* ── the camera ──────────────────────────────────────────────────────────────── */
export interface Pose {
  /** z of the playhead — the continuous scroll, in world units. */
  focusZ: number;
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

/**
 * The follow pose at `scroll` — the live line's row (pulsarmap.ts `liveRow`): aimed
 * behind it, level, not orbited. The live line sits at `focusZ`, so it holds still on
 * screen while the snapshots stream away from it.
 *
 * ⚠️ **THE CAMERA RIDES THE PLAYHEAD EXACTLY — NO SPRING.** At 2 s rows the focus
 * sprang one pitch forward per row, and a seek cut. At ~10.8 rows a second the focus
 * is continuous in time, so the stack flows past at the track's own rate: a row
 * arrives at the front the instant its time begins and recedes one pitch per row of
 * music after. A spring here would only lag the music.
 */
export function followPose(scroll: number): Pose {
  const focusZ = rowZ(Math.max(0, scroll));
  return { focusZ, target: [0, TARGET_Y, focusZ - LOOK_BEHIND], yaw: 0, pitch: FOLLOW_PITCH,
           distance: FOLLOW_DISTANCE };
}

/** How a drag orbits the stack (@jkos/scene `orbitDrag`): pitch clamped so the eye can
 *  never go under the floor or over the top, yaw so the stack never turns edge-on and
 *  reads as a single line. */
export const ORBIT: OrbitDragLimits = {
  yawPerPx: YAW_PER_PX, pitchPerPx: PITCH_PER_PX, minPitch: MIN_PITCH, maxPitch: MAX_PITCH, maxYaw: MAX_YAW,
};

/** The ramp position of a row: POSITION IN THE TRACK, as in 2-D (far → line). */
export function rampOf(row: number, rows: number): number {
  return rows > 1 ? clamp(row / (rows - 1), 0, 1) : 1;
}
