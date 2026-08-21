'use strict';
// map.js — the 2-D vibe map: where every track sits, what the regions are called,
// and what the two axes MEAN.
//
// Three decisions worth stating, because the obvious alternative is wrong in each:
//
// 1. PROJECT WITH PCA, VIA POWER ITERATION. A 512×512 covariance matrix costs
//    n·dim² ≈ 4×10⁹ operations to form — minutes of JavaScript for a map nobody
//    is waiting on. Power iteration never forms it: each sweep is two passes of
//    n·dim (≈8M), so ten sweeps per component is milliseconds. Same top
//    components, three orders of magnitude cheaper. (t-SNE/UMAP would give
//    prettier clusters and are not options here — both are iterative, neither is
//    a dependency this project will take, and neither gives a STABLE coordinate:
//    the pin the user drags has to mean the same place tomorrow.)
//
// 2. CLUSTER IN 2-D, NOT IN 512-D. Clustering the embeddings and then projecting
//    produces regions that interleave on screen — a "neighbourhood" whose members
//    are scattered across the map is a lie the user can see. The map's job is
//    spatial, so the clustering that labels it must be spatial too.
//
// 3. NAME THE AXES FROM THE READABLE ARM. A principal component is a direction,
//    not a word. Correlating each axis against the descriptor features (energy,
//    brightness, fuzz, tempo …) and naming it after its strongest correlate turns
//    "PC1" into "calm → intense", which is the difference between a scatter plot
//    and a map you can navigate. When no feature arm is loaded the axes are
//    honestly left unnamed.
const { NFEAT, FEATURE_NAMES, ORIGIN, ORIGIN_NAMES } = require('./space');
const { present, round } = require('./queries');

/** Deterministic PRNG — the map must be identical across restarts, or a user's
 *  remembered "top-left is the loud corner" silently stops being true. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Top-`k` principal components of the rows listed in `rowsIdx`, by power
 * iteration with Gram-Schmidt deflation against the components already found.
 * Returns { mean, components: Float32Array[] }.
 */
function principalComponents(matrix, dim, rowsIdx, k = 2, sweeps = 24, rand = mulberry32(7)) {
  const m = rowsIdx.length;
  const mean = new Float32Array(dim);
  for (const i of rowsIdx) {
    const off = i * dim;
    for (let d = 0; d < dim; d++) mean[d] += matrix[off + d];
  }
  for (let d = 0; d < dim; d++) mean[d] /= m;

  const components = [];
  const scratch = new Float32Array(m);

  for (let c = 0; c < k; c++) {
    let v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = rand() * 2 - 1;
    orthogonalise(v, components);
    normalise(v);

    for (let s = 0; s < sweeps; s++) {
      // scratch = Xc · v        (one pass, n·dim)
      for (let r = 0; r < m; r++) {
        const off = rowsIdx[r] * dim;
        let acc = 0;
        for (let d = 0; d < dim; d++) acc += (matrix[off + d] - mean[d]) * v[d];
        scratch[r] = acc;
      }
      // v' = Xcᵀ · scratch      (second pass, n·dim) — together one power sweep
      const next = new Float32Array(dim);
      for (let r = 0; r < m; r++) {
        const off = rowsIdx[r] * dim;
        const w = scratch[r];
        if (w === 0) continue;
        for (let d = 0; d < dim; d++) next[d] += (matrix[off + d] - mean[d]) * w;
      }
      orthogonalise(next, components);
      if (!normalise(next)) break;
      v = next;
    }
    components.push(v);
  }
  return { mean, components };
}

function orthogonalise(v, basis) {
  for (const b of basis) {
    let p = 0;
    for (let d = 0; d < v.length; d++) p += v[d] * b[d];
    for (let d = 0; d < v.length; d++) v[d] -= p * b[d];
  }
}

function normalise(v) {
  let s = 0;
  for (let d = 0; d < v.length; d++) s += v[d] * v[d];
  const n = Math.sqrt(s);
  if (!(n > 1e-12)) return false;
  for (let d = 0; d < v.length; d++) v[d] /= n;
  return true;
}

/** k-means++ seeded Lloyd's algorithm over 2-D points. Small, deterministic,
 *  and enough: the input is already a 2-D projection, not raw audio. */
function kmeans2d(xs, ys, k, iters = 30, rand = mulberry32(11)) {
  const n = xs.length;
  k = Math.max(1, Math.min(k, n));
  const cx = new Float64Array(k);
  const cy = new Float64Array(k);

  // k-means++ init — spread the first centres out, so a region is never seeded twice.
  let first = Math.floor(rand() * n);
  cx[0] = xs[first]; cy[0] = ys[first];
  const d2 = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - cx[c - 1], dy = ys[i] - cy[c - 1];
      d2[i] = Math.min(d2[i], dx * dx + dy * dy);
      total += d2[i];
    }
    let target = rand() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { target -= d2[i]; if (target <= 0) { pick = i; break; } }
    cx[c] = xs[pick]; cy[c] = ys[pick];
  }

  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = xs[i] - cx[c], dy = ys[i] - cy[c];
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) { sx[assign[i]] += xs[i]; sy[assign[i]] += ys[i]; cnt[assign[i]]++; }
    for (let c = 0; c < k; c++) if (cnt[c]) { cx[c] = sx[c] / cnt[c]; cy[c] = sy[c] / cnt[c]; }
    if (!moved) break;
  }
  return { assign, cx, cy, k };
}

/* ── labelling ────────────────────────────────────────────────────────────────
   A region's name comes from what is DISTINCTIVE about it, not from what is most
   common in it: the commonest genre in almost every region of almost every
   library is the commonest genre in the library. So each candidate genre is
   scored by lift — its share inside the region over its share of the whole
   library — with a small-count floor so one stray tag on a three-track region
   cannot name it. A feature qualifier ("fast", "fuzzy", "calm") is appended from
   the readable arm when the region is genuinely extreme on that axis. */
const QUALIFIERS = [
  { feature: 'energy',     high: 'loud',    low: 'quiet' },
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

/** Pearson correlation of one axis against one feature column, over `rowsIdx`. */
function correlate(space, rowsIdx, coords, featureIdx) {
  const n = rowsIdx.length;
  let sx = 0, sy = 0;
  for (let r = 0; r < n; r++) { sx += coords[r]; sy += space.features[rowsIdx[r] * NFEAT + featureIdx]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let r = 0; r < n; r++) {
    const a = coords[r] - mx;
    const b = space.features[rowsIdx[r] * NFEAT + featureIdx] - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 1e-12 ? num / den : 0;
}

const AXIS_POLES = {
  energy:     ['calm', 'intense'],
  tempo:      ['slow', 'fast'],
  fuzz:       ['clean', 'fuzzy'],
  brightness: ['dark', 'bright'],
  drive:      ['loose', 'driving'],
  density:    ['sparse', 'busy'],
};

function nameAxis(space, rowsIdx, coords) {
  if (!space.features) return null;
  let bestF = -1, bestR = 0;
  for (let f = 0; f < NFEAT; f++) {
    const r = correlate(space, rowsIdx, coords, f);
    if (Math.abs(r) > Math.abs(bestR)) { bestR = r; bestF = f; }
  }
  if (bestF < 0 || Math.abs(bestR) < 0.15) return null;
  const poles = AXIS_POLES[FEATURE_NAMES[bestF]] || [FEATURE_NAMES[bestF], FEATURE_NAMES[bestF]];
  const [low, high] = bestR >= 0 ? poles : [poles[1], poles[0]];
  return { feature: FEATURE_NAMES[bestF], r: round(bestR), low, high };
}

/**
 * The whole map. Coordinates are normalised to [-1, 1] on both axes so the
 * client can treat the map as a unit square regardless of library size.
 */
function vibeMap(space, { regions = 12, sample = 4000 } = {}) {
  const rowsIdx = [];
  for (let i = 0; i < space.n; i++) if (space.origin[i] !== ORIGIN.NONE) rowsIdx.push(i);

  if (rowsIdx.length < 8 || !space.dim) {
    return {
      available: false,
      reason: rowsIdx.length ? 'not enough embedded tracks to project' : 'no embedded tracks yet',
      coverage: space.stats,
      points: [], regions: [], axes: { x: null, y: null },
    };
  }

  const { mean, components } = principalComponents(space.matrix, space.dim, rowsIdx, 2);
  const [pc1, pc2] = components;
  const m = rowsIdx.length;
  const xs = new Float64Array(m);
  const ys = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const off = rowsIdx[r] * space.dim;
    let x = 0, y = 0;
    for (let d = 0; d < space.dim; d++) {
      const v = space.matrix[off + d] - mean[d];
      x += v * pc1[d];
      y += v * pc2[d];
    }
    xs[r] = x; ys[r] = y;
  }

  // Normalise to [-1,1] on a ROBUST span (2nd–98th percentile), then clamp: a
  // handful of outliers must not squash the whole library into the middle pixel.
  scaleToUnit(xs);
  scaleToUnit(ys);

  const { assign, cx, cy, k } = kmeans2d(xs, ys, Math.min(regions, Math.max(2, Math.floor(m / 12))));

  // Global genre shares, for the lift-based labelling above.
  const globalGenreShare = new Map();
  for (const i of rowsIdx) {
    for (const g of space.meta.genres[i]) {
      const key = String(g).trim();
      if (key) globalGenreShare.set(key, (globalGenreShare.get(key) || 0) + 1);
    }
  }
  for (const [g, c] of globalGenreShare) globalGenreShare.set(g, c / rowsIdx.length);

  const byRegion = Array.from({ length: k }, () => []);
  for (let r = 0; r < m; r++) byRegion[assign[r]].push(rowsIdx[r]);

  const regionsOut = byRegion.map((members, c) => ({
    id: c,
    label: members.length ? labelRegion(space, members, globalGenreShare) : 'Empty',
    x: round(cx[c]),
    y: round(cy[c]),
    count: members.length,
  })).filter((r) => r.count > 0);

  // The point list is what the client draws. A library of thousands does not need
  // every dot to be interactive, so beyond `sample` it is thinned deterministically
  // (every nth row) — the SHAPE of the cloud survives, the payload stays small.
  const stride = m > sample ? Math.ceil(m / sample) : 1;
  const points = [];
  for (let r = 0; r < m; r += stride) {
    const i = rowsIdx[r];
    points.push({
      id: space.ids[i],
      x: round(xs[r]),
      y: round(ys[r]),
      r: assign[r],
      o: ORIGIN_NAMES[space.origin[i]] === 'inferred' ? 0 : 1,
    });
  }

  return {
    available: true,
    coverage: space.stats,
    axes: { x: nameAxis(space, rowsIdx, xs), y: nameAxis(space, rowsIdx, ys) },
    regions: regionsOut,
    points,
    sampled: stride > 1,
    total: m,
  };
}

function scaleToUnit(arr) {
  const sorted = Float64Array.from(arr).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const span = (hi - lo) || 1;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.max(-1, Math.min(1, ((arr[i] - lo) / span) * 2 - 1));
  }
}

/** Nearest tracks to a point on the map — what the draggable pin asks for.
 *  Requires the projection, so it is computed and cached alongside it. */
function nearPoint(space, projection, x, y, { k = 40, perArtist = 2 } = {}) {
  const { rowsIdx, xs, ys } = projection;
  const scored = [];
  for (let r = 0; r < rowsIdx.length; r++) {
    const dx = xs[r] - x, dy = ys[r] - y;
    scored.push([rowsIdx[r], -(dx * dx + dy * dy)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const { diversify } = require('./queries');
  const rows = diversify(space, scored, { k, perArtist, perAlbum: 1 });
  return rows.map(([i, s]) => present(space, i, { distance: round(Math.sqrt(-s)) }));
}

module.exports = { vibeMap, principalComponents, kmeans2d, nearPoint, scaleToUnit, mulberry32 };
