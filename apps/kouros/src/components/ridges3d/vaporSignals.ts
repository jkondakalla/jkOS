// vaporSignals.ts — the music, as the handful of numbers the vaporwave pulsarmap moves by
// (ridges3d/vapor.ts, `detail: 'vapor'`; ALGORITHMS.md §9). Pure: no DOM, no GL, NO CLOCK —
// test/pulsarmap.mjs drives it directly.
//
// Jag, 2026-10-15: "a way more vaporwave version … go insane", then "try to keep it tied to
// the music. This is an exploration rather than a throwaway." So nothing in the vapor
// picture moves on a timer: the sun swells on the bass, its stripes scroll with the mids,
// the stars twinkle with the highs, the sky breathes with the loudness, the palette turns
// with how bright the sound is, the camera sways as far as it is loud and punches in on a
// hit, and the RGB split and the VHS tears fire on onsets. Each of those is a field below,
// and each is a function of the live line (stage.ts `liveAt`) and of the time that has
// passed IN THE TRACK — so a pause holds the picture, and a seek is no special case.

export interface VaporBalance { rest: number; swing: number }

/** What a frame of the vapor picture is driven by; every field ≥ 0. */
export interface VaporSignals {
  /** Bass (the lowest 22 bands) above rest, in swings. The sun's size and halo. */
  bass: number;
  mids: number;
  /** Treble above rest. The stars and the grain. */
  highs: number;
  /** All bands, 0 … 1. The sky's glow, the camera's sway, the reflections. */
  loud: number;
  /** Onset strength, held and decaying, 0 … 1. The RGB split and the camera's punch. */
  hit: number;
  /** A bass-led pulse, 0 … 1. The grid's glow and the lines' brightness. */
  beat: number;
  /** A VHS tear, 0 … 1, and where it is (0 … 1 down the frame) — only on a big onset. */
  tear: number;
  tearY: number;
  /** Accumulated: the sun's stripe scroll (mids), the camera's sway phase (loudness) and
   *  the palette's turn (loudness), plus the spectral centroid, 0 … 1 (brightness). */
  stripe: number;
  sway: number;
  hue: number;
  centroid: number;
}

export interface VaporState extends VaporSignals {
  /** The track time of the last step; NaN before the first. */
  t: number;
  prev: Float32Array | null;
  prevBass: number;
}

/** Onset strength — the summed rise of every band since the last frame, per band —
 *  measured over 60 s of Feel Good Inc at 30 fps: median 0.7, p90 8.7, p99 42. Below
 *  ~p88 it is the motion's own glide, not a hit; a full hit is ~p99. */
export const HIT_FLOOR = 6;
export const HIT_SPAN = 30;
/** A tear needs a hit at least this strong (~p99). */
export const TEAR_AT = 0.8;
export const BASS_BANDS = 22;
export const MID_BANDS = 82;

export function vaporState(): VaporState {
  return { t: NaN, prev: null, prevBass: 0, bass: 0, mids: 0, highs: 0, loud: 0, hit: 0, beat: 0,
           tear: 0, tearY: 0.5, stripe: 0, sway: 0, hue: 0, centroid: 0.5 };
}

/** One frame: the live line `line` (balanced heights, `bands` values) at track time `t`.
 *  Mutates and returns `s`. Time running backwards (a seek) or standing still (a pause)
 *  advances nothing that accumulates. */
export function stepVapor(s: VaporState, line: ArrayLike<number>, t: number, balance: VaporBalance): VaporState {
  const bands = line.length;
  const dt = Number.isFinite(s.t) ? Math.min(0.2, Math.max(0, t - s.t)) : 1 / 30;
  s.t = t;
  const lift = (b: number) => Math.max(0, (line[b] - balance.rest) / balance.swing);
  const range = (a: number, z: number) => {
    let sum = 0;
    for (let b = a; b < z; b++) sum += lift(b);
    return z > a ? sum / (z - a) : 0;
  };
  s.bass = Math.min(1.5, range(0, Math.min(BASS_BANDS, bands)));
  s.mids = range(Math.min(BASS_BANDS, bands), Math.min(MID_BANDS, bands));
  s.highs = Math.min(1.5, range(Math.min(MID_BANDS, bands), bands) * 1.6);
  s.loud = Math.min(1, range(0, bands) * 1.2);

  let flux = 0;
  if (s.prev && s.prev.length === bands) for (let b = 0; b < bands; b++) flux += Math.max(0, line[b] - s.prev[b]);
  s.prev = Float32Array.from(line);
  const onset = dt > 0 ? Math.min(1, Math.max(0, (flux / Math.max(1, bands) - HIT_FLOOR) / HIT_SPAN)) : 0;
  s.hit = Math.max(s.hit * Math.exp(-dt / 0.12), onset);
  const kick = Math.max(0, s.bass - s.prevBass) * 4;
  s.prevBass = s.bass;
  s.beat = Math.max(s.beat * Math.exp(-dt / 0.18), Math.min(1, s.bass * 0.6 + kick));
  if (onset > TEAR_AT && s.tear < 0.3) {
    s.tear = 1;
    // Where the tear lands: a pseudo-random place, but a function of WHEN in the track.
    s.tearY = (Math.sin(t * 1234.5) * 0.5 + 0.5) * 0.8 + 0.1;
  }
  s.tear *= Math.exp(-dt / 0.15);

  s.stripe += s.mids * dt * 1.6;
  s.sway += (0.15 + s.loud) * dt * 0.55;
  s.hue += s.loud * dt * 0.05;
  let w = 0, c = 0;
  for (let b = 0; b < bands; b++) { const l = lift(b); w += l; c += l * b; }
  if (w > 0.5 && bands > 1) s.centroid += ((c / w) / (bands - 1) - s.centroid) * Math.min(1, dt * 3);
  return s;
}
