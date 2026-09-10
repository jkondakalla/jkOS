// pulsarmap.ts — the PURE math under <Pulsarmap/> (ALGORITHMS.md §9). No DOM, no
// React, no runtime imports — so test/pulsarmap.mjs can transpile this one file in
// isolation and drive the real functions, the same house pattern `scrub.ts`,
// `bbDelta.ts` and `hudPrefs.ts` follow.
//
// ⚠️ **EVERY FAILURE MODE IN HERE IS SILENT.** A reveal that drifts three
// milliseconds per row is a whole row out by minute ten, and it looks like a
// stylistic choice. A pan that clamps wrong hides the newest row and reads as
// "the picture stopped". Nothing throws, nothing logs, and the only symptom is a
// picture that is subtly not about the song. That is the entire reason this is a
// separate file with a gate on it rather than three expressions inside a
// component.
//
// ⚠️ **THE REVEAL IS DRIVEN BY `currentTime`, NEVER BY A TIMER.** Not a style
// preference: a `setInterval` counting seconds desynchronises on buffering, on
// seek, and on a playback-rate change — and `packages/player` has a rate module,
// so the last one is real here. Every function below takes the time as an
// argument for exactly that reason; there is nothing in this file that could hold
// a clock.

/** Below this row pitch, M2 measured that every line's excursion crosses two
 *  neighbours and the stack collapses into a uniform hatch — "a picture that
 *  reads as *the transform is broken* when the transform is fine and the picture
 *  is merely too small."
 *
 *  ⚠️ This is why the canvas PANS instead of squashing to fit. A 20-minute track
 *  is ~600 rows, which at this pitch is 5,400 px and fits nothing; scaling those
 *  600 rows into a 400 px panel is a 0.7 px pitch and an unreadable smear. So the
 *  pitch is a constant and the viewport moves. */
export const MIN_ROW_PITCH = 9;

/** Rows the stack is drawn at. Clamped up to `MIN_ROW_PITCH`, so a caller that
 *  computes a pitch from available height cannot quietly produce the hatch. */
export function rowPitch(requested: number): number {
  return Number.isFinite(requested) ? Math.max(MIN_ROW_PITCH, requested) : MIN_ROW_PITCH;
}

/**
 * The index of the newest row that has arrived at `currentTime`, or -1 before the
 * first one (and for a mesh with no rows).
 *
 *   row = floor(currentTime / rowSeconds)
 *
 * ⚠️ `rowSeconds` comes FROM THE MESH, never from a constant here. The builder
 * derives it from `config.frame_seconds()` — 1.9969 s at the baseline, not the
 * 2.0 s target — and the 3 ms difference is one whole row of drift by minute ten.
 * A literal `2` in this file would be right for about nine minutes.
 *
 * A non-finite time is treated as 0 rather than as an error: an `<audio>` element
 * reports `NaN` for `currentTime` before metadata loads, which is a normal frame
 * to render, not a fault.
 */
export function revealIndex(currentTime: number, rowSeconds: number, rows: number): number {
  if (!Number.isFinite(rows) || rows <= 0) return -1;
  if (!Number.isFinite(rowSeconds) || rowSeconds <= 0) return -1;
  const t = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  return Math.min(rows - 1, Math.floor(t / rowSeconds));
}

/** How many rows should be on the canvas at `currentTime` — `revealIndex` + 1, so
 *  row 0 is present from t = 0 rather than appearing 2 s in. */
export function rowsRevealed(currentTime: number, rowSeconds: number, rows: number): number {
  return revealIndex(currentTime, rowSeconds, rows) + 1;
}

/** What the renderer has already painted. `trackId` is part of it because a track
 *  change is not a seek — the canvas is thrown away rather than repainted. */
export interface RevealState {
  trackId: string | number | null;
  /** Rows already painted onto the offscreen canvas. */
  painted: number;
}

export interface RevealFrame {
  trackId: string | number | null;
  currentTime: number;
  rowSeconds: number;
  rows: number;
}

/**
 * What to draw this animation frame.
 *
 *  - `idle`    nothing changed. **This is the pause case**, and it falls out
 *              rather than being special-cased: a paused element's `currentTime`
 *              does not move, so the target does not move. A `paused` flag here
 *              would be a second source of truth about whether time is passing.
 *  - `append`  draw rows [from, to) onto the existing canvas. ⚠️ **THE STEADY
 *              STATE, AND THE WHOLE OPTIMISATION.** Each row is an opaque filled
 *              path that occludes the ones behind it, drawn in front, so the
 *              canvas is append-only: the cost of a reveal is one polyline every
 *              two seconds rather than a full redraw at 60 Hz. Reverse the
 *              direction and a new row has to be drawn BEHIND the stack, which
 *              means repainting everything in front of it every time.
 *  - `repaint` a seek BACKWARDS. The canvas cannot un-draw, so it is cleared and
 *              rows [0, to) are redrawn offscreen.
 *  - `reset`   a different track. Clear and start again, and the previous mesh is
 *              no longer the picture.
 */
export type RevealAction = 'idle' | 'append' | 'repaint' | 'reset';

export interface RevealPlan {
  action: RevealAction;
  /** First row index to draw, inclusive. */
  from: number;
  /** One past the last row to draw. `from === to` means draw nothing. */
  to: number;
  /** Whether the canvas must be cleared before drawing. */
  clear: boolean;
  /** The state to carry into the next frame. */
  next: RevealState;
}

export function planReveal(state: RevealState, frame: RevealFrame): RevealPlan {
  const target = rowsRevealed(frame.currentTime, frame.rowSeconds, frame.rows);

  if (state.trackId !== frame.trackId) {
    return {
      action: 'reset', from: 0, to: target, clear: true,
      next: { trackId: frame.trackId, painted: target },
    };
  }
  if (target > state.painted) {
    return {
      action: 'append', from: state.painted, to: target, clear: false,
      next: { trackId: frame.trackId, painted: target },
    };
  }
  if (target < state.painted) {
    return {
      action: 'repaint', from: 0, to: target, clear: true,
      next: { trackId: frame.trackId, painted: target },
    };
  }
  return { action: 'idle', from: target, to: target, clear: false, next: state };
}

/** A fresh state — nothing painted, no track. */
export function emptyReveal(): RevealState {
  return { trackId: null, painted: 0 };
}

/* ── Geometry ────────────────────────────────────────────────────────────────
   The mesh carries rows and a row duration and NOTHING about pixels, so every
   number below belongs to the renderer. Row 0 is the oldest and sits at the back
   (top); the newest row is nearest the viewer (bottom). */

/** Height of the offscreen canvas for a whole track: one pitch per row, plus the
 *  amplitude the first row's excursion needs above its own baseline. */
export function canvasHeight(rows: number, pitch: number, amplitude: number): number {
  const n = Math.max(0, Math.floor(rows));
  return amplitude + Math.max(0, n - 1) * pitch + amplitude;
}

/** The y of row `index`'s baseline on that canvas. */
export function rowBaseline(index: number, pitch: number, amplitude: number): number {
  return amplitude + Math.max(0, index) * pitch;
}

/**
 * How far to scroll the offscreen canvas so the newest revealed row sits at
 * `anchorY` in a viewport `viewportHeight` tall.
 *
 * ⚠️ **CLAMPED AT BOTH ENDS, AND BOTH ENDS MATTER.** Early in a track the stack
 * is shorter than the viewport, so the offset must not go negative and drag the
 * picture off the top. Late in a track the offset must not scroll past the
 * canvas, which would show blank space below the newest row — the frame in which
 * the picture appears to have stopped. Neither would throw.
 */
export function panOffset(
  revealed: number,
  rows: number,
  pitch: number,
  amplitude: number,
  viewportHeight: number,
  anchorY: number,
): number {
  const height = canvasHeight(rows, pitch, amplitude);
  const newest = rowBaseline(Math.max(0, revealed - 1), pitch, amplitude);
  const raw = newest - anchorY;
  const max = Math.max(0, height - viewportHeight);
  return Math.max(0, Math.min(raw, max));
}

/**
 * One row's polyline, in canvas coordinates — `bands` points across `width`, each
 * lifted off the row's baseline in proportion to its byte.
 *
 * ⚠️ **DEQUANTISATION IS NOT PART OF THIS.** The bytes are drawn as bytes,
 * against the same 0…255 span for every row of every track, because the store's
 * value range is SHARED. A per-track contrast stretch applied here would undo at
 * the last possible moment exactly what the shared scale exists to guarantee —
 * the third place the same mistake could enter, after the builder and the
 * quantiser, and the only one that leaves the stored data correct.
 */
export function rowPoints(
  row: ArrayLike<number>,
  baseline: number,
  width: number,
  amplitude: number,
): number[] {
  const n = row.length;
  const out: number[] = [];
  if (n === 0) return out;
  const step = n > 1 ? width / (n - 1) : 0;
  for (let b = 0; b < n; b++) {
    out.push(b * step, baseline - (row[b] / 255) * amplitude);
  }
  return out;
}

/** The stored bytes as a row-major grid of rows. Throws on a length that does not
 *  match the declared shape: a short buffer reshaped against a remembered row
 *  count is a picture with a wrapped time axis — plausible, and wrong. */
export function toRows(bytes: Uint8Array, rows: number, bands: number): Uint8Array[] {
  if (bytes.length !== rows * bands) {
    throw new Error(`pulsarmap: ${bytes.length} bytes for a declared ${rows}x${bands} = ${rows * bands}`);
  }
  const out: Uint8Array[] = [];
  for (let r = 0; r < rows; r++) out.push(bytes.subarray(r * bands, (r + 1) * bands));
  return out;
}

/** base64 → bytes. The mesh rides in an ordinary JSON body (see
 *  `src/routes/discover.js`), so this is the one decode step on the client. */
export function decodeMesh(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
