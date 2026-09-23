// stage.ts — the PURE geometry and camera under the 3-D pulsarmap (ALGORITHMS.md §9).
// No DOM, no GL, no clock: test/pulsarmap.mjs transpiles it (with the two pure
// modules it imports) and drives the real functions.
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
// plausible picture of the wrong rows.

import { rowsRevealed } from '../pulsarmap';
import { clamp, DEG, type Vec3 } from '@jkos/scene/math';

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
/** Rad/s. ~0.45 s to settle: a new row every 2 s glides in rather than stepping. */
export const FOLLOW_OMEGA = 10;
export const RETURN_OMEGA = 7;
/** A jump of more rows than this is a SEEK, not playback, and cuts. */
export const CUT_ROWS = 8;

export const rowZ = (row: number): number => row * PITCH;
export const rowHeight = (byte: number): number => (byte / 255) * AMPLITUDE;
export function bandX(band: number, bands: number): number {
  return bands > 1 ? -HALF_WIDTH + (2 * HALF_WIDTH * band) / (bands - 1) : 0;
}

/* ── the mesh as a texture ───────────────────────────────────────────────────── */
export interface TextureLayout {
  width: number;
  height: number;
  columns: number;
  rowsPerColumn: number;
  bands: number;
  rows: number;
}

/**
 * Where a mesh of `rows × bands` goes in one R8 texture no side of which exceeds
 * `maxSize`. WebGL2 guarantees 2048, which is ~68 minutes of 2 s rows — so a longer
 * track WRAPS into columns of `bands` texels, each holding `rowsPerColumn` rows.
 */
export function textureLayout(rows: number, bands: number, maxSize = 2048): TextureLayout {
  if (!(rows > 0) || !(bands > 0)) throw new Error(`ridges3d: empty mesh ${rows}x${bands}`);
  const columns = Math.ceil(rows / maxSize);
  const width = bands * columns;
  if (width > maxSize) throw new Error(`ridges3d: ${rows} rows cannot fit a ${maxSize} texture`);
  const rowsPerColumn = Math.ceil(rows / columns);
  return { width, height: rowsPerColumn, columns, rowsPerColumn, bands, rows };
}

/** The texel holding (row, band). The shader's `heightAt` is this, in GLSL. */
export function texelOf(row: number, band: number, layout: TextureLayout): [number, number] {
  const column = Math.floor(row / layout.rowsPerColumn);
  return [band + column * layout.bands, row - column * layout.rowsPerColumn];
}

/** Row-major mesh bytes → the texture's own row-major memory. Unused texels are 0. */
export function packTexture(bytes: Uint8Array, layout: TextureLayout): Uint8Array {
  const { rows, bands, width } = layout;
  if (bytes.length !== rows * bands) {
    throw new Error(`ridges3d: ${bytes.length} bytes for a declared ${rows}x${bands}`);
  }
  const out = new Uint8Array(layout.width * layout.height);
  for (let r = 0; r < rows; r++) {
    for (let b = 0; b < bands; b++) {
      const [x, y] = texelOf(r, b, layout);
      out[y * width + x] = bytes[r * bands + b];
    }
  }
  return out;
}

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
  /** z of the newest revealed row — what the camera follows. */
  focusZ: number;
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

/** The follow pose for a window: aimed behind the newest row, level, not orbited. */
export function followPose(win: RowWindow): Pose {
  const focusZ = rowZ(Math.max(0, win.end - 1));
  return { focusZ, target: [0, TARGET_Y, focusZ - LOOK_BEHIND], yaw: 0, pitch: FOLLOW_PITCH,
           distance: FOLLOW_DISTANCE };
}

/** A drag's orbit, from the angles the drag started at. Pitch is clamped so the eye
 *  can never go under the floor or over the top; yaw so the stack never turns
 *  edge-on and reads as a single line. */
export function orbitFromDrag(start: { yaw: number; pitch: number }, dx: number, dy: number):
  { yaw: number; pitch: number } {
  return {
    yaw: clamp(start.yaw - dx * YAW_PER_PX, -MAX_YAW, MAX_YAW),
    pitch: clamp(start.pitch + dy * PITCH_PER_PX, MIN_PITCH, MAX_PITCH),
  };
}

/** Whether the focus should CUT rather than glide to a new newest row. */
export function shouldCut(fromZ: number, toZ: number): boolean {
  return Math.abs(toZ - fromZ) > CUT_ROWS * PITCH;
}

/** The ramp position of a row: POSITION IN THE TRACK, as in 2-D (far → line). */
export function rampOf(row: number, rows: number): number {
  return rows > 1 ? clamp(row / (rows - 1), 0, 1) : 1;
}
