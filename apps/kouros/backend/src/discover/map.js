'use strict';
// map.js — the vibe space: every track's place in a 3-D cloud, its position along
// the ENERGY rail you swipe through, what the regions are called, and what sits
// near a point.
//
// Four decisions worth stating, because the obvious alternative is wrong in each:
//
// 1. THE PROJECTION IS FITTED IN `music/`, NOT HERE. `music/mapbasis.py` fits four
//    orthonormal directions once, in the calibrated space — an energy probe `u`
//    and the top three principal axes of what is left once `u` is removed — and
//    stores them in the index beside the calibration. This file only PROJECTS.
//    The JavaScript PCA it replaced ran on every space rebuild (twice), drifted as
//    tracks were added, and had no provenance; a stored basis means a track that
//    arrives next month lands in the same place the library already knows.
//    vectors.js refuses a basis that does not reproduce the fit's golden tracks.
//
// 2. THE 4TH AXIS HAS A NAME, AND THE CLOUD DOES NOT REPEAT IT. Because `u` is
//    removed before the spatial axes are found, the 3-D cloud shows everything
//    about the sound EXCEPT energy, and the swipe shows energy. (UMAP/t-SNE were
//    never options: no stable coordinate, and no ordered axis to swipe through.)
//
// 3. CLUSTER IN THE MAP'S OWN SPACE. Regions are k-means over the raw 4-D
//    coordinates, so a region is a place you can scrub to — clustering in 512-d
//    and projecting would scatter one "neighbourhood" across the cloud, a lie the
//    user can see. MEASURED tracks only: an inferred row is an album centroid, and
//    an album of twelve stacked on one point would out-vote a real cluster.
//
// 4. THE WIRE IS PACKED, NOT A LIST OF OBJECTS. 47,000 tracks as `{id,x,y,z,w}`
//    JSON is ~2.5 MB. Packed as little-endian columns in base64 — inside an ordinary
//    JSON body, so inside every contract the suite enforces (the pulsarmap mesh
//    precedent) — and quantised to what a phone can show: ids as deltas (sorted, so
//    nearly all 1), xyz as 11/11/10 bits in one Uint32 (~0.75 px even flown in), w as
//    12 bits, and a flags byte. Measured at 47,693 tracks: 288 KB gzipped against
//    the 400 KB gate (G6). The first packing — Int16 xyz, Uint16 w, separate tone and
//    flags — was 529 KB. (A brightness "tone" once shared the flags byte, for a
//    brightness colouring; the client now colours a place by where it is, from xyz,
//    so tone left the wire with its last reader.)
const { NFEAT, FEATURE_NAMES, ORIGIN } = require('./space');
const { present, round, diversify } = require('./queries');
const { projectVector } = require('./vectors');

/** Deterministic PRNG — the regions must be identical across restarts, or a user's
 *  remembered "the loud corner is up there" silently stops being true. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Snap stops along the energy rail, as percentiles — equal-population by
 *  construction, because the rail itself is a percentile. */
const STOPS = [0.1, 0.3, 0.5, 0.7, 0.9];
const ANCHOR_POLES = { energy: ['calm', 'intense'] };
/** Below this there is nothing to cluster. The old floor was 8, for a PCA's sake —
 *  there is no PCA here any more, and a three-track library's map is small, not wrong. */
const MIN_MEASURED = 3;
const INFERRED = 1;          // flags bit 0
const W_STEPS = 4095;        // w: 12 bits

/** A display coordinate in [−1, 1] → an unsigned integer of `bits`. */
const quant = (v, bits) => Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * ((1 << bits) - 1));

/* ── the energy percentile, through the fit's quantile table ──────────────────
   The rail is shown as a PERCENTILE so every stretch of the swipe passes through
   the same number of tracks. The table is the fit's, not this catalog's: a track
   added later is placed on the scale the library was measured on. */
function wPercentile(wq, w) {
  const n = wq.length;
  if (!(w > wq[0])) return 0;
  if (!(w < wq[n - 1])) return 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (wq[mid] <= w) lo = mid; else hi = mid;
  }
  const span = wq[hi] - wq[lo];
  const t = span > 0 ? (w - wq[lo]) / span : 0;
  return (lo + t) / (n - 1);
}

function wRaw(wq, p) {
  const n = wq.length;
  const x = Math.max(0, Math.min(1, Number(p) || 0)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  return wq[i] + (wq[i + 1] - wq[i]) * (x - i);
}

/**
 * Every covered row's coordinates through the stored basis, sorted by track id.
 * Computed once per space build and shared by the map and every `near` query.
 */
function buildProjection(space) {
  const map = space.map;
  if (!space.dim) return { available: false, reason: 'no embedded tracks yet' };
  if (!map || !map.available) {
    return { available: false, held: !!(map && map.held),
             reason: (map && map.reason) || 'no vibe space basis' };
  }
  if (map.dim !== space.dim) {
    return { available: false, reason: `the basis is ${map.dim}-d and the space is ${space.dim}-d` };
  }
  const rows = [];
  for (let i = 0; i < space.n; i++) if (space.origin[i] !== ORIGIN.NONE) rows.push(i);
  rows.sort((a, b) => space.ids[a] - space.ids[b]);
  const m = rows.length;
  const rowsIdx = Int32Array.from(rows);
  const raw = new Float64Array(m * 4);
  const xyz = new Float32Array(m * 3);
  const wp = new Float32Array(m);
  const inferred = new Uint8Array(m);
  const vec = new Float32Array(space.dim);
  const c = new Float64Array(4);
  let measured = 0;
  for (let r = 0; r < m; r++) {
    const i = rowsIdx[r];
    const off = i * space.dim;
    for (let d = 0; d < space.dim; d++) vec[d] = space.matrix[off + d];
    projectVector(map, vec, c);
    raw.set(c, r * 4);
    for (let k = 0; k < 3; k++) xyz[r * 3 + k] = Math.max(-1, Math.min(1, c[k] / map.radius));
    wp[r] = wPercentile(map.wq, c[3]);
    inferred[r] = space.origin[i] === ORIGIN.ALBUM ? 1 : 0;
    if (!inferred[r]) measured++;
  }
  return { available: true, map, rowsIdx, raw, xyz, wp, inferred, measured };
}

/** k-means++ seeded Lloyd's algorithm over `n` points of `dims` coordinates
 *  (row-major). Small, deterministic, and dimension-free. */
function kmeans(coords, dims, k, iters = 40, rand = mulberry32(11)) {
  const n = Math.floor(coords.length / dims);
  k = Math.max(1, Math.min(k, n));
  const centres = new Float64Array(k * dims);
  const dist2 = (i, c) => {
    let s = 0;
    for (let d = 0; d < dims; d++) {
      const x = coords[i * dims + d] - centres[c * dims + d];
      s += x * x;
    }
    return s;
  };
  const first = Math.floor(rand() * n);
  for (let d = 0; d < dims; d++) centres[d] = coords[first * dims + d];
  // k-means++: spread the seeds, so a region is never seeded twice.
  const best = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      best[i] = Math.min(best[i], dist2(i, c - 1));
      total += best[i];
    }
    let target = rand() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { target -= best[i]; if (target <= 0) { pick = i; break; } }
    for (let d = 0; d < dims; d++) centres[c * dims + d] = coords[pick * dims + d];
  }
  const assign = new Int32Array(n).fill(-1);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let b = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist2(i, c);
        if (dd < bd) { bd = dd; b = c; }
      }
      if (assign[i] !== b) { assign[i] = b; moved++; }
    }
    const sum = new Float64Array(k * dims);
    const count = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      count[c]++;
      for (let d = 0; d < dims; d++) sum[c * dims + d] += coords[i * dims + d];
    }
    for (let c = 0; c < k; c++) {
      if (!count[c]) continue;
      for (let d = 0; d < dims; d++) centres[c * dims + d] = sum[c * dims + d] / count[c];
    }
    if (!moved) break;
  }
  return { assign, centres, k, dims };
}

/* ── labelling ────────────────────────────────────────────────────────────────
   A region's name comes from what is DISTINCTIVE about it, not from what is most
   common in it: the commonest genre in almost every region of almost every
   library is the commonest genre in the library. So each candidate genre is
   scored by lift — its share inside the region over its share of the whole
   library — with a small-count floor so one stray tag on a three-track region
   cannot name it. A feature qualifier ("fast", "fuzzy") is appended from the
   readable arm when the region is genuinely extreme on that axis.

   ⚠️ ENERGY IS NEVER A QUALIFIER HERE. The rail already states it, and a label
   that says "loud" while you are scrubbed to "calm" is two instruments disagreeing
   about one number. */
const QUALIFIERS = [
  { feature: 'tempo',      high: 'fast',    low: 'slow' },
  { feature: 'fuzz',       high: 'fuzzy',   low: 'clean' },
  { feature: 'brightness', high: 'bright',  low: 'dark' },
];

function labelRegion(space, members, globalGenreShare) {
  const counts = new Map();
  for (const i of members) {
    for (const g of space.meta.genres[i]) {
      const key = String(g).trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let bestGenre = null, bestLift = 0;
  for (const [g, c] of counts) {
    if (c < Math.max(2, members.length * 0.12)) continue;   // the small-count floor
    const share = c / members.length;
    const lift = share / Math.max(globalGenreShare.get(g) || 1e-6, 1e-6);
    if (lift > bestLift) { bestLift = lift; bestGenre = g; }
  }

  const quals = [];
  if (space.features) {
    for (const q of QUALIFIERS) {
      const f = FEATURE_NAMES.indexOf(q.feature);
      if (f < 0) continue;
      let s = 0;
      for (const i of members) s += space.features[i * NFEAT + f];
      const mean = s / members.length;
      if (mean > 0.72) quals.push(q.high);
      else if (mean < 0.28) quals.push(q.low);
    }
  }

  const parts = [...quals.slice(0, 2), bestGenre].filter(Boolean);
  if (!parts.length) {
    // Nothing distinctive — name it after the artist that dominates it, which is
    // always true and never misleading.
    const artists = new Map();
    for (const i of members) {
      const a = space.meta.artist[i];
      if (a) artists.set(a, (artists.get(a) || 0) + 1);
    }
    const top = [...artists.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : 'Mixed';
  }
  const label = parts.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function b64(buffer) { return buffer.toString('base64'); }

/**
 * The whole vibe space payload. `projection` is `buildProjection(space)`.
 *
 *   packed.ids   Int32LE × n    DELTAS from the previous id (the first is absolute);
 *                               ids are sorted ascending, so nearly every delta is 1
 *   packed.xyz   Uint32LE × n   x (11 bits) << 21 | y (11 bits) << 10 | z (10 bits),
 *                               each (v + 1) / 2 × (2^bits − 1) over the unit cube
 *   packed.w     Uint16LE × n   energy percentile × 4095
 *   packed.flags Uint8 × n      bit 0 inferred (an album centroid, not measured)
 */
function vibeMap(space, projection, { regions = 24 } = {}) {
  const coverage = space.stats;
  if (!projection || !projection.available) {
    return { available: false, held: !!(projection && projection.held),
             reason: (projection && projection.reason) || 'no projection', coverage, total: 0 };
  }
  const { map, rowsIdx, raw, xyz, wp, inferred, measured } = projection;
  const n = rowsIdx.length;
  if (measured < MIN_MEASURED) {
    return { available: false, reason: measured ? 'not enough measured tracks to map' : 'no measured tracks yet',
             coverage, total: n };
  }

  // Regions over MEASURED rows only (decision 3).
  const measuredRows = new Int32Array(measured);
  const coords = new Float64Array(measured * 4);
  for (let r = 0, j = 0; r < n; r++) {
    if (inferred[r]) continue;
    measuredRows[j] = r;
    for (let d = 0; d < 4; d++) coords[j * 4 + d] = raw[r * 4 + d];
    j++;
  }
  const { assign, centres, k } = kmeans(coords, 4, Math.min(regions, Math.max(2, Math.floor(measured / 12))));

  const globalGenreShare = new Map();
  for (let j = 0; j < measured; j++) {
    for (const g of space.meta.genres[rowsIdx[measuredRows[j]]]) {
      const key = String(g).trim();
      if (key) globalGenreShare.set(key, (globalGenreShare.get(key) || 0) + 1);
    }
  }
  for (const [g, c] of globalGenreShare) globalGenreShare.set(g, c / measured);
  const byRegion = Array.from({ length: k }, () => []);
  for (let j = 0; j < measured; j++) byRegion[assign[j]].push(rowsIdx[measuredRows[j]]);
  const regionsOut = [];
  for (let c = 0; c < k; c++) {
    const members = byRegion[c];
    if (!members.length) continue;
    regionsOut.push({
      id: c,
      label: labelRegion(space, members, globalGenreShare),
      x: round(Math.max(-1, Math.min(1, centres[c * 4] / map.radius))),
      y: round(Math.max(-1, Math.min(1, centres[c * 4 + 1] / map.radius))),
      z: round(Math.max(-1, Math.min(1, centres[c * 4 + 2] / map.radius))),
      w: round(wPercentile(map.wq, centres[c * 4 + 3])),
      count: members.length,
    });
  }

  const ids = Buffer.alloc(n * 4);
  const xyzBuf = Buffer.alloc(n * 4);
  const wBuf = Buffer.alloc(n * 2);
  const flags = Buffer.alloc(n);
  let prevId = 0;
  for (let r = 0; r < n; r++) {
    const i = rowsIdx[r];
    ids.writeInt32LE(space.ids[i] - prevId, r * 4);
    prevId = space.ids[i];
    const word = (quant(xyz[r * 3], 11) * 2 ** 21) + (quant(xyz[r * 3 + 1], 11) << 10) + quant(xyz[r * 3 + 2], 10);
    xyzBuf.writeUInt32LE(word, r * 4);
    wBuf.writeUInt16LE(Math.round(wp[r] * W_STEPS), r * 2);
    flags[r] = inferred[r] ? INFERRED : 0;
  }

  const stats = map.stats || {};
  const [low, high] = ANCHOR_POLES[map.anchor] || [map.anchor, map.anchor];
  return {
    available: true,
    coverage,
    total: n,
    measured,
    anchor: { feature: map.anchor, low, high,
              spearman: Number.isFinite(stats.spearman_heldout) ? round(stats.spearman_heldout) : null },
    axes: Array.isArray(stats.axes) ? stats.axes.slice(0, 3) : [null, null, null],
    stops: STOPS,
    regions: regionsOut,
    basis: { mode: stats.mode || null, nFit: stats.n_fit || null, calib: map.calib,
             fittedAt: stats.fitted_at || null },
    packed: { n, ids: b64(ids), xyz: b64(xyzBuf), w: b64(wBuf), flags: b64(flags) },
  };
}

/** Nearest tracks to a point in the vibe space — what a tap or a pin asks for.
 *  `x, y, z` are display units in [-1, 1]; `w` is the energy percentile in
 *  [0, 1]. Distance is 4-D Euclidean on the RAW coordinates, so it is a true
 *  projection distance: display units are scaled back by the radius, and the
 *  percentile back through the quantile table. */
function nearPoint(space, projection, point, { k = 40, perArtist = 2 } = {}) {
  if (!projection || !projection.available) return [];
  const { map, rowsIdx, raw } = projection;
  const clampUnit = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
  const target = [clampUnit(point.x) * map.radius, clampUnit(point.y) * map.radius,
                  clampUnit(point.z) * map.radius, wRaw(map.wq, point.w)];
  const scored = new Array(rowsIdx.length);
  for (let r = 0; r < rowsIdx.length; r++) {
    let s = 0;
    for (let d = 0; d < 4; d++) {
      const x = raw[r * 4 + d] - target[d];
      s += x * x;
    }
    scored[r] = [rowsIdx[r], -s];
  }
  scored.sort((a, b) => b[1] - a[1]);
  const rows = diversify(space, scored, { k, perArtist, perAlbum: 1 });
  return rows.map(([i, s]) => present(space, i, { distance: round(Math.sqrt(-s) / map.radius) }));
}

module.exports = {
  vibeMap, buildProjection, nearPoint, kmeans, labelRegion, mulberry32,
  wPercentile, wRaw, STOPS,
};
