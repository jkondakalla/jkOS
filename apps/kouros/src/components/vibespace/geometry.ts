// geometry.ts — the PURE math under the vibe space (ALGORITHMS.md §9, M6). No DOM, no
// GL, no clock: test/vibespace.mjs transpiles it and drives the real functions, and
// density.worker.ts runs `densitySlices` off the main thread.
//
// The library is a 3-D cloud you swipe through a 4th dimension — ENERGY, calm →
// intense. Every track is a point (x, y, z) in the unit cube and a percentile w on the
// rail; the server fitted and projected them (music/mapbasis.py, backend map.js).
// What lives here is everything the client does with those numbers; what any 3-D view
// would do (the camera rig, gesture arithmetic, picking, OKLCH) is @jkos/scene's.
//
// ⚠️ **THE CLOUD IS THE TRACKS, AND IT IS CONTINUOUS IN ALL FOUR DIMENSIONS.** Density
// is a sum of one Gaussian per MEASURED track — in space (a trilinear splat, then a
// separable blur) and in w (σ_w = 0.06) — sampled at 48 slices, about a third of σ_w
// apart. The renderer mixes the two slices either side of the swipe position, and the
// cloud MORPHS at any swipe speed instead of stepping. `check:vibespace` MEASURES that
// (G7): the opacity drawn at any w stays within 0.02 of the exact continuous field.
//
// ⚠️ **THE PLAN SAID 32 SLICES AND CALLED THE MIX SMOOTH. MEASURED, IT WAS 1.9% OFF.**
// Smooth, yes — but a linear mix of Gaussians sampled at σ_w/2 bows away from the true
// field between slice centres (9.9% of ρ_ref in raw density, 1.93% in opacity on the
// gate's fixture), which is the kink a fast swipe shows as a pulse. 48 slices: 0.81%.
// (And G7 as first worded — "max voxel change per 1/256 ≤ 2% of ρ_ref" — measured the
// DATA, not the renderer: the exact field itself changes 7.05% of ρ_ref per 1/256,
// because cluster cores sit at ~3× ρ_ref. ALGORITHMS.md §9 M6 records both.)
//
// ⚠️ **ONE TONE MAP FOR EVERY SLICE — NEVER NORMALISE PER SLICE.** α = 1 − exp(−ρ/ρ_ref)
// with ρ_ref the p99 voxel density over ALL slices. Normalise per slice and the few
// tracks at the calm end of a library would fill the cube as brightly as the thousands
// in its middle: a sparse region must look sparse at every energy. This is the house's
// third instance of the rule (M2's value range, M7's shared mesh scale).
//
// ⚠️ **INFERRED ROWS NEVER FEED THE DENSITY.** An inferred row is its album's centroid,
// so every uncovered track of an album sits on ONE point — a false hot spot the size of
// an album. They are drawn as dimmer particles and nothing else.

import {
  DEG, clamp, fitDistance, lerp, oklchToSrgb, orbitView, rayBox, springStep,
  type RGB, type Spring, type Vec3, type View,
} from '@jkos/scene/math';

/* ── the wire payload ────────────────────────────────────────────────────────── */
/** The wire's packing — backend/src/discover/map.js `vibeMap` is the one encoder. */
export interface PackedMap {
  n: number;
  /** Int32LE deltas from the previous id (the first is absolute). */
  ids: string;
  /** Uint32LE: x 11 bits << 21 | y 11 bits << 10 | z 10 bits. */
  xyz: string;
  /** Uint16LE: energy percentile × 4095. */
  w: string;
  /** Uint8: tone × 63 << 2 | flags. */
  tf: string;
}

export interface DecodedMap {
  n: number;
  /** Sorted ascending — `indexOfId` binary-searches it. */
  ids: Int32Array;
  /** Display units, the unit cube [−1, 1]³, row-major (x, y, z). */
  xyz: Float32Array;
  /** Energy percentile, [0, 1]. */
  w: Float32Array;
  /** Brightness percentile, [0, 1] (0.5 where unknown — see flags). */
  tone: Float32Array;
  flags: Uint8Array;
}

export const FLAG_INFERRED = 1;
export const FLAG_NO_TONE = 2;

function bytesOf(b64: string): DataView {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new DataView(bytes.buffer);
}

/** base64 little-endian columns → typed arrays. Throws on a length that does not
 *  match `n`: a short column read against a remembered count is a cloud whose points
 *  have been shuffled onto other tracks — plausible, and wrong. */
export function decodeMap(p: PackedMap): DecodedMap {
  const n = p.n;
  const ids = bytesOf(p.ids);
  const xyz = bytesOf(p.xyz);
  const w = bytesOf(p.w);
  const tf = bytesOf(p.tf);
  if (ids.byteLength !== n * 4 || xyz.byteLength !== n * 4 || w.byteLength !== n * 2 || tf.byteLength !== n) {
    throw new Error(`vibespace: packed columns do not match n=${n} ` +
      `(ids ${ids.byteLength}, xyz ${xyz.byteLength}, w ${w.byteLength}, tf ${tf.byteLength})`);
  }
  const out: DecodedMap = {
    n, ids: new Int32Array(n), xyz: new Float32Array(n * 3), w: new Float32Array(n),
    tone: new Float32Array(n), flags: new Uint8Array(n),
  };
  const unq = (v: number, bits: number) => (v / ((1 << bits) - 1)) * 2 - 1;
  let id = 0;
  for (let i = 0; i < n; i++) {
    id += ids.getInt32(i * 4, true);
    out.ids[i] = id;
    const word = xyz.getUint32(i * 4, true);
    out.xyz[i * 3] = unq(Math.floor(word / 2 ** 21) & 0x7ff, 11);
    out.xyz[i * 3 + 1] = unq((word >>> 10) & 0x7ff, 11);
    out.xyz[i * 3 + 2] = unq(word & 0x3ff, 10);
    out.w[i] = w.getUint16(i * 2, true) / 4095;
    const t = tf.getUint8(i);
    out.tone[i] = (t >> 2) / 63;
    out.flags[i] = t & 3;
  }
  return out;
}

/** The row holding track `id`, or −1. Binary search: the ids are sorted on the wire. */
export function indexOfId(ids: Int32Array, id: number): number {
  let lo = 0, hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ids[mid] === id) return mid;
    if (ids[mid] < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/* ── the density field ───────────────────────────────────────────────────────── */
export interface DensityOptions {
  grid: number;
  slices: number;
  sigmaW: number;
  sigmaVoxels: number;
}

export const DENSITY: DensityOptions = { grid: 48, slices: 48, sigmaW: 0.06, sigmaVoxels: 1.25 };

export const sliceW = (j: number, slices: number): number => (j + 0.5) / slices;

/** The two slices either side of `w` and how far between them it sits — the one
 *  definition the renderer's texture pair and `u_mix` come from. Below the first
 *  slice centre or above the last, it holds the end slice rather than extrapolating. */
export function sliceMix(w: number, slices: number): { lo: number; hi: number; f: number } {
  const x = clamp(w, 0, 1) * slices - 0.5;
  const lo = clamp(Math.floor(x), 0, slices - 2);
  return { lo, hi: lo + 1, f: clamp(x - lo, 0, 1) };
}

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable Gaussian blur of a G³ field in place, clamping at the edges (zero padding
 *  would darken the cube's faces, which are exactly where the extremes of a library sit).
 *
 *  ⚠️ Line by line through a padded copy, not tap by tap with a clamp: the blur is ~90% of
 *  the density worker's time (48 slices × 2 fields × 3 passes), and the clamp-per-tap form
 *  took 1.4 s on the real library on a desktop — several seconds on a phone. */
export function blur3d(field: Float32Array, grid: number, sigma: number, scratch = new Float32Array(field.length)): void {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const G = grid;
  const line = new Float32Array(G + 2 * r);
  const pass = (src: Float32Array, dst: Float32Array, stride: number, outer: number, inner: number) => {
    // `stride` walks the blurred axis; `outer` × `inner` enumerate the lines' starts.
    for (let o = 0; o < G; o++) {
      for (let i = 0; i < G; i++) {
        const base = o * outer + i * inner;
        for (let t = 0; t < G; t++) line[t + r] = src[base + t * stride];
        const first = line[r], last = line[r + G - 1];
        for (let t = 0; t < r; t++) { line[t] = first; line[G + r + t] = last; }
        for (let t = 0; t < G; t++) {
          let acc = 0;
          for (let q = 0; q < k.length; q++) acc += line[t + q] * k[q];
          dst[base + t * stride] = acc;
        }
      }
    }
  };
  // index = (z·G + y)·G + x
  pass(field, scratch, 1, G * G, G);          // along x: lines start at (z, y)
  pass(scratch, field, G, G * G, 1);          // along y: lines start at (z, x)
  pass(field, scratch, G * G, G, 1);          // along z: lines start at (y, x)
  field.set(scratch);
}

/** Splat every MEASURED point into slice `j`. */
export function splatSlice(map: DecodedMap, j: number, opts: DensityOptions, density: Float32Array): void {
  splatAt(map, sliceW(j, opts.slices), opts, density);
}

/** Splat every MEASURED point at an arbitrary `wj`: a Gaussian in w, trilinear in
 *  space. At a slice centre this IS the slice; anywhere else it is the exact
 *  continuous field the gate holds the slice mix to. (No colour rides along: a
 *  voxel's colour is its place's, `styleColour`.) */
export function splatAt(map: DecodedMap, wj: number, opts: DensityOptions, density: Float32Array): void {
  const G = opts.grid;
  const inv2s2 = 1 / (2 * opts.sigmaW * opts.sigmaW);
  const cutoff = 3.5 * opts.sigmaW;
  density.fill(0);
  for (let i = 0; i < map.n; i++) {
    if (map.flags[i] & FLAG_INFERRED) continue;
    const dw = map.w[i] - wj;
    if (Math.abs(dw) > cutoff) continue;
    const wt = Math.exp(-dw * dw * inv2s2);
    const fx = clamp((map.xyz[i * 3] + 1) * 0.5 * G - 0.5, 0, G - 1);
    const fy = clamp((map.xyz[i * 3 + 1] + 1) * 0.5 * G - 0.5, 0, G - 1);
    const fz = clamp((map.xyz[i * 3 + 2] + 1) * 0.5 * G - 0.5, 0, G - 1);
    const x0 = Math.min(G - 2, Math.floor(fx)), y0 = Math.min(G - 2, Math.floor(fy)), z0 = Math.min(G - 2, Math.floor(fz));
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const cw = wt * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      const v = ((z0 + dz) * G + (y0 + dy)) * G + (x0 + dx);
      density[v] += cw;
    }
  }
}

/** The shared reference density: the p99 over every non-empty voxel of EVERY slice. */
export function rhoReference(slices: Float32Array[], percentile = 0.99): number {
  let max = 0;
  for (const s of slices) for (let i = 0; i < s.length; i++) if (s[i] > max) max = s[i];
  if (!(max > 0)) return 1;
  const BINS = 8192;
  const hist = new Float64Array(BINS);
  const floor = max * 1e-4;
  let count = 0;
  for (const s of slices) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] <= floor) continue;
      hist[Math.min(BINS - 1, Math.floor((s[i] / max) * BINS))]++;
      count++;
    }
  }
  const target = count * percentile;
  let seen = 0;
  for (let b = 0; b < BINS; b++) {
    seen += hist[b];
    if (seen >= target) return ((b + 1) / BINS) * max;
  }
  return max;
}

/** α = 1 − exp(−ρ/ρ_ref). Monotone, 0 at empty, and never per slice. */
export const toneMap = (rho: number, rhoRef: number): number => 1 - Math.exp(-rho / (rhoRef > 0 ? rhoRef : 1));

export interface DensityField {
  grid: number;
  slices: number;
  rhoRef: number;
  /** Per slice, R8: α through the shared tone map. */
  textures: Uint8Array[];
  /** Per slice, the blurred raw density — kept for picking and for the gate. */
  density: Float32Array[];
}

export function densitySlices(map: DecodedMap, opts: DensityOptions = DENSITY): DensityField {
  const G3 = opts.grid ** 3;
  const density: Float32Array[] = [];
  const scratch = new Float32Array(G3);
  for (let j = 0; j < opts.slices; j++) {
    const d = new Float32Array(G3);
    splatSlice(map, j, opts, d);
    blur3d(d, opts.grid, opts.sigmaVoxels, scratch);
    density.push(d);
  }
  const rhoRef = rhoReference(density);
  const textures = density.map((d) => quantizeSlice(d, rhoRef));
  return { grid: opts.grid, slices: opts.slices, rhoRef, textures, density };
}

export function quantizeSlice(density: Float32Array, rhoRef: number): Uint8Array {
  const out = new Uint8Array(density.length);
  for (let v = 0; v < density.length; v++) out[v] = Math.round(toneMap(density[v], rhoRef) * 255);
  return out;
}

/** The opacity the renderer draws at `w`: the two slices' tone-mapped α, mixed
 *  linearly — what the shader does with its two R8 textures, minus the quantisation. */
export function alphaAt(field: { density: Float32Array[]; slices: number; rhoRef: number },
                        w: number, voxel: number): number {
  const { lo, hi, f } = sliceMix(w, field.slices);
  return lerp(toneMap(field.density[lo][voxel], field.rhoRef), toneMap(field.density[hi][voxel], field.rhoRef), f);
}

/* ── particles and labels, through the 4th dimension ─────────────────────────── */
/** A track's glint at swipe position w0: full on its own slice, gone by ±0.08. */
export const glint = (dw: number): number => Math.exp(-((dw / 0.04) ** 2));
/** A region label fades more slowly than a particle, so names outlast the glints. */
export const labelAlpha = (dw: number): number => Math.exp(-((dw / 0.1) ** 2));

export const ENERGY_WORDS = ['calm', 'mellow', 'steady', 'lively', 'intense'] as const;
export function energyWord(w: number): (typeof ENERGY_WORDS)[number] {
  return ENERGY_WORDS[clamp(Math.floor(clamp(w, 0, 1) * 5), 0, 4)];
}

/* ── the camera ──────────────────────────────────────────────────────────────── */
export const CAMERA = {
  /** Wide enough that a PORTRAIT phone's horizontal field (~39°) still frames the
   *  library from close in — perspective is part of what makes the cloud read as 3-D. */
  fov: 50 * DEG,
  pitch: 17 * DEG,
  /** A double-tap flies in to this distance from the pin. */
  flyDistance: 1.45,
  omega: 6,
  spinPerPx: 0.55 * DEG,
  spinFriction: 3.2,
} as const;

/** The lens the cloud is seen through (@jkos/scene `Lens`). */
export const LENS = { fov: CAMERA.fov, near: 0.05, far: 40 } as const;

/** The view from `yaw` about `target` — the rig's view (`rigView`), for a caller
 *  that has no rig: the gate's framing check. */
export function spaceView(yaw: number, target: Vec3, distance: number, aspect: number,
                          pitch: number = CAMERA.pitch): View {
  return orbitView(target, yaw, pitch, distance, aspect, LENS);
}

/** Display radius the framing holds in view. The server scales xyz by the p98 of the
 *  library's radius (map.js / mapbasis.py `R`), so the unit sphere holds 98% of the
 *  tracks; the cube's corners (√3) are where the clamped 2% pile up. The first cut
 *  fitted the corners and spent a third of a phone screen on empty margin. */
export const FRAME_RADIUS = 1.12;

/** The distance at which FRAME_RADIUS (with a 4% margin) just fits the narrower of
 *  the two fields of view — what keeps a portrait phone from cropping the cloud at any
 *  yaw. */
export function frameDistance(aspect: number, margin = 1.04): number {
  return fitDistance(aspect, FRAME_RADIUS * margin, CAMERA.fov);
}

/* ── gestures (the axis lock, velocity and taps are @jkos/scene's) ──────────────── */
/** A scrub: dragging UP means more intense; a full field height is the whole rail. */
export function scrubTo(w0Start: number, dy: number, fieldHeight: number): number {
  return clamp(w0Start - dy / Math.max(1, fieldHeight), 0, 1);
}

export const STOP_HORIZON = 0.28;

/** The snap stop a release lands on: where the velocity would carry it in
 *  STOP_HORIZON seconds, then the nearest stop to that. A flick travels; a still
 *  release settles on the nearest. */
export function projectedStop(w: number, velocity: number, stops: readonly number[],
                              horizon = STOP_HORIZON): number {
  const aim = clamp(w + velocity * horizon, 0, 1);
  let best = stops[0], bd = Infinity;
  for (const s of stops) { const d = Math.abs(s - aim); if (d < bd) { bd = d; best = s; } }
  return best;
}

/** The next stop strictly above (dir = 1) or below (dir = −1) `w`, or `w`'s own end. */
export function nextStop(w: number, stops: readonly number[], dir: 1 | -1): number {
  const eps = 1e-3;
  if (dir > 0) { for (const s of stops) if (s > w + eps) return s; return stops[stops.length - 1]; }
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < w - eps) return stops[i];
  return stops[0];
}

export const W_OMEGA = 9;
/** One frame of the energy spring toward a stop. */
export const wStep = (s: Spring, target: number, dt: number): Spring => springStep(s, target, W_OMEGA, dt);

/* ── picking (the nearest glint is @jkos/scene's `pickNearest`) ──────────────── */
/** The densest point along a ray through the cube, for a tap that hit no particle. */
export function pickDensest(origin: Vec3, dir: Vec3, sample: (p: Vec3) => number, steps = 64): Vec3 | null {
  const hit = rayBox(origin, dir);
  if (!hit) return null;
  let best: Vec3 | null = null, bd = 0;
  for (let s = 0; s < steps; s++) {
    const t = lerp(hit[0], hit[1], (s + 0.5) / steps);
    const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const d = sample(p);
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}

/** The voxel holding a display-space point. */
export function voxelOf(p: Vec3, grid: number): number {
  const i = (c: number) => clamp(Math.floor((c + 1) * 0.5 * grid), 0, grid - 1);
  return (i(p[2]) * grid + i(p[1])) * grid + i(p[0]);
}

/* ── the colour: every place has its own (a hue wheel over the style plane) ──── */
/** How a place in the cloud is coloured. ALGORITHMS.md §9, M6.
 *
 *  The colour is a function of x and z ONLY — the two axes a spin carries round the
 *  screen. y needs no colour (the pitch never moves, so it is always "up"), and energy
 *  has its own instrument, the rail: a colour that also said "intense" would be two
 *  instruments disagreeing about one number (map.js refuses energy as a label word
 *  for the same reason). The (x, z) plane maps to OKLab's (a, b) plane by a rotation,
 *  so the angle round the cloud is the hue and the distance out from its middle is the
 *  chroma, pulled up by tanh so the dense middle of a library is coloured rather than
 *  grey. Lightness is one value per face.
 *
 *  ⚠️ SIMILAR PLACES, SIMILAR COLOURS — AS A BOUND, NOT A HOPE. The map is Lipschitz:
 *  two tracks δ apart in display units are at most `styleLipschitz(face)`·δ apart in
 *  OKLab, everywhere, with no seam round the wheel. `check:vibespace` measures it on
 *  the colours actually drawn — after the gamut pull, which the bound's derivation
 *  does not cover. The middle of the cloud is near-neutral by the same continuity:
 *  the library's average sound has no one character.
 *  A hue taken from an angle through the ORIGIN (h = atan2 with a floor on chroma)
 *  would not be: at the middle of the cloud, two neighbours would be opposite colours.
 *
 *  ⚠️ NOT THE SLEEVE ACCENT, AND NOT A RAMP. A place keeps its colour whatever is
 *  playing — "the teal corner is ambient" must stay true, as the regions stay put
 *  across restarts (map.js mulberry32). And this is not the "one hue, ordered by
 *  lightness" rule for magnitudes: no quantity here is ordered, and colour never
 *  carries anything alone — the particle is drawn AT its place, and the key names the
 *  two axes. */
export const STYLE = {
  /** OKLCH hue at the +x pole; the wheel turns toward +z. With the fit's current
   *  axes: busy → rose, bright → yellow, sparse → cyan, dark → violet. */
  hue0: 20 * DEG,
  /** Chroma rises as tanh(gain·ρ)/tanh(gain) — steepest at the middle, where the
   *  library is densest, and flat past ρ ≈ 1 where the clamped outliers pile up. */
  gain: 1.8,
  chroma: { dark: 0.13, paper: 0.12 },
  /** Held well off each face's surface (hub.css --hub-bg-0: L 0.16 dark, 0.91 paper). */
  lightness: { dark: 0.78, paper: 0.62 },
  /** The lookup texture is lut × lut, NODE-aligned: node i sits at −1 + 2i/(lut − 1).
   *  128, not 64: where the gamut pull puts a crease in the paper face's teal, 64
   *  texels drew 3.9/255 off the function; 128 draw 2.0 (the gate holds ≤ 3). */
  lut: 128,
} as const;

export type Face = 'paper' | 'dark';

/** A place's colour, as (L, a, b) in OKLab before the gamut is applied. */
function styleLab(x: number, z: number, face: Face): [number, number, number] {
  const rho = Math.hypot(x, z);
  const lift = rho > 0 ? Math.tanh(STYLE.gain * rho) / (Math.tanh(STYLE.gain) * rho) : STYLE.gain / Math.tanh(STYLE.gain);
  const k = STYLE.chroma[face] * lift;
  const c = Math.cos(STYLE.hue0), s = Math.sin(STYLE.hue0);
  return [STYLE.lightness[face], k * (x * c - z * s), k * (x * s + z * c)];
}

/** The colour of the place at (x, z), sRGB 0–1. Chroma past sRGB's gamut is pulled in
 *  with hue and lightness held (`oklchToSrgb`), never clipped channel by channel. */
export function styleColour(x: number, z: number, face: Face): RGB {
  const [L, a, b] = styleLab(clamp(x, -1, 1), clamp(z, -1, 1), face);
  return oklchToSrgb(L, Math.hypot(a, b), Math.atan2(b, a));
}

/** The steepest the colour can change per display unit, in OKLab, before the gamut
 *  pull: at the middle, where tanh is steepest (d/dρ of tanh(gρ)/tanh(g) is g/tanh(g)
 *  there, and the tangential stretch tanh(gρ)/(ρ·tanh(g)) never exceeds it). */
export const styleLipschitz = (face: Face): number => STYLE.chroma[face] * STYLE.gain / Math.tanh(STYLE.gain);

/** `styleColour` baked to the texture both passes sample, `size`² × RGB8, row z,
 *  column x, node-aligned (STYLE.lut). */
export function styleLut(face: Face, size: number = STYLE.lut): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const rgb = styleColour(-1 + (2 * i) / (size - 1), -1 + (2 * j) / (size - 1), face);
      for (let k = 0; k < 3; k++) out[(j * size + i) * 3 + k] = Math.round(rgb[k] * 255);
    }
  }
  return out;
}

/** The colour a GPU draws at (x, z) from `styleLut`: the shader's own addressing (a
 *  node-aligned coordinate, then bilinear filtering), spelled out so the gate can hold
 *  the texture to the function it was baked from. */
export function sampleStyleLut(lut: Uint8Array, x: number, z: number, size: number = STYLE.lut): RGB {
  const fx = (clamp(x, -1, 1) + 1) * 0.5 * (size - 1), fz = (clamp(z, -1, 1) + 1) * 0.5 * (size - 1);
  const i0 = Math.min(size - 2, Math.floor(fx)), j0 = Math.min(size - 2, Math.floor(fz));
  const tx = fx - i0, tz = fz - j0;
  const at = (i: number, j: number, k: number) => lut[(j * size + i) * 3 + k] / 255;
  return [0, 1, 2].map((k) => lerp(lerp(at(i0, j0, k), at(i0 + 1, j0, k), tx),
                                   lerp(at(i0, j0 + 1, k), at(i0 + 1, j0 + 1, k), tx), tz)) as RGB;
}

/** The same colour as CSS, for the DOM that names places (labels, the key). */
export function styleCss(x: number, z: number, face: Face): string {
  const [r, g, b] = styleColour(x, z, face);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
