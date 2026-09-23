// stage.ts — the PURE geometry and camera under the 3-D pulsarmap (ALGORITHMS.md §9).
// No DOM, no GL, no clock: test/pulsarmap.mjs transpiles it (with pulsarmap.ts and
// @jkos/scene/math, which it imports) and drives the real functions. The generic half
// — the mesh as a wrapped texture, the orbit rig, the spring — is @jkos/scene's; what
// is here is what makes it THIS picture.
//
// The picture is the 2-D pulsarmap's, stood up in space: one ridgeline per ~2 s row,
// frequency across the line, energy as height, time receding into depth. What 3-D
// changes is only how it is seen — a camera that follows the playhead and can be
// orbited — never what is drawn.
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
// ⚠️ **THE SHADER DERIVES (row, band) FROM `gl_InstanceID`, AND `cellOf` IS THE SAME
// ARITHMETIC IN TYPESCRIPT.** The gate reads the shader source for the expressions
// and checks `cellOf` against every instance of a mesh. An off-by-one there draws a
// plausible picture of the wrong rows. (The texel a row lands in is the package's
// `texelOf` / `matrixTexel`, held by its own test.)

import { rowsRevealed } from '../pulsarmap';
import { clamp, DEG, type OrbitDragLimits, type Vec3 } from '@jkos/scene/math';

/** World units. The line spans x ∈ [−HALF_WIDTH, HALF_WIDTH]. */
export const HALF_WIDTH = 1;
/** Height of a full-scale (255) cell. Larger than PITCH on purpose, as in 2-D: lines
 *  must overlap or there is nothing for the curtains to hide. */
export const AMPLITUDE = 0.34;
export const PITCH = 0.085;
/** Rows drawn behind the newest. The fog reaches the surface colour before the
 *  window's far edge, so the cut is never seen. */
export const VISIBLE_ROWS = 44;
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
/** Line half-width in CSS px. `gl.lineWidth` is 1 device pixel almost everywhere,
 *  which at DPR 3 is invisible — so lines are screen-space quads. */
export const LINE_WIDTH_PX = 1.25;
/** Rad/s — how an orbit springs home on release. */
export const RETURN_OMEGA = 7;

export const rowZ = (row: number): number => row * PITCH;
export const rowHeight = (byte: number): number => (byte / 255) * AMPLITUDE;
export function bandX(band: number, bands: number): number {
  return bands > 1 ? -HALF_WIDTH + (2 * HALF_WIDTH * band) / (bands - 1) : 0;
}

/* ── the mesh on the GPU ─────────────────────────────────────────────────────── */
// The mesh is ONE R8 texture, laid out by @jkos/scene's `textureLayout` (rows × bands,
// wrapped into columns past the texture limit — a 20-minute track is 600 rows, a
// 70-minute one wraps).

/** One instance per (row, segment). The shader computes
 *    row  = u_rowStart + gl_InstanceID / u_segments
 *    band = gl_InstanceID % u_segments
 *  and this is that, for the gate. */
export function cellOf(instance: number, rowStart: number, segments: number): { row: number; band: number } {
  return { row: rowStart + Math.floor(instance / segments), band: instance % segments };
}

/* ── the reveal window ───────────────────────────────────────────────────────── */
export interface RowWindow {
  /** First row drawn, inclusive. */
  start: number;
  /** One past the newest revealed row. `start === end` draws nothing. */
  end: number;
}

/** Rows to draw at `currentTime`: the revealed ones, at most `visible` of them. */
export function visibleWindow(currentTime: number, rowSeconds: number, rows: number,
                              visible = VISIBLE_ROWS): RowWindow {
  const end = Math.max(0, rowsRevealed(currentTime, rowSeconds, rows));
  return { start: Math.max(0, end - visible), end };
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
 * The follow pose at `scroll` (pulsarmap.ts `scrollRow`): aimed behind the playhead,
 * level, not orbited.
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
