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
// draws a plausible picture of the wrong rows.

import { X_WARP, bandFraction, liveRow } from '../pulsarmap';
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

export const rowZ = (row: number, pitch = PITCH): number => row * pitch;
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

/** One row's curve: `segmentsOf(bands, sub) + 1` values across the line, written at
 *  `out` from `offset`. Bytes over the fixed 0…255 span (× AMPLITUDE in the shader, as
 *  always), joined by `bandCurve`; at every band the curve IS the byte. ⚠️ Linear in
 *  the bytes — no per-row or per-track scaling can hide here. At `sub` = 1 there is
 *  nothing between bands to spline: the line is straight from value to value. */
export function rowCurve(bytes: ArrayLike<number>, row: number, bands: number,
                         out: Float32Array, offset = 0, sub = SUBDIVISIONS): void {
  const base = row * bands;
  const at = (b: number) => bytes[base + Math.min(bands - 1, Math.max(0, b))] / 255;
  const n = segmentsOf(bands, sub) + 1;
  for (let seg = 0; seg < n; seg++) {
    const band = Math.floor(seg / sub);
    const s = (seg - band * sub) / sub;
    out[offset + seg] = bandCurve(at(band - 1), at(band), at(band + 1), at(band + 2), s);
  }
}

/** Segments across one line: `sub` per gap between two bands. */
export const segmentsOf = (bands: number, sub = SUBDIVISIONS): number => Math.max(0, bands - 1) * sub;
/** Grid columns: every `every`-th band, the first band included; `every` = 0 is no grid. */
export const columnsOf = (bands: number, every = COLUMN_EVERY): number =>
  (bands > 0 && every > 0 ? Math.floor((bands - 1) / every) + 1 : 0);

/** One instance per (line, segment) — or (line, column) for the grid. The shader
 *  computes
 *    line = gl_InstanceID / u_per
 *    seg  = gl_InstanceID % u_per
 *  and this is that, for the gate. */
export function cellOf(instance: number, per: number): { line: number; seg: number } {
  return { line: Math.floor(instance / per), seg: instance % per };
}

/* ── detail: the smooth terrain, or the low-poly one ───────────────────────── */
// Jag, 2026-10-14: "the existing pulsar map is too smooth — the goal is a polygonal
// look. Keep a detailed pulsar map, but give me as low a poly version as possible."
//
// Both are the SAME picture of the same stored bytes: frequency across, energy as height,
// time receding, the live line at the front. The low-poly one is drawn from a COARSER
// MESH — `shapeMesh` pools blocks of the stored mesh into a few cells — with straight
// edges between them and each triangle lit as one flat facet. What it is NOT is a
// different analysis: a cell is the loudest byte it covers (half as loud is half as
// high), and every rule above — no normalisation, `currentTime` every frame, the shared
// band axis — holds for it unchanged.

export type DetailName = 'high' | 'low';

export interface Detail {
  /** Stored rows pooled into one line. A line still stands for a fixed span of music —
   *  `rowsPer × row_seconds` — so the reveal rate is still a property of time. */
  rowsPer: number;
  /** Vertices across a line; 0 = one per stored band. */
  columns: number;
  /** Segments per gap between two vertices (1 = straight edges). */
  subdivisions: number;
  /** The grid runs back in time along every `columnEvery`-th vertex; 0: no grid. */
  columnEvery: number;
  /** How strongly a facet's own light pulls it from the surface toward the ink. */
  relief: number;
  /** Where that light comes from — toward the light, unit length. */
  light: Vec3;
}

export const DETAIL: { readonly [K in DetailName]: Detail } = {
  high: { rowsPer: 1, columns: 0, subdivisions: SUBDIVISIONS, columnEvery: COLUMN_EVERY, relief: 0.22,
          light: [-0.33, 0.85, 0.41] },
  /* Polygonal, but still a visualizer: ~5,500 triangles a frame against ~190k. Jag,
     2026-10-14, of 12 columns × 4 rows (~500): "way too little detail to make it a cool
     visual — the goal is a music visualizer"; of 24 × 2: "still too low detail". 64
     columns (two bands each, on average) keep the spectrum's own peaks, and 2 rows to a
     line (~0.19 s, ~5.4 lines a second) let a beat be its own ridge; at 1 row the facets
     turn to slivers and the lines bury them — the detailed picture, only jagged.
     No grid: it turns the triangles back into a quad lattice. The
     light comes from above, behind and to the left — overhead, the shallow facets all
     shade alike and the polygons vanish. */
  low: { rowsPer: 2, columns: 64, subdivisions: 1, columnEvery: 0, relief: 1,
         light: [-0.5007, 0.751, -0.4306] },
};

/** The mesh the renderer draws, in a detail. */
export interface Shaped {
  /** Row-major, `rows × bands`, over the fixed 0…255 span (a pooled cell is a mean, so
   *  it may be fractional). */
  values: ArrayLike<number>;
  rows: number;
  bands: number;
  /** Seconds a line stands for — the stored row duration × `rowsPer`. */
  rowSeconds: number;
  /** The exponent x is warped by in the shader: `X_WARP` when every stored band is a
   *  vertex; 1 when the columns were already PLACED along the warped axis. */
  warp: number;
  /** Depth between lines, and lines drawn behind the live one — scaled together, so the
   *  history reaches the same depth (~8 s) and the follow framing does not move. */
  pitch: number;
  visible: number;
  detail: Detail;
}

/** The stored bands each column pools: band `b` belongs to the column nearest where
 *  `bandFraction` draws it, so the columns sit EVENLY along the warped axis — the
 *  warp's own claim (equal sharpness per width), kept at any column count.
 *
 *  ⚠️ At the far left the warp draws the lowest bands WIDER apart than a column (at 64
 *  columns, band 0 → column 0 and band 1 → column 2), so a column there holds no band.
 *  It is not given a copy of a neighbour — that draws a flat step into the bass edge —
 *  but stands at its own place on the axis, `at`, a fractional band: the straight line
 *  between the two bands either side, which is what the picture draws there anyway. */
export function columnBands(bands: number, columns: number): Array<{ from: number; to: number; at?: number }> {
  if (columns < 2) return columns === 1 ? [{ from: 0, to: bands }] : [];
  const out: Array<{ from: number; to: number; at?: number }> =
    Array.from({ length: columns }, () => ({ from: -1, to: -1 }));
  for (let b = 0; b < bands; b++) {
    const c = Math.round(bandFraction(b, bands) * (columns - 1));
    if (out[c].from < 0) out[c].from = b;
    out[c].to = b + 1;
  }
  for (let c = 0; c < columns; c++) {
    if (out[c].from >= 0) continue;
    // bandFraction inverted: the band drawn at c / (columns − 1).
    const at = (bands - 1) * Math.pow(c / (columns - 1), 1 / X_WARP);
    const from = Math.min(bands - 2, Math.floor(at));
    out[c] = { from, to: from + 2, at };
  }
  return out;
}

/** The stored mesh in a detail. `high` is the mesh itself, untouched; a coarser detail
 *  pools each (rowsPer × column) block to its LOUDEST byte. The last line pools what rows
 *  remain.
 *
 *  ⚠️ **MAX, NOT MEAN — measured 2026-10-14 on three stored tracks.** The mean drew a
 *  near-flat sheet: it deletes a kick drum the way §9's time reduction would (one loud
 *  row in a block of quiet ones), and cut the row-to-row variation by up to 40 %. The
 *  max keeps the beat and the band's peak. It is still a byte off the fixed span —
 *  nothing per track, and a block half as loud draws exactly half as high. */
export function shapeMesh(bytes: ArrayLike<number>, rows: number, bands: number, rowSeconds: number,
                          detail: Detail): Shaped {
  const k = Math.max(1, Math.floor(detail.rowsPer));
  const pitch = PITCH * k;
  const visible = Math.max(1, Math.round(VISIBLE_ROWS / k));
  if (k === 1 && !(detail.columns > 0)) {
    return { values: bytes, rows, bands, rowSeconds, warp: X_WARP, pitch, visible, detail };
  }
  const cols = detail.columns > 0 ? columnBands(bands, detail.columns) : null;
  const across = cols ? cols.length : bands;
  const lines = Math.ceil(rows / k);
  const values = new Float32Array(lines * across);
  for (let line = 0; line < lines; line++) {
    const r0 = line * k, r1 = Math.min(rows, r0 + k);
    for (let c = 0; c < across; c++) {
      const { from, to, at } = cols ? cols[c] : { from: c, to: c + 1, at: undefined };
      let top = 0;
      for (let r = r0; r < r1; r++) {
        if (at !== undefined) {
          const f = at - from, lo = bytes[r * bands + from];
          top = Math.max(top, lo + (bytes[r * bands + from + 1] - lo) * f);
        } else {
          for (let b = from; b < to; b++) top = Math.max(top, bytes[r * bands + b]);
        }
      }
      values[line * across + c] = top;
    }
  }
  return { values, rows: lines, bands: across, rowSeconds: rowSeconds * k, warp: cols ? 1 : X_WARP,
           pitch, visible, detail };
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
export function lineOf(line: number, w: LiveWindow, pitch = PITCH): { live: boolean; row: number; z: number } {
  if (line === w.lines - 1) return { live: true, row: w.live, z: rowZ(w.live, pitch) };
  const row = w.start + line;
  return { live: false, row, z: rowZ(row, pitch) };
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
export function followPose(scroll: number, pitch = PITCH): Pose {
  const focusZ = rowZ(Math.max(0, scroll), pitch);
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
