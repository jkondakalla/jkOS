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
 *  ⚠️ This is why the strip SCROLLS instead of squashing to fit. A 20-minute track
 *  is ~12,900 rows; scaling them into a 136 px strip is a 0.01 px pitch and an
 *  unreadable smear. So the pitch is a constant and the rows flow past. */
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
 * derives it from `config.frame_seconds()` — 0.09288 s at the baseline, not the
 * 0.1 s target — and the 7 ms difference is a whole row of drift every ~1.4 s. A
 * literal `0.1` in this file would be wrong before the first chorus.
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

/** How many rows have arrived at `currentTime` — `revealIndex` + 1, so row 0 is
 *  present from t = 0 rather than appearing a row in. */
export function rowsRevealed(currentTime: number, rowSeconds: number, rows: number): number {
  return revealIndex(currentTime, rowSeconds, rows) + 1;
}

/**
 * Where the stack has scrolled to at `currentTime`, in ROWS — continuous, so the
 * picture flows at the track's own rate rather than stepping a row at a time.
 *
 *   scroll = min(rows − 1, currentTime / rowSeconds)
 *
 * Row `r` arrives exactly when `scroll` reaches `r` (`floor(scroll)` IS
 * `revealIndex`), sits at the front at that instant, and recedes one pitch per row
 * of music after it. Both renderers are positioned by this one number: the 2-D
 * strip's baselines (`stripBaseline`) and the 3-D camera's focus (ridges3d
 * `followPose`).
 *
 * ⚠️ **STILL `currentTime`, AND NOW EVERY FRAME.** At ~10.8 rows a second (0.093 s
 * rows, Jag 2026-09-23) the player's ~4 Hz `timeupdate` would move the picture in
 * visible 250 ms jumps, so the caller reads the element's own time each animation
 * frame (`@jkos/player`'s `livePosition()`). A clock of the renderer's own,
 * extrapolating between updates, is the thing this file exists to refuse.
 *
 * −1 for a mesh with no rows or a non-positive row duration; NaN (no metadata yet)
 * or a negative time is row 0.
 */
export function scrollRow(currentTime: number, rowSeconds: number, rows: number): number {
  if (!Number.isFinite(rows) || rows <= 0) return -1;
  if (!Number.isFinite(rowSeconds) || rowSeconds <= 0) return -1;
  const t = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  return Math.min(rows - 1, t / rowSeconds);
}

/* ── The 2-D strip ───────────────────────────────────────────────────────────
   The mesh carries rows and a row duration and NOTHING about pixels, so every
   number below belongs to the renderer. Newer rows sit lower (in front), older
   rows higher (behind); the stack scrolls UP as the track plays.

   ⚠️ **A WINDOW, REDRAWN EVERY FRAME — NOT A FULL-TRACK CANVAS ANY MORE.** At 2 s
   rows the strip was one offscreen canvas holding the whole track, appended to a
   row at a time. At ~10.8 rows a second a four-minute track is 2,584 rows — at a
   9 px pitch, 23,000 CSS px of canvas, past every browser's limit on a phone — and
   the stack has to move every frame anyway. So each frame draws only the rows in
   view, back to front, and the picture is a pure function of the time: nothing is
   carried between frames, so a seek, a track change and a pause need no special
   case at all. */

export interface StripWindow {
  /** First row to draw, inclusive — the oldest one still reaching into view. */
  from: number;
  /** One past the newest revealed row. `from === to` draws nothing. */
  to: number;
}

/** The y of row `index`'s baseline when the stack has scrolled to `scroll`: the row
 *  arriving now sits at `anchorY`, and every row of music since lifts it one pitch. */
export function stripBaseline(index: number, scroll: number, pitch: number, anchorY: number): number {
  return anchorY - (scroll - index) * pitch;
}

/** The rows to draw at `scroll`: every revealed row whose filled body (baseline down
 *  to baseline + pitch) still reaches the top edge, oldest first. */
export function stripWindow(scroll: number, pitch: number, anchorY: number): StripWindow {
  if (!(scroll >= 0)) return { from: 0, to: 0 };
  const to = Math.floor(scroll) + 1;
  const from = Math.max(0, Math.floor(scroll - (anchorY + pitch) / pitch));
  return { from, to };
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
