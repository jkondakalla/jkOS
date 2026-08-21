'use strict';
// queries.js — everything the UI actually asks the space (src/discover/space.js).
//
//   similar()   "more like this"          — cosine, deduped, artist-capped
//   radio()     an endless station        — cosine to a seed CENTROID, diversified
//   makeRun()   a sequenced set with an arc — cohesion × a target energy curve
//   vibeMap()   the draggable 2-D map     — PCA-2 + k-means + auto-labelled regions
//
// ⚠️ THE DUPLICATE TRAP, WHICH IS A UI BUG HERE AND WAS A MEASUREMENT BUG THERE.
// ToDo §8.7 found ~20% of this library is a track that also appears on another
// release, and that at one point 22.9% of tracks had a duplicate as their nearest
// neighbour. For the GATE that distorted a score. For a "More like this" shelf it
// is worse: the four most similar tracks to a song are four other copies of that
// same song, which is technically the best possible answer and completely useless.
// So every ranked surface below dedupes by CONTENT KEY (artist||title) and caps how
// many rows one artist or one album may contribute. As in the gate, a duplicate is
// identified from metadata, never from "cosine ≥ 0.999" — a high cosine is what a
// correct neighbour looks like, and thresholding on it throws away real answers.
const { contentKeyFromTags } = require('./vectors');
const { NFEAT, FEATURE_NAMES, ORIGIN, ORIGIN_NAMES } = require('./space');

/* ── small helpers ─────────────────────────────────────────────────────────── */

function dot(matrix, dim, i, q) {
  const off = i * dim;
  let s = 0;
  for (let d = 0; d < dim; d++) s += matrix[off + d] * q[d];
  return s;
}

function featureOf(space, i, name) {
  if (!space.features) return null;
  const f = FEATURE_NAMES.indexOf(name);
  return f < 0 ? null : space.features[i * NFEAT + f];
}

/** A stable per-row identity for dedupe — the same artist||title key the vector
 *  seam uses, so "the same song twice" collapses whichever release it came from. */
function contentKeyAt(space, i) {
  return contentKeyFromTags(space.meta.artist[i], space.meta.title[i]) || `__row${i}`;
}

/** Shape one row into the wire object every discovery route returns. */
function present(space, i, extra = {}) {
  return {
    id: space.ids[i],
    title: space.meta.title[i],
    artist: space.meta.artist[i] || null,
    album: space.meta.album[i] || null,
    year: space.meta.year[i] || null,
    duration: space.meta.duration[i],
    genres: space.meta.genres[i],
    has_cover: !!space.meta.cover[i],
    ...extra,
  };
}

/* ── metadata affinity — the honest fallback ───────────────────────────────────
   Used when the seed (or the whole library) has no vector yet. Deliberately
   simple and deliberately LABELLED: the caller marks these results `basis:
   'metadata'` so the UI can say "same artist" instead of implying the embedder
   had an opinion. Scores are not comparable with cosines and are never mixed
   into the same ranking. */
function metadataAffinity(space, seed, { k = 24 } = {}) {
  const { meta } = space;
  const sArtist = meta.artist[seed].toLowerCase();
  const sAlbum = meta.albumKey[seed];
  const sGenres = new Set(meta.genres[seed].map((g) => String(g).toLowerCase()));
  const sYear = meta.year[seed];

  const scored = [];
  for (let i = 0; i < space.n; i++) {
    if (i === seed) continue;
    let score = 0;
    if (meta.artist[i].toLowerCase() === sArtist && sArtist) score += 0.55;
    if (sGenres.size) {
      const g = meta.genres[i].map((x) => String(x).toLowerCase());
      const shared = g.filter((x) => sGenres.has(x)).length;
      if (shared) score += 0.3 * (shared / Math.max(sGenres.size, g.length));
    }
    if (sYear && meta.year[i]) {
      const gap = Math.abs(meta.year[i] - sYear);
      if (gap <= 10) score += 0.15 * (1 - gap / 10);
    }
    // Same album is a weak signal for "more like this" — it is the one thing the
    // user is already looking at.
    if (meta.albumKey[i] === sAlbum) score -= 0.25;
    if (score > 0) scored.push([i, score]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return diversify(space, scored, { k, perArtist: 2, perAlbum: 2, seed });
}

/* ── diversification ───────────────────────────────────────────────────────────
   One pass over an already-sorted [rowIndex, score] list applying the three rules
   every shelf in this app wants: no duplicate song, no more than `perArtist` rows
   from one artist, no more than `perAlbum` from one release. */
function diversify(space, scored, { k, perArtist = 3, perAlbum = 2, seed = -1, seenKeys = null } = {}) {
  const keys = seenKeys || new Set();
  if (seed >= 0) keys.add(contentKeyAt(space, seed));
  const artistCount = new Map();
  const albumCount = new Map();
  const out = [];
  for (const [i, score] of scored) {
    if (out.length >= k) break;
    const ck = contentKeyAt(space, i);
    if (keys.has(ck)) continue;
    const a = (space.meta.artist[i] || '').toLowerCase();
    const al = space.meta.albumKey[i];
    if ((artistCount.get(a) || 0) >= perArtist) continue;
    if ((albumCount.get(al) || 0) >= perAlbum) continue;
    keys.add(ck);
    artistCount.set(a, (artistCount.get(a) || 0) + 1);
    albumCount.set(al, (albumCount.get(al) || 0) + 1);
    out.push([i, score]);
  }
  return out;
}

/* ── similar ──────────────────────────────────────────────────────────────── */

/** Nearest neighbours of one track. Returns `{ basis, results }` where basis is
 *  'embedding' or 'metadata' — never a silent mix of the two. */
function similar(space, trackId, { k = 24, perArtist = 2, perAlbum = 2 } = {}) {
  const seed = space.index.get(trackId);
  if (seed == null) return { basis: 'none', results: [] };

  if (!space.dim || space.origin[seed] === ORIGIN.NONE) {
    const rows = metadataAffinity(space, seed, { k });
    return {
      basis: 'metadata',
      results: rows.map(([i, s]) => present(space, i, { score: round(s), basis: 'metadata' })),
    };
  }

  const { matrix, dim, origin } = space;
  const q = matrix.subarray(seed * dim, seed * dim + dim);
  const scored = [];
  for (let i = 0; i < space.n; i++) {
    if (i === seed || origin[i] === ORIGIN.NONE) continue;
    scored.push([i, dot(matrix, dim, i, q)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const rows = diversify(space, scored, { k, perArtist, perAlbum, seed });
  return {
    basis: 'embedding',
    seed_origin: ORIGIN_NAMES[origin[seed]],
    results: rows.map(([i, s]) => present(space, i, {
      score: round(s),
      basis: ORIGIN_NAMES[origin[i]],
    })),
  };
}

/* ── radio ────────────────────────────────────────────────────────────────────
   A station around one or more seeds. The query is the seeds' CENTROID rather
   than each seed in turn, so "play a station from these three tracks" means the
   place between them, not a shuffle of three separate stations. */
function radio(space, seedIds, { k = 60, perArtist = 2, perAlbum = 1 } = {}) {
  const seeds = seedIds.map((id) => space.index.get(id)).filter((i) => i != null);
  if (!seeds.length) return { basis: 'none', results: [] };

  const usable = seeds.filter((i) => space.dim && space.origin[i] !== ORIGIN.NONE);
  if (!usable.length) {
    const rows = metadataAffinity(space, seeds[0], { k });
    return { basis: 'metadata', results: rows.map(([i, s]) => present(space, i, { score: round(s), basis: 'metadata' })) };
  }

  const { matrix, dim, origin } = space;
  const q = new Float32Array(dim);
  for (const i of usable) {
    const off = i * dim;
    for (let d = 0; d < dim; d++) q[d] += matrix[off + d];
  }
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += q[d] * q[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d++) q[d] /= norm;

  const seedSet = new Set(seeds);
  const seenKeys = new Set(seeds.map((i) => contentKeyAt(space, i)));
  const scored = [];
  for (let i = 0; i < space.n; i++) {
    if (seedSet.has(i) || origin[i] === ORIGIN.NONE) continue;
    scored.push([i, dot(matrix, dim, i, q)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const rows = diversify(space, scored, { k, perArtist, perAlbum, seenKeys });
  return {
    basis: 'embedding',
    results: rows.map(([i, s]) => present(space, i, { score: round(s), basis: ORIGIN_NAMES[origin[i]] })),
  };
}

/* ── Runs — a sequenced set with an ARC ────────────────────────────────────────
   The brief's word was "arc", and an arc is the one thing a nearest-neighbour walk
   cannot give you: cosine has no direction, so a greedy similarity walk wanders and
   ends wherever it started. The arc comes from the READABLE descriptor axis
   (space.features' `energy`), which is why that arm is loaded at all: at step p of
   L the run wants energy ≈ curve(p/L), and each pick maximises
       cohesion(previous)  ×  w  −  |energy − target|
   so consecutive tracks still sound like each other while the SET goes somewhere.
   With no feature arm available this degrades to a plain cohesion walk, reported
   as `arc: 'none'` rather than pretending to a shape it cannot produce. */
const ARCS = {
  rise:      (t) => 0.25 + 0.65 * t,
  wind_down: (t) => 0.85 - 0.7 * t,
  peak:      (t) => 0.3 + 0.6 * Math.sin(Math.PI * t),
  steady:    () => null,          // null ⇒ hold the seed's own energy
};

function makeRun(space, { seedId, length = 14, arc = 'rise', cohesion = 1.0, perArtist = 2 } = {}) {
  const seed = space.index.get(seedId);
  if (seed == null || !space.dim) return { arc: 'none', results: [] };

  const curve = ARCS[arc] || ARCS.rise;
  const haveFeatures = !!space.features;
  const seedEnergy = haveFeatures ? featureOf(space, seed, 'energy') : 0.5;

  const { matrix, dim, origin } = space;
  const chosen = [seed];
  const usedKeys = new Set([contentKeyAt(space, seed)]);
  const artistCount = new Map([[(space.meta.artist[seed] || '').toLowerCase(), 1]]);

  for (let step = 1; step < length; step++) {
    const prev = chosen[chosen.length - 1];
    const q = matrix.subarray(prev * dim, prev * dim + dim);
    const t = step / (length - 1);
    const target = haveFeatures ? (curve(t) ?? seedEnergy) : null;

    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < space.n; i++) {
      if (origin[i] === ORIGIN.NONE) continue;
      const ck = contentKeyAt(space, i);
      if (usedKeys.has(ck)) continue;
      const a = (space.meta.artist[i] || '').toLowerCase();
      if ((artistCount.get(a) || 0) >= perArtist) continue;
      let score = cohesion * dot(matrix, dim, i, q);
      if (target != null) score -= Math.abs(featureOf(space, i, 'energy') - target);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    chosen.push(best);
    usedKeys.add(contentKeyAt(space, best));
    const a = (space.meta.artist[best] || '').toLowerCase();
    artistCount.set(a, (artistCount.get(a) || 0) + 1);
  }

  return {
    arc: haveFeatures ? arc : 'none',
    results: chosen.map((i, step) => present(space, i, {
      step,
      energy: haveFeatures ? round(featureOf(space, i, 'energy')) : null,
      basis: ORIGIN_NAMES[origin[i]],
    })),
  };
}

function round(x) { return Math.round(x * 1000) / 1000; }

module.exports = { similar, radio, makeRun, metadataAffinity, diversify, present, contentKeyAt, ARCS, round, dot, featureOf };
